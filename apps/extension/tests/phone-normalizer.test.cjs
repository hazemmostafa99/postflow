const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const phoneLibrary = require('libphonenumber-js/max');
const libphonenumber = {
  parseDigits: phoneLibrary.parseDigits,
  parsePhoneNumber(value, options) {
    return phoneLibrary.parsePhoneNumber(value, {
      defaultCountry: options.defaultCountry,
      extract: options.extract,
    });
  },
};

function normalizeCandidates(candidates) {
  const source = readFileSync(resolve(__dirname, '../src/phone-collector/phone-normalizer.ts'), 'utf8');
  const compiled = ts.transpile(source, {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.None,
  });
  const context = vm.createContext({ libphonenumber, candidates });
  vm.runInContext(`${compiled}\nglobalThis.result = normalizeAndDeduplicatePhoneCandidates(candidates);`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('excludes invalid candidates from the phone review list', () => {
  const result = normalizeCandidates([
    { id: 'valid', raw: '01001234567', origin: 'visible-text' },
    { id: 'invalid', raw: '123', origin: 'visible-text' },
  ]);

  assert.deepEqual(result.numbers, [
    {
      id: 'valid',
      raw: '01001234567',
      value: '+201001234567',
      normalized: '+201001234567',
      status: 'valid',
      selected: true,
    },
  ]);
  assert.deepEqual(result.summary, {
    found: 2,
    valid: 1,
    duplicates: 0,
    invalid: 1,
  });
});
