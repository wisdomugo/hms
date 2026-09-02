// Prisma 7 configuration.
//
// Assumes prisma and dotenv are installed as devDependencies.
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",

  // NOTE: migrations.path is deliberately NOT set.
  //
  // There are two schemas in this project — the hospital schema and the control
  // plane's — and each needs its own migration history. Left unset, Prisma puts
  // migrations next to whichever schema `--schema` names:
  //
  //   prisma/migrations/           tenant (hospital) databases
  //   prisma/control/migrations/   the control plane
  //
  // Pinning a path here would send both to the same folder, which would apply
  // the control plane's tables to every hospital database.

  datasource: {
    // What the prisma CLI connects to when nothing overrides it: the
    // DEVELOPMENT database.
    //
    // The scripts in api/scripts/ set DATABASE_URL per invocation — to the
    // control plane for control migrations, to each hospital in turn for tenant
    // migrations. Windows cannot do `DATABASE_URL=... npx prisma`, which is why
    // they are Node scripts that spawn with an environment rather than npm
    // one-liners.
    //
    // The RUNNING APPLICATION never uses this. From milestone 02 it builds one
    // client per hospital from the control plane via the driver adapter, which
    // is why schema.prisma has no `url` of its own.
    url: process.env["DATABASE_URL"],
  },
});
