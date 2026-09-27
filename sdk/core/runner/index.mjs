import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseString, validate } from '../../typescript/dist/index.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixtures = join(root, 'fixtures');
const sdkReference = await import('../../typescript/dist/index.js').catch((error) => {
  throw new Error(`TypeScript reference build is required: ${error.message}`);
});
void sdkReference;

const files = (await readdir(fixtures)).filter((name) => name.endsWith('.mam.md')).sort();
let failed = 0;
for (const file of files) {
  const expectedPath = join(fixtures, `${file.slice(0, -'.mam.md'.length)}.expected.json`);
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'));
  const source = await readFile(join(fixtures, file), 'utf8');
  let module;
  let result = null;
  let parseError = null;
  try {
    module = parseString(source, { filePath: file });
    result = validate(module);
  } catch (error) {
    parseError = error;
  }
  const parseOkay = expected.parse ? Boolean(module) : !module;
  const validationOkay = !expected.parse || (result !== null && result.is_valid === expected.validate_clean);
  const actual = (result?.diagnostics ?? []).map(({ code, severity }) => ({ code, severity }));
  const diagnosticsOkay = !expected.parse || sameDiagnostics(actual, expected.diagnostics ?? []);
  const okay = parseOkay && validationOkay && diagnosticsOkay;
  if (!okay) {
    failed += 1;
    console.error(`FAIL ${file}`);
    if (parseError) console.error(`  parse: ${parseError.message}`);
    if (result) console.error(`  actual: ${JSON.stringify(actual)}`);
  } else {
    console.log(`PASS ${file}`);
  }
}
console.log(`${files.length - failed}/${files.length} fixtures passed`);
process.exitCode = failed === 0 ? 0 : 1;

function sameDiagnostics(actual, expected) {
  const key = (item) => `${item.code}:${item.severity}`;
  const left = actual.map(key).sort();
  const right = expected.map(key).sort();
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
