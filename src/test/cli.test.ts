import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvocation, classifyExit } from '../cli';
import { CommitWrightError } from '../errors';
import type { CommitWrightConfig } from '../config';

function makeConfig(overrides: Partial<CommitWrightConfig> = {}): CommitWrightConfig {
  return {
    cliPath: 'claude',
    model: '',
    effort: '',
    diffSource: 'auto',
    style: 'plain',
    messageMode: 'subject',
    includeFiles: true,
    commitLanguage: 'English',
    extraInstructions: '',
    promptTemplate: '',
    timeoutMs: 60_000,
    ...overrides,
  };
}

const BASE_ARGS = ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence'];

describe('buildInvocation', () => {
  test('command берётся из cliPath', () => {
    const inv = buildInvocation(makeConfig({ cliPath: '/usr/bin/claude' }));
    assert.equal(inv.command, '/usr/bin/claude');
  });

  test('пустые model/effort -> только базовые флаги', () => {
    const inv = buildInvocation(makeConfig({ model: '', effort: '' }));
    assert.deepEqual(inv.args, BASE_ARGS);
  });

  test('model задан -> добавляется --model <model>', () => {
    const inv = buildInvocation(makeConfig({ model: 'opus' }));
    assert.deepEqual(inv.args, [...BASE_ARGS, '--model', 'opus']);
  });

  test('model обрезается по краям', () => {
    const inv = buildInvocation(makeConfig({ model: '  opus  ' }));
    assert.deepEqual(inv.args, [...BASE_ARGS, '--model', 'opus']);
  });

  test('effort задан -> добавляется --effort <effort>', () => {
    const inv = buildInvocation(makeConfig({ effort: 'low' }));
    assert.deepEqual(inv.args, [...BASE_ARGS, '--effort', 'low']);
  });

  test('model и effort вместе: model идёт перед effort', () => {
    const inv = buildInvocation(makeConfig({ model: 'sonnet', effort: 'high' }));
    assert.deepEqual(inv.args, [...BASE_ARGS, '--model', 'sonnet', '--effort', 'high']);
  });

  test('пробельный model не добавляет флаг', () => {
    const inv = buildInvocation(makeConfig({ model: '   ' }));
    assert.deepEqual(inv.args, BASE_ARGS);
  });
});

describe('classifyExit', () => {
  test('живой текст "Not logged in · Please run /login" -> auth', () => {
    const err = classifyExit(1, 'Not logged in · Please run /login', '');
    assert.equal(err.kind, 'auth');
    assert.ok(err.message.includes('Not logged in'), 'диагностика сохранена в сообщении');
  });

  test('"Invalid API key" -> auth', () => {
    assert.equal(classifyExit(1, '', 'Invalid API key').kind, 'auth');
  });

  test('"not authenticated" -> auth', () => {
    assert.equal(classifyExit(1, 'Error: not authenticated', '').kind, 'auth');
  });

  test('"rate limit" -> limit', () => {
    assert.equal(classifyExit(1, '', 'rate limit exceeded').kind, 'limit');
  });

  test('"usage limit reached" -> limit', () => {
    assert.equal(classifyExit(1, 'usage limit reached', '').kind, 'limit');
  });

  test('произвольная ошибка -> nonzero-exit, текст сохранён', () => {
    const err = classifyExit(2, 'boom', '');
    assert.equal(err.kind, 'nonzero-exit');
    assert.ok(err.message.includes('boom'));
  });

  test('пустые потоки -> nonzero-exit с кодом выхода', () => {
    const err = classifyExit(2, '', '');
    assert.equal(err.kind, 'nonzero-exit');
    assert.ok(err.message.includes('code 2'), 'код выхода в сообщении');
  });

  test('диагностика читается и из stdout, и из stderr', () => {
    // auth-сигнатура только в stdout, stderr пуст — всё равно ловится.
    assert.equal(classifyExit(1, 'please run /login', '').kind, 'auth');
    // и наоборот — только в stderr.
    assert.equal(classifyExit(1, '', 'quota exceeded').kind, 'limit');
  });

  test('возвращает CommitWrightError', () => {
    assert.ok(classifyExit(1, 'boom', '') instanceof CommitWrightError);
  });
});
