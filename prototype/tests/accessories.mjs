// The prototype's accessory matrix (ACC_FOR in js/app.js) equals the models' ACCESSORY_SUPPORT
// (mascots/model/accessories.mjs). No browser.
// node accessories.mjs
import { readFileSync } from 'node:fs';
import { finish } from './finish.mjs';

const block = (src, start) => {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`not found: ${start}`);
  const open = src.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1);
  }
  throw new Error(`unclosed: ${start}`);
};
// eslint-disable-next-line no-new-func
const parse = (obj) => Function(`return (${obj});`)();
const app = readFileSync(new globalThis.URL('../js/app.js', import.meta.url), 'utf8');
const model = readFileSync(new globalThis.URL('../../mascots/model/accessories.mjs', import.meta.url), 'utf8');
const proto = parse(block(app, 'const ACC_FOR ='));
const support = parse(block(model, 'export const ACCESSORY_SUPPORT'));
const checks = [];
const ids = [...new Set([...Object.keys(proto), ...Object.keys(support)])].sort();
for (const id of ids) {
  const a = (proto[id] || []).slice().sort().join(',');
  const b = (support[id] || []).slice().sort().join(',');
  checks.push(`${a === b ? 'PASS' : 'FAIL'} ${id}: prototype [${a}] model [${b}]`);
}
checks.push(`${ids.length === 12 ? 'PASS' : 'FAIL'} twelve characters (${ids.length})`);
console.log(checks.join('\n'));
console.log('no errors');

await finish(checks);
