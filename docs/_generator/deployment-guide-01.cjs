/**
 * DEPLOYMENT_GUIDE_01 — Google Cloud Compute setup.
 *
 *   cd docs/_generator && node deployment-guide-01.cjs
 *
 * Companion to the DEV_GUIDE series, not part of it: the guides record what was
 * BUILT at each milestone, this records how the thing gets RUN. It deliberately
 * stops at a blank Ubuntu server with an address, exactly where GUIDE_21 did for
 * the CMS. Everything after that point is docs/DEPLOYMENT.md.
 */
const { p, rich, bullet, step, code, h1, h2, spacer, callout, table, build } = require('./guide-lib.cjs');

build({
  filename: 'DEPLOYMENT_GUIDE_01 - Google Cloud Compute Setup.docx',
  eyebrow: 'HOSPITAL MANAGEMENT SYSTEM  ·  DEPLOYMENT GUIDE 01',
  titlePrefix: '',
  title: 'A Linux server on Google Cloud',
  standfirst:
    'Compute Engine e2-medium · europe-west1 · getting to a box with an ' +
    'address. Everything up to a blank Ubuntu server with a public IP, a ' +
    'hostname that already resolves, and a working terminal. Nothing ' +
    'HMS-specific — that is DEPLOYMENT.md, and it is the same on any provider.',
  docTitle: 'DEPLOYMENT_GUIDE_01 — Google Cloud Compute setup',
  docDescription: 'Hospital Management System — provisioning the pilot server.',
  children: [

    // =====================================================================
    h1('Why this is not the free tier'),

    p('The CMS runs on Google\'s always-free e2-micro, and GUIDE_21 is mostly ' +
      'a guide to staying inside that allowance. This machine is a paid one, ' +
      'and almost every rule from that guide is reversed.'),

    table(
      [2200, 3400, 3400],
      ['', 'The CMS (GUIDE_21)', 'This server'],
      [
        ['Cost', '$0, permanently', 'About $32/month, charged against the $300 credit at first'],
        ['RAM', '1 GB — needs a swap file to build at all', '4 GB — does not'],
        ['Region', 'us-west1, us-central1 or us-east1 only', 'europe-west1 (Belgium), chosen by measurement'],
        ['Disk type', 'Standard. Balanced disqualifies the free tier', 'Balanced. It is the default and it is now the RIGHT choice'],
        ['Disk size', '30 GB or less', '50 GB'],
        ['Runs', 'Node, Postgres and Caddy for one site', 'The same, plus one PostgreSQL database per hospital'],
      ]
    ),

    callout('The four "must be" settings in GUIDE_21 exist only to stay inside ' +
            'the free allowance. NONE of them apply here. Following that table ' +
            'while building this machine would give you a slow disk on the ' +
            'wrong continent, for no benefit at all.'),

    h2('Why 4 GB rather than 1'),
    bullet('The swap-file step at the top of GUIDE_22 exists for one reason: a ' +
           'Vite build gets killed by the out-of-memory killer on 1 GB. Four ' +
           'gigabytes removes that step and the class of failure behind it.'),
    bullet('PostgreSQL wants memory it can hold on to. On 1 GB it is competing ' +
           'with the Node process and the build for the same scarce thing.'),
    bullet('This box carries a database PER HOSPITAL, not one database. The ' +
           'free box ran a single site.'),

    spacer(),

    // =====================================================================
    h1('Step 1 — A separate project'),

    p('console.cloud.google.com → new project. Something like hms-pilot.'),

    p('Separate from the CMS project on purpose. Billing is reported per ' +
      'project, so this way you can see exactly what the HMS costs without ' +
      'unpicking it from the CMS bill — which is the whole point of the ' +
      'exercise with the credit. Deleting the project later removes ' +
      'everything in it cleanly, and a mistake in one project cannot reach ' +
      'the other.'),

    p('Time: about two minutes.'),

    spacer(),

    // =====================================================================
    h1('Step 2 — Billing, and the credit'),

    p('Use the billing account that already exists. The painful part of ' +
      'GUIDE_21 — getting a card Google would accept — is already done and ' +
      'does not need repeating.'),

    step('Billing → Credits. Find the $300 free-trial credit.', 1),
    step('WRITE DOWN ITS EXPIRY DATE. It is the number that actually governs ' +
         'this deployment.', 1),

    callout('The credit expires by DATE, not by exhaustion. At about $32/month ' +
            'you will have spent roughly $100 of the $300 when the 90 days run ' +
            'out. So plan around the calendar and the monthly bill, not around ' +
            'watching the credit drain — it will not.'),

    spacer(),

    // =====================================================================
    h1('Step 3 — Enable the Compute Engine API'),

    p('Search "Compute Engine" in the console and click Enable.'),

    p('This is per PROJECT. The CMS project has it enabled; a new project does ' +
      'not, and needs it again. It takes a minute or two to provision behind ' +
      'the scenes. It catches people out because nothing works until it is ' +
      'done and the error messages do not say so clearly.'),

    spacer(),

    // =====================================================================
    h1('Step 4 — Create the VM'),

    p('Compute Engine → VM instances → Create instance.'),

    table(
      [2400, 2600, 4000],
      ['Setting', 'Value', 'Why'],
      [
        ['Name', 'hms-pilot-stnicholas', 'Name it for the hospital. In two years there will be several, and instance-1 will mean nothing.'],
        ['Region', 'europe-west1 (Belgium)', 'Measured, not assumed — see the appendix. Johannesburg is geographically closer and roughly 280ms worse.'],
        ['Zone', 'europe-west1-b', 'Any zone in the region is fine. Write down which one: gcloud commands and the disk both need it.'],
        ['Machine type', 'E2 → e2-medium', '2 vCPU, 4 GB. $26.91/month in this region.'],
        ['Boot disk image', 'Ubuntu 24.04 LTS', 'Same as the CMS. Long-term support, and every command in DEPLOYMENT.md assumes it.'],
        ['Boot disk type', 'Balanced persistent disk', 'The console default, and correct this time. Standard is slower for no saving worth having once you are paying anyway.'],
        ['Boot disk size', '50 GB', 'Patient records are small; scanned ID cards and referral letters are not, and PatientAttachment puts those on this disk. A persistent disk can be grown later without downtime, but never shrunk.'],
      ]
    ),

    callout('Tick "Allow HTTP traffic" AND "Allow HTTPS traffic". Without ' +
            'them ports 80 and 443 stay closed and nothing you deploy is ' +
            'reachable. It is easy to miss and produces a baffling silence ' +
            'much later, long after you have stopped suspecting the firewall.'),

    p('The estimator panel will show roughly $32/month. Unlike the CMS build, ' +
      'that figure is real — see Appendix A.'),

    p('Click Create. About thirty seconds later an external IP appears in the ' +
      'instance list.'),

    spacer(),

    // =====================================================================
    h1('Step 5 — Reserve a static IP'),

    p('VPC network → IP addresses. Find the ephemeral address attached to the ' +
      'instance and reserve it.'),

    p('This mattered on the CMS because DNS would break. It matters MORE here, ' +
      'because of what comes next: the hostname is derived from the IP, and ' +
      'that hostname is registered against the hospital in the control plane. ' +
      'If the IP changes, the hostname changes, and resolveTenant stops ' +
      'recognising the hospital — a working TLS connection to a 404.'),

    p('A static IP is free while attached to a running instance and charged ' +
      'when idle, so do not reserve one and leave it unused.'),

    spacer(),

    // =====================================================================
    h1('Step 6 — A hostname'),

    p('The hospital needs a name, not an IP address. For now that is sslip.io, ' +
      'which is a DNS service that needs no configuration at all: any hostname ' +
      'ending in sslip.io that contains an IP address resolves to that address.'),

    ...code([
      '34.77.1.2.sslip.io          ->  34.77.1.2',
      'hms.34-77-1-2.sslip.io      ->  34.77.1.2',
      '',
      '# Both forms work. Dashes are used when you want a prefix in front.'
    ]),

    p('No domain to buy, no DNS records to create, and it works the moment the ' +
      'IP exists. Write down the exact hostname you settle on — you need it ' +
      'twice later: in the Caddyfile, and as --host when you onboard the ' +
      'hospital.'),

    h2('The catch, and it is a real one'),

    p('Caddy gets its HTTPS certificate from Let\'s Encrypt, which limits how ' +
      'many certificates can be issued for a single registered domain. Every ' +
      'user of sslip.io in the world shares one domain: sslip.io.'),

    p('In February 2026 that limit was exhausted, and requests were refused ' +
      'with "too many certificates already issued for sslip.io". When that ' +
      'happens Caddy cannot obtain OR RENEW a certificate, the site becomes ' +
      'unreachable over HTTPS, and there is nothing to do but wait for other ' +
      'people\'s usage to fall.'),

    callout('Use sslip.io to get the deployment working and to let the pilot ' +
            'staff in. Move to a hostname on a domain you control BEFORE the ' +
            'hospital depends on this. A subdomain of a domain you already own ' +
            'costs nothing and removes the risk completely.'),

    p('Changing it later is cheap, which is why starting on sslip.io is ' +
      'reasonable: the hostname is a row in the control plane. Add the new ' +
      'hostname, point the DNS at the same IP, add it to the Caddyfile, and ' +
      'reload. No migration, no downtime, and the old hostname can keep ' +
      'working alongside the new one for as long as you like.'),

    spacer(),

    // =====================================================================
    h1('Step 7 — Connect'),

    p('Click the SSH button beside the instance. A terminal opens in the ' +
      'browser with no keys to generate, no PuTTY, and nothing to configure.'),

    p('For a first deployment this is a genuine gift, and it was the right ' +
      'call on the CMS too. Setting up the gcloud CLI or your own SSH key for ' +
      'a local terminal can wait until the deployment works — and on Windows ' +
      'it avoids the scp-and-SSH-keys problem recorded in GUIDE_22.'),

    spacer(),

    // =====================================================================
    h1('Step 8 — Budget alert'),

    p('Billing → Budgets & alerts → create a budget of $50, with email alerts ' +
      'at 50% and 100%.'),

    p('On the CMS the budget was $1, because any charge at all meant one of ' +
      'the free-tier settings was wrong. Here charges are expected, so the ' +
      'alert has a different job: it tells you if this is costing more than it ' +
      'should — a second instance left running, a disk snapshot schedule ' +
      'nobody meant to create, egress from something misconfigured.'),

    spacer(),

    // =====================================================================
    h1('Step 9 — A small swap file (optional)'),

    p('Four gigabytes does not need one. This is insurance, not a requirement, ' +
      'and it costs disk you have already paid for.'),

    ...code([
      'sudo fallocate -l 2G /swapfile',
      'sudo chmod 600 /swapfile',
      'sudo mkswap /swapfile',
      'sudo swapon /swapfile',
      'echo \'/swapfile none swap sw 0 0\' | sudo tee -a /etc/fstab',
      '',
      'free -h        # confirm it is there'
    ]),

    p('The /etc/fstab line is what makes it survive a reboot. Without it the ' +
      'swap silently disappears the first time the machine restarts, which is ' +
      'the sort of thing discovered months later during an incident.'),

    p('On the CMS this step was mandatory and its absence was the cause of the ' +
      'build being killed. Here it is a cushion for a Postgres query that ' +
      'briefly wants more than it should.'),

    spacer(),

    // =====================================================================
    h1('Appendix A — What "about $32/month" actually means'),

    p('On the CMS, the estimator quoted $7.11 and Google billed $0.00, because ' +
      'the free tier is applied as a credit on the bill rather than as a ' +
      'discount in the estimator. That was the single most confusing thing ' +
      'about that deployment.'),

    p('Here the quote is real. There is no free-tier credit to cancel it.'),

    table(
      [4500, 4500],
      ['Item', 'Monthly'],
      [
        ['e2-medium, europe-west1', '$26.91'],
        ['50 GB balanced persistent disk', 'about $5'],
        ['Static IP, while attached to a running instance', '$0'],
        ['Egress', 'Small for a hospital-sized workload'],
        ['Total', 'about $32'],
      ]
    ),

    p('While the credit is active, Billing → Reports shows the charges AND a ' +
      'matching credit line cancelling them. When the credit expires the same ' +
      'charges appear without that line. Nothing changes technically on that ' +
      'day; the bill simply starts arriving.'),

    p('Sustained-use discounts are applied automatically for an instance that ' +
      'runs most of a month, so the real figure often lands slightly under the ' +
      'estimate rather than over it.'),

    spacer(),

    // =====================================================================
    h1('Appendix B — Why the region was measured rather than reasoned'),

    p('The obvious answer was Johannesburg: it is the closest Google region to ' +
      'Lagos, and Google\'s own Equiano subsea cable lands in Lagos and runs to ' +
      'South Africa. The competing argument was that African internet traffic ' +
      'often transits Europe regardless, which would favour London. Both were ' +
      'plausible. Only one was true.'),

    p('Measured with gcping.com from a Lagos connection on 7 September 2026:'),

    table(
      [3400, 2800, 2800],
      ['Region', 'Median latency', 'e2-medium / month'],
      [
        ['Milan (europe-west8)', '327 ms', '$28.37'],
        ['Belgium (europe-west1)', '377 ms  ← chosen', '$26.91'],
        ['London (europe-west2)', '416 ms', '$31.51'],
        ['Frankfurt (europe-west3)', '444 ms', '$31.51'],
        ['Johannesburg (africa-south1)', '661 ms', '$26.91'],
        ['Iowa (us-central1)', '877 ms', '$24.46'],
      ]
    ),

    p('Belgium rather than Milan because it is cheaper and within 50ms of the ' +
      'fastest, and because the Milan reading is a single sample from a run ' +
      'that also put Taiwan ahead of Frankfurt — which cannot be right. ' +
      'Belgium sits in a consistent cluster with London and Frankfurt.'),

    callout('The absolute numbers were high across the whole run, which means ' +
            'the connection was busy. The RANKING is the trustworthy part. Run ' +
            'gcping.com again from the hospital\'s own connection before ' +
            'treating the choice as final — Europe beating Johannesburg will ' +
            'not change, but the ordering within Europe might.'),

    spacer(),

    // =====================================================================
    h1('Appendix C — The CMS\'s free instance is not at risk'),

    p('Adding a paid instance does not endanger the always-free e2-micro the ' +
      'CMS runs on. They are separate programmes: always-free is permanent and ' +
      'has no end date; the $300 trial credit is temporary and additional.'),

    bullet('The free allowance is ONE qualifying instance per BILLING ACCOUNT, ' +
           'not per project. Putting the HMS in its own project neither creates ' +
           'a second free allowance nor consumes the CMS\'s.'),
    bullet('An e2-medium in europe-west1 was never eligible for it, so it ' +
           'cannot accidentally claim the allowance either.'),
    bullet('The only ways to lose the free instance are to delete it, move it ' +
           'out of a free region, change its machine type, or change its boot ' +
           'disk to Balanced.'),

    spacer(),

    // =====================================================================
    h1('What you have at the end'),

    p('A blank Ubuntu 24.04 server: 2 vCPU, 4 GB RAM, a 50 GB balanced disk, in ' +
      'Belgium, with a reserved static IP, a hostname that already resolves to ' +
      'it, ports 80 and 443 open, and a terminal in your browser.'),

    p('Nothing to do with the HMS yet.'),

    spacer(),

    // =====================================================================
    h1('What comes next'),

    rich(['All of it is in ', ['docs/DEPLOYMENT.md'], ', sections 1 to 9. In outline:']),

    bullet('PostgreSQL, Node 22 and Caddy. The hms database role needs CREATEDB, ' +
           'because onboarding creates a database per hospital.'),
    bullet('The .env values that differ from development, and what each one ' +
           'actually does — NODE_ENV=production is the one that matters most, ' +
           'because it is what disables the X-Tenant header. Leave ' +
           'DEFAULT_TENANT unset on a server. Set HOSPITAL_TZ.'),
    bullet('A Caddyfile using the hostname from step 6. It must match a ' +
           'hostname registered for the hospital in the control plane, or you ' +
           'get a valid certificate in front of a 404.'),
    bullet('A systemd unit, so the API comes back after a crash and after a ' +
           'reboot.'),
    bullet('Backups, taken AND VERIFIED before a single patient is entered. A ' +
           'backup nobody has restored is a hope, not a backup.'),
    bullet('Onboarding the hospital, with the MRN prefix the CMD chose. There ' +
           'is no default and the command refuses without one.'),

    p('Roughly two hours the first time, and — apart from this guide — ' +
      'identical on any provider.'),

    spacer(),
    p('Compiled 7 September 2026. Region chosen by measurement from Lagos on ' +
      'that date; prices checked the same day and worth re-checking before a ' +
      'future deployment. The sslip.io certificate limit described in step 6 ' +
      'is a live risk with a documented occurrence, not a theoretical one.',
      { italics: true, color: '55686B' })
  ]
}).catch(err => { console.error(err); process.exit(1); });
