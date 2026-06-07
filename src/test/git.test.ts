import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { truncateDiff } from '../git';

const MARKER = '\n\n[... diff truncated by CommitWright: too large ...]';

describe('truncateDiff', () => {
  test('короткий diff (< maxChars) возвращается без изменений', () => {
    assert.equal(truncateDiff('hello', 100), 'hello');
  });

  test('diff ровно на границе (== maxChars) не усекается', () => {
    assert.equal(truncateDiff('abcde', 5), 'abcde');
  });

  test('длинный diff усекается до maxChars и получает маркер', () => {
    const out = truncateDiff('abcdef', 5);
    assert.equal(out, 'abcde' + MARKER);
  });

  test('усечённое тело — ровно первые maxChars символов', () => {
    const out = truncateDiff('abcdefghij', 4);
    assert.ok(out.startsWith('abcd'), 'сохранены первые maxChars');
    assert.ok(!out.startsWith('abcde'), 'не больше maxChars');
    assert.ok(out.includes('truncated'), 'есть пометка об усечении');
  });

  test('пустой diff возвращается как есть', () => {
    assert.equal(truncateDiff('', 100), '');
  });

  test('дефолтный лимит (100k): обычный diff проходит целиком', () => {
    const diff = 'x'.repeat(5_000);
    assert.equal(truncateDiff(diff), diff);
  });

  test('дефолтный лимит (100k): diff больше лимита усекается', () => {
    const out = truncateDiff('x'.repeat(100_001));
    assert.equal(out.length, 100_000 + MARKER.length);
    assert.ok(out.endsWith(MARKER), 'маркер в конце');
  });
});
