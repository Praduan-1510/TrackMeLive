// Checks design-system.json against the files on disk.
// Every registered asset must exist in its group's folder with the size the registry lists, each group's
// order must match its files, docs.readme must point at a real file, and every image in a registered
// folder must be registered. Blob ids aren't checked against content (they are upload ids, not hashes);
// a missing blob id is reported as a warning, since it means the file still has to be uploaded.
// Usage: node design-system/tools/check-registry.mjs   Exits 1 on any mismatch.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ds = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(path.join(ds, '..'), p);

// Where each asset group's files live, relative to design-system/.
const GROUP_DIRS = {
  Brand: '../brand/logo',
  Mascots: 'assets/Mascots',
  'Mascot colors': 'assets/Mascots/colors',
  'Mascot accessories': 'assets/Mascots/accessories',
};
const TYPES = { '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

const reg = JSON.parse(fs.readFileSync(path.join(ds, 'design-system.json'), 'utf8'));
const errors = [];
const warnings = [];
let entries = 0;

const readme = reg.docs?.readme;
if (!readme || !fs.existsSync(path.join(ds, readme))) errors.push(`docs.readme: "${readme}" is not a file next to design-system.json`);

const groups = reg.groups ?? [];
for (const g of groups) if (!reg.assetGroups?.[g]) errors.push(`groups lists "${g}", but assetGroups has no such group`);
for (const g of Object.keys(reg.assetGroups ?? {})) if (!groups.includes(g)) errors.push(`assetGroups has "${g}", but groups doesn't list it`);

const blobs = new Map();
for (const [name, group] of Object.entries(reg.assetGroups ?? {})) {
  const dirRel = GROUP_DIRS[name];
  if (!dirRel) {
    errors.push(`${name}: no folder mapped in GROUP_DIRS (tools/check-registry.mjs)`);
    continue;
  }
  const dir = path.join(ds, dirRel);
  const files = group.files ?? {};
  for (const [key, f] of Object.entries(files)) {
    entries++;
    const where = `${name}/${key}`;
    if (f.name !== key) errors.push(`${where}: name is "${f.name}"`);
    const file = path.join(dir, key);
    if (!fs.existsSync(file)) {
      errors.push(`${where}: no file at ${rel(file)}`);
      continue;
    }
    const size = fs.statSync(file).size;
    if (f.size !== size) errors.push(`${where}: size ${f.size} B in the registry, ${size} B on disk (${rel(file)})`);
    const type = TYPES[path.extname(key).toLowerCase()];
    if (type && f.type !== type) errors.push(`${where}: type "${f.type}", expected "${type}"`);
    if (!/^[0-9a-f]{32}$/.test(f.blob ?? '')) warnings.push(`${where}: no blob id yet; upload the file and set it`);
    else if (blobs.has(f.blob)) warnings.push(`${where}: same blob id as ${blobs.get(f.blob)}`);
    else blobs.set(f.blob, where);
  }
  const order = group.order ?? [];
  const seen = new Set();
  for (const k of order) {
    if (seen.has(k)) errors.push(`${name}: "${k}" appears twice in order`);
    seen.add(k);
    if (!files[k]) errors.push(`${name}: order lists "${k}", which has no entry`);
  }
  for (const k of Object.keys(files)) if (!seen.has(k)) errors.push(`${name}: "${k}" is missing from order`);
  if (fs.existsSync(dir)) {
    for (const k of fs.readdirSync(dir)) {
      if (TYPES[path.extname(k).toLowerCase()] && fs.statSync(path.join(dir, k)).isFile() && !files[k]) {
        errors.push(`${name}: ${rel(path.join(dir, k))} is on disk but not registered`);
      }
    }
  } else errors.push(`${name}: folder ${rel(dir)} doesn't exist`);
}

for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`error    ${e}`);
console.log(`${entries} entries in ${Object.keys(reg.assetGroups ?? {}).length} groups: ${errors.length} error(s), ${warnings.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
