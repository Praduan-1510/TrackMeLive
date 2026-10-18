// Copies the shared contract (code/shared/schema/generated/ts/schema.ts) into
// src/shared/ so the functions package compiles and deploys on its own:
// `firebase deploy` uploads only this folder. The copy is gitignored; edit
// code/shared/schema/schema.json and rebuild there instead.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../../shared/schema/generated/ts/schema.ts");
const dest = join(here, "../src/shared/schema.ts");

if (!existsSync(src)) {
  if (existsSync(dest)) {
    console.warn(`sync-schema: ${src} not found; keeping the existing copy`);
    process.exit(0);
  }
  console.error(`sync-schema: ${src} not found. Run code/shared/schema/build.mjs first.`);
  process.exit(1);
}
mkdirSync(dirname(dest), { recursive: true });
copyFileSync(src, dest);
