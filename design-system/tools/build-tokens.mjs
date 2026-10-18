// Compiles design-system/tokens.json into design-system/tokens.css.
// Usage: node design-system/tools/build-tokens.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(fs.readFileSync(path.join(root, 'tokens.json'), 'utf8'));
const themes = tokens.color.themes.map((t) => t.id);
const first = themes[0];

const valueFor = (t, theme) => (typeof t.value === 'string' ? t.value : t.value[theme] ?? t.value[first]);
const resolve = (v) => v.replace(/^\{(.+)\}$/, 'var(--$1)');
const themed = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])];

const block = (selector, theme, extra = '') =>
  `${selector} {\n${themed.map((t) => `  --${t.name}: ${resolve(valueFor(t, theme))};`).join('\n')}${extra}\n}\n`;

let css = `/* Track Me Live — generated from tokens.json. Do not edit by hand. */\n\n`;
css += block(`:root, [data-theme="${first}"]`, first, '\n  color-scheme: light;');
for (const theme of themes.slice(1)) {
  css += `\n` + block(`[data-theme="${theme}"]`, theme, `\n  color-scheme: ${theme};`);
  css += `\n@media (prefers-color-scheme: ${theme}) {\n` + block(`  :root:not([data-theme])`, theme, `\n  color-scheme: ${theme};`).replace(/\n(?=.)/g, '\n  ') + `}\n`;
}

const plain = [...(tokens.spacing?.tokens ?? []), ...(tokens.radius?.tokens ?? [])];
css += `\n:root {\n${plain.map((t) => `  --${t.name}: ${t.value};`).join('\n')}\n`;
for (const [key, stack] of Object.entries(tokens.type.families)) css += `  --font-${key}: ${stack};\n`;
css += `}\n`;

for (const g of tokens.type.groups) {
  for (const s of g.styles) {
    const fam = s.family ?? g.family;
    css += `\n.${s.name} {\n  font-family: var(--font-${fam});\n  font-size: ${s.fontSize};\n  line-height: ${s.lineHeight};\n  font-weight: ${s.fontWeight};\n  letter-spacing: ${s.letterSpacing ?? 'normal'};\n}\n`;
  }
}

fs.writeFileSync(path.join(root, 'tokens.css'), css);
console.log('wrote tokens.css', css.length, 'bytes');
