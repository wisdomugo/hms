import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router';
import { api, fullName, age, shortDate, dateTime, bytes } from '../lib/api';

/*
 * One patient.
 *
 * Three things this screen has to make obvious at a glance, because each is a
 * different kind of "do not treat this as an ordinary record":
 *
 *   - unreconciled  — an emergency file with a TEMP number and almost nothing
 *                     in it, which somebody has to come back to
 *   - merged away   — this is not a patient any more, it is a redirect
 *   - incomplete    — normal here, but worth chasing
 */

const SEX = ['female', 'male', 'other', 'unknown'];
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const GENOTYPE = ['AA', 'AS', 'AC', 'SS', 'SC', 'CC'];
const KINDS = ['id-card', 'referral', 'consent', 'old-folder', 'photo', 'other'];

const forInput = value => (value ? new Date(value).toISOString().slice(0, 10) : '');

export default function PatientRecord() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [data, setData] = useState({ status: 'loading' });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [flash, setFlash] = useState(params.get('registered') ? 'Patient registered.' : null);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);

  const load = useCallback(async () => {
    try {
      const result = await api.get(`/api/patients/${id}`);
      setData({ status: 'ready', ...result });
    } catch (err) {
      setData({ status: 'error', message: err.message });
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (data.status === 'loading') return <div className="page"><p className="page__sub">Loading…</p></div>;
  if (data.status === 'error') return <div className="page"><p className="msg msg--bad">{data.message}</p></div>;

  const p = data.patient;
  const isTemporary = p.identityStatus === 'temporary';
  const isMerged = Boolean(p.mergedIntoId);

  function startEdit() {
    setDraft({
      surname: p.surname ?? '', firstName: p.firstName ?? '', otherNames: p.otherNames ?? '',
      sex: p.sex ?? '', dateOfBirth: forInput(p.dateOfBirth),
      phone: p.phone ?? '', altPhone: p.altPhone ?? '', email: p.email ?? '',
      address: p.address ?? '', city: p.city ?? '', state: p.state ?? '',
      occupation: p.occupation ?? '', nationality: p.nationality ?? '', stateOfOrigin: p.stateOfOrigin ?? '',
      bloodGroup: p.bloodGroup ?? '', genotype: p.genotype ?? '', knownAllergies: p.knownAllergies ?? ''
    });
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    setError(null);
    try {
      // Send only what changed. Sending the whole object would rewrite every
      // field on every save, so the audit log would say "changed 17 fields"
      // when somebody corrected a phone number.
      const changed = Object.fromEntries(
        Object.entries(draft).filter(([key, value]) => {
          const current = key === 'dateOfBirth' ? forInput(p.dateOfBirth) : (p[key] ?? '');
          return value !== current;
        }).map(([key, value]) => [key, value === '' ? null : value])
      );

      if (Object.keys(changed).length === 0) { setEditing(false); return; }

      // A temporary record being completed is a RECONCILIATION, not an edit:
      // it issues a permanent number and keeps the TEMP one as an identifier.
      const path = isTemporary
        ? `/api/patients/${id}/reconcile`
        : `/api/patients/${id}`;

      const result = isTemporary
        ? await api.post(path, changed)
        : await api.patch(path, changed);

      setEditing(false);
      setFlash(
        isTemporary
          ? `Reconciled. ${result.previousMrn} is kept as an old number.`
          : 'Saved.'
      );
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function uploadFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('kind', document.getElementById('attachment-kind').value);

    try {
      await api.post(`/api/patients/${id}/attachments`, form);
      setFlash('Document attached.');
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function removeAttachment(attachmentId) {
    setError(null);
    try {
      await api.delete(`/api/patients/${id}/attachments/${attachmentId}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const set = key => e => setDraft(d => ({ ...d, [key]: e.target.value }));

  return (
    <div className="page page--wide">
      {/* A merged record is a redirect, not a patient. Say so before anything
          else on the screen, and offer the way out. */}
      {isMerged && (
        <div className="banner banner--stop">
          <strong>This record was merged into another.</strong>
          <span>
            It is kept because the old folder number is still written on paper.
            Nothing here can be changed.
          </span>
          <Link className="btn btn--inline" to={`/patients/${p.mergedIntoId}`}>
            Open the current record
          </Link>
        </div>
      )}

      {isTemporary && !isMerged && (
        <div className="banner banner--warn">
          <strong>Emergency file — not yet reconciled.</strong>
          <span>
            This patient has a temporary number. Once they are stable, fill in
            what you can and save: that issues a permanent hospital number and
            keeps <span className="mono">{p.mrn}</span> as an old number.
          </span>
        </div>
      )}

      <header className="page__head page__head--split">
        <div>
          <h1>{fullName(p)}</h1>
          <p className="page__sub">
            <span className="mono">{p.mrn}</span>
            {' · '}{p.sex ?? 'sex not recorded'}
            {' · '}age {age(p)}
            {' · registered '}{shortDate(p.registeredAt)}
            {p.registeredBy ? ` by ${p.registeredBy.name ?? p.registeredBy.email}` : ''}
          </p>
        </div>
        {!isMerged && !editing && (
          <button className="btn btn--primary btn--inline" type="button" onClick={startEdit}>
            {isTemporary ? 'Complete registration' : 'Edit details'}
          </button>
        )}
      </header>

      {flash && <p className="msg msg--ok">{flash}</p>}
      {error && <p className="msg msg--bad">{error}</p>}

      {data.completeness.missing.length > 0 && (
        <section className="panel panel--quiet">
          <div className="meter">
            <div className="meter__bar" style={{ width: `${data.completeness.score}%` }} />
          </div>
          <p>
            {data.completeness.score}% recorded — still missing{' '}
            {data.completeness.missing.join(', ')}. Not a problem; it is why this
            record is on the follow-up list.
          </p>
        </section>
      )}

      {editing ? (
        <form onSubmit={save}>
          <section className="panel">
            <h2>Details</h2>
            <div className="row row--3">
              <label className="field"><span>Surname</span><input value={draft.surname} onChange={set('surname')} /></label>
              <label className="field"><span>First name</span><input value={draft.firstName} onChange={set('firstName')} /></label>
              <label className="field"><span>Other names</span><input value={draft.otherNames} onChange={set('otherNames')} /></label>
            </div>
            <div className="row row--3">
              <label className="field"><span>Sex</span>
                <select value={draft.sex} onChange={set('sex')}>
                  <option value="">—</option>{SEX.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="field"><span>Date of birth</span><input type="date" value={draft.dateOfBirth} onChange={set('dateOfBirth')} /></label>
              <label className="field"><span>Phone</span><input value={draft.phone} onChange={set('phone')} /></label>
            </div>
            <label className="field"><span>Address</span><input value={draft.address} onChange={set('address')} /></label>
            <div className="row row--3">
              <label className="field"><span>Blood group</span>
                <select value={draft.bloodGroup} onChange={set('bloodGroup')}>
                  <option value="">—</option>{BLOOD.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="field"><span>Genotype</span>
                <select value={draft.genotype} onChange={set('genotype')}>
                  <option value="">—</option>{GENOTYPE.map(v => <option key={v}>{v}</option>)}
                </select>
              </label>
              <label className="field"><span>Known allergies</span><input value={draft.knownAllergies} onChange={set('knownAllergies')} /></label>
            </div>
            <div className="formfoot__actions">
              <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn--primary btn--inline" type="submit">
                {isTemporary ? 'Reconcile and issue a number' : 'Save changes'}
              </button>
            </div>
          </section>
        </form>
      ) : (
        <section className="panel">
          <h2>Details</h2>
          <dl className="kv">
            <div><dt>Phone</dt><dd>{p.phone ?? '—'}{p.altPhone ? `, ${p.altPhone}` : ''}</dd></div>
            <div><dt>Email</dt><dd>{p.email ?? '—'}</dd></div>
            <div><dt>Address</dt><dd>{[p.address, p.city, p.state].filter(Boolean).join(', ') || '—'}</dd></div>
            <div><dt>Date of birth</dt><dd>{shortDate(p.dateOfBirth)}</dd></div>
            <div><dt>Occupation</dt><dd>{p.occupation ?? '—'}</dd></div>
            <div><dt>Blood group</dt><dd>{p.bloodGroup ?? '—'}</dd></div>
            <div><dt>Genotype</dt><dd>{p.genotype ?? '—'}</dd></div>
            <div><dt>Known allergies</dt><dd>{p.knownAllergies ?? '—'}</dd></div>
          </dl>
        </section>
      )}

      <section className="panel">
        <h2>Other numbers</h2>
        {p.identifiers.length === 0 ? (
          <p className="page__sub">None recorded.</p>
        ) : (
          <ul className="chips">
            {p.identifiers.map(i => (
              <li key={i.id} className="chip chip--static">
                <strong>{i.type}</strong> <span className="mono">{i.value}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <h2>Next of kin</h2>
        {p.kin.length === 0 ? <p className="page__sub">None recorded.</p> : (
          <dl className="kv">
            {p.kin.map(k => (
              <div key={k.id}>
                <dt>{k.relationship || 'Contact'}</dt>
                <dd>{[k.name, k.phone].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="panel">
        <h2>Who is paying</h2>
        {p.payers.length === 0 ? <p className="page__sub">Not recorded.</p> : (
          <dl className="kv">
            {p.payers.map(pay => (
              <div key={pay.id}>
                <dt>{pay.payerType}{pay.isPrimary ? ' (primary)' : ''}</dt>
                <dd>{[pay.payerName, pay.policyNumber].filter(Boolean).join(' · ') || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="panel">
        <h2>Visits</h2>
        {p.visits.length === 0 ? <p className="page__sub">No visits yet.</p> : (
          <div className="tablewrap">
            <table className="grid">
              <thead><tr><th>Number</th><th>Type</th><th>Department</th><th>Opened</th><th>Status</th></tr></thead>
              <tbody>
                {p.visits.map(v => (
                  <tr key={v.id}>
                    <td className="mono nowrap">{v.visitNumber}</td>
                    <td>{v.type}</td>
                    <td>{v.department ?? '—'}</td>
                    <td className="nowrap">{dateTime(v.queuedAt)}</td>
                    <td><span className={`pill pill--${v.status === 'open' ? 'ok' : 'denied'}`}>{v.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Documents</h2>
        <p className="panel__lede">
          Scanned ID cards, referral letters, consent forms. Images and PDFs, up
          to 10 MB.
        </p>

        {!isMerged && (
          <div className="row row--2">
            <label className="field">
              <span>Kind</span>
              <select id="attachment-kind" defaultValue="id-card">
                {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="field">
              <span>File</span>
              <input type="file" ref={fileInput} onChange={uploadFile}
                     accept="image/jpeg,image/png,image/webp,image/gif,application/pdf" />
            </label>
          </div>
        )}

        {p.attachments.length === 0 ? (
          <p className="page__sub">Nothing attached.</p>
        ) : (
          <ul className="files">
            {p.attachments.map(a => (
              <li key={a.id}>
                <a href={a.url} target="_blank" rel="noreferrer">{a.filename}</a>
                <span className="files__meta">{a.kind} · {bytes(a.sizeBytes)} · {shortDate(a.createdAt)}</span>
                {!isMerged && (
                  <button className="btn btn--quiet btn--tiny" type="button"
                          onClick={() => removeAttachment(a.id)}>Remove</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {!isMerged && <MergePanel patientId={p.id} mrn={p.mrn} onDone={() => navigate(0)} />}
    </div>
  );
}

/*
 * Merging.
 *
 * Two guards, because a merge is irreversible in practice: you have to find the
 * other record by searching for it, and you have to say why. The reason goes
 * into the audit log and into PatientMerge, so a wrong merge next year has
 * something to explain itself with.
 */
function MergePanel({ patientId, mrn, onDone }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [chosen, setChosen] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    setError(null);
    try {
      const { patients } = await api.get(`/api/patients?q=${encodeURIComponent(q)}`);
      setResults(patients.filter(r => r.id !== patientId));
    } catch (err) { setError(err.message); }
  }

  async function merge() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/patients/${patientId}/merge`, { mergedId: chosen.id, reason });
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  }

  if (!open) {
    return (
      <section className="panel panel--quiet">
        <button className="btn btn--quiet btn--inline" type="button" onClick={() => setOpen(true)}>
          This patient has a duplicate record
        </button>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Merge a duplicate into this record</h2>
      <p className="panel__lede">
        The other record is kept and points here, because its number is written
        on a folder somebody will bring to the window. Its visits and documents
        move to this record.
      </p>

      {error && <p className="msg msg--bad">{error}</p>}

      <div className="searchbar">
        <input className="searchbar__input" value={q} placeholder="Find the duplicate by name or number"
               onChange={e => setQ(e.target.value)} />
        <button className="btn btn--inline" type="button" onClick={find}>Find</button>
      </div>

      {results.length > 0 && (
        <ul className="candidates">
          {results.map(r => (
            <li key={r.id}>
              <div>
                <span className="candidates__name">{fullName(r)}</span>
                <span className="mono">{r.mrn}</span>
              </div>
              <label className="candidates__ack">
                <input type="radio" name="merge-target" checked={chosen?.id === r.id}
                       onChange={() => setChosen(r)} />
                This one
              </label>
            </li>
          ))}
        </ul>
      )}

      {chosen && (
        <>
          <p className="msg msg--bad">
            <strong>{fullName(chosen)}</strong> (<span className="mono">{chosen.mrn}</span>) will be merged
            into <span className="mono">{mrn}</span>. This cannot be undone from here.
          </p>
          <label className="field">
            <span>Why are these the same person?</span>
            <input value={reason} onChange={e => setReason(e.target.value)}
                   placeholder="e.g. Same NIN, registered twice on 3 Sept" />
          </label>
          <div className="formfoot__actions">
            <button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--danger btn--inline" type="button"
                    disabled={busy || reason.trim().length < 3} onClick={merge}>
              {busy ? 'Merging…' : 'Merge'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
