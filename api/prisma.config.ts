// Prisma 7 configuration.
//
// Assumes prisma and dotenv are installed as devDependencies.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    // No seed script yet. Step 4 adds one for Role and Permission, and it is
    // the seed — not a hand-written INSERT — that becomes the definition of
    // what roles a fresh hospital starts with.
    // seed: "node prisma/seed.js",
  },
  datasource: {
    // The DEVELOPMENT connection string, and the database the control plane
    // itself lives in.
    //
    // This is what the prisma CLI uses: `migrate dev`, `migrate deploy`,
    // `studio`. It is NOT how the running application connects — from step 2
    // the app builds one client per hospital from the control plane, via the
    // driver adapter, which is why schema.prisma has no `url` of its own.
    //
    // scripts/migrate-all.mjs will override this per tenant when it loops.
    url: process.env["DATABASE_URL"],
  },
});
