const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsonDir = path.join(root, 'edge-drop-translations');
const i18nDir = path.join(root, 'src', 'i18n');
const localesDir = path.join(i18nDir, 'locales');

const languagesSrc = fs.readFileSync(path.join(i18nDir, 'languages.ts'), 'utf8');
const codes = [...languagesSrc.matchAll(/"code":\s*"([^"]+)"/g)].map((m) => m[1]).filter((code) => code !== 'system');

const varName = (code) => code.replace(/-([a-z])/gi, (_, c) => c.toUpperCase());

function flatten(obj, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') flatten(value, `${prefix}${key}.`, out);
    else out[prefix + key] = value;
  }
  return out;
}

const dicts = {};
for (const code of codes) {
  const file = path.join(jsonDir, `${code}.json`);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(root, file)}`);
    process.exit(1);
  }
  dicts[code] = JSON.parse(fs.readFileSync(file, 'utf8'));
}

const enKeys = Object.keys(flatten(dicts.en));
let incomplete = 0;
for (const code of codes) {
  const flat = flatten(dicts[code]);
  const missing = enKeys.filter((key) => typeof flat[key] !== 'string' || flat[key] === '');
  if (missing.length) {
    incomplete++;
    console.warn(`${code}: ${missing.length} keys missing (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''})`);
  }
}

fs.mkdirSync(localesDir, { recursive: true });
for (const code of codes) {
  const name = varName(code);
  const body = `import type { TranslationKeys } from '../types'\n\nconst ${name}: TranslationKeys = ${JSON.stringify(dicts[code], null, 2)}\n\nexport default ${name}\n`;
  fs.writeFileSync(path.join(localesDir, `${code}.ts`), body, 'utf8');
}
const listed = new Set(codes.map((code) => `${code}.ts`));
for (const file of fs.readdirSync(localesDir)) {
  if (file.endsWith('.ts') && !listed.has(file)) {
    fs.rmSync(path.join(localesDir, file));
    console.log(`Removed ${path.relative(root, path.join(localesDir, file))}`);
  }
}

let index = `import type { TranslationKeys } from './types'\n`;
for (const code of codes) index += `import ${varName(code)} from './locales/${code}'\n`;
index += `\nexport type { TranslationKeys, LanguageMeta } from './types'\nexport { LANGUAGES } from './languages'\n`;
index += `export { ${codes.map(varName).join(', ')} }\n\n`;
index += `export const TRANSLATIONS: Record<string, TranslationKeys> = {\n`;
for (const code of codes) index += `  '${code}': ${varName(code)},\n`;
index += `}\n`;
fs.writeFileSync(path.join(i18nDir, 'translations.ts'), index, 'utf8');

console.log(`Wrote ${codes.length} locale modules to src/i18n/locales and src/i18n/translations.ts${incomplete ? ` (${incomplete} languages incomplete)` : ''}`);
