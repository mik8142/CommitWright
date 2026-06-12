import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Страховка локализации манифеста: каждый %ключ% из package.json обязан существовать
// в обоих словарях package.nls*.json, словари — не содержать осиротевших ключей,
// совпадать по набору (en — fallback для прочих локалей) и не иметь пустых значений.

const root = path.resolve(__dirname, '..', '..');
const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
const en = JSON.parse(
  fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'),
) as Record<string, string>;
const ru = JSON.parse(
  fs.readFileSync(path.join(root, 'package.nls.ru.json'), 'utf8'),
) as Record<string, string>;

const used = new Set([...manifest.matchAll(/%([\w.-]+)%/g)].map((m) => m[1]));

describe('package.nls: консистентность ключей локализации', () => {
  test('манифест ссылается хотя бы на один NLS-ключ (regex жив)', () => {
    assert.ok(used.size > 0, 'в package.json не найдено ни одного %ключа%');
  });

  test('каждый %ключ% манифеста есть в package.nls.json (en, fallback)', () => {
    const missing = [...used].filter((k) => !(k in en));
    assert.deepEqual(missing, []);
  });

  test('каждый %ключ% манифеста есть в package.nls.ru.json', () => {
    const missing = [...used].filter((k) => !(k in ru));
    assert.deepEqual(missing, []);
  });

  test('в en-словаре нет осиротевших ключей (всё используется манифестом)', () => {
    const orphans = Object.keys(en).filter((k) => !used.has(k));
    assert.deepEqual(orphans, []);
  });

  test('наборы ключей en и ru идентичны', () => {
    assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  });

  test('значения словарей непустые', () => {
    const empty = [...Object.entries(en), ...Object.entries(ru)]
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    assert.deepEqual(empty, []);
  });
});
