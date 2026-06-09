import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { resolveLanguage, buildPrompt } from '../prompt';
import type { CommitWrightConfig } from '../config';

// Полный конфиг с нейтральными дефолтами; тест переопределяет только то, что проверяет.
// commitLanguage='English' по умолчанию -> не зависим от env-локали (её проверяем отдельно).
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

describe('resolveLanguage', () => {
  test('явный язык возвращается как есть', () => {
    assert.equal(resolveLanguage('German', 'en'), 'German');
  });

  test('явный язык обрезается по краям', () => {
    assert.equal(resolveLanguage('  German  ', 'en'), 'German');
  });

  test("'auto' -> язык по локали", () => {
    assert.equal(resolveLanguage('auto', 'ru'), 'Russian');
  });

  test('пустая строка -> язык по локали', () => {
    assert.equal(resolveLanguage('', 'de'), 'German');
  });

  test("'auto' регистронезависим", () => {
    assert.equal(resolveLanguage('AUTO', 'fr'), 'French');
  });

  test('локаль регистронезависима', () => {
    assert.equal(resolveLanguage('auto', 'RU'), 'Russian');
  });

  test('неизвестная локаль -> English (явный fallback)', () => {
    assert.equal(resolveLanguage('auto', 'xx'), 'English');
  });

  test('локаль с регионом матчится по полному ключу (pt-br)', () => {
    assert.equal(resolveLanguage('auto', 'pt-br'), 'Portuguese');
  });

  test('локаль с регионом без полного ключа -> fallback на базовый язык (de-AT)', () => {
    assert.equal(resolveLanguage('auto', 'de-AT'), 'German');
  });
});

describe('buildPrompt — дефолтный шаблон', () => {
  test('plain/subject: базовый блок, формат plain, режим subject, output-контракт', () => {
    const out = buildPrompt(makeConfig({ style: 'plain', messageMode: 'subject' }), 'DIFF_BODY');
    assert.ok(out.includes('writes a single git commit message'), 'есть BASE');
    assert.ok(out.includes('Write a plain commit message.'), 'формат plain');
    assert.ok(out.includes('Output ONLY the subject line.'), 'режим subject');
    assert.ok(out.includes('<output_rules>'), 'есть output_rules');
  });

  test('diff кладётся последним блоком, обёрнут в <diff>', () => {
    const out = buildPrompt(makeConfig(), 'DIFF_BODY');
    assert.ok(out.includes('<diff>\nDIFF_BODY\n</diff>'), 'diff внутри тегов');
    assert.ok(out.trimEnd().endsWith('</diff>'), 'diff — в самом конце промпта');
  });

  test('conventional/subjectBody: тип-блок и инструкция тела', () => {
    const out = buildPrompt(
      makeConfig({ style: 'conventional', messageMode: 'subjectBody' }),
      'DIFF_BODY',
    );
    assert.ok(out.includes('Write a Conventional Commits message.'), 'формат conventional');
    assert.ok(out.includes('then a blank line, then a body'), 'режим subjectBody');
  });

  test('includeFiles=true + файлы -> блок changed_files со списком', () => {
    const out = buildPrompt(makeConfig({ includeFiles: true }), 'DIFF_BODY', [
      'src/a.ts',
      'src/b.ts',
    ]);
    assert.ok(out.includes('<changed_files>'), 'есть блок');
    assert.ok(out.includes('src/a.ts'), 'есть путь файла');
  });

  test('includeFiles=false -> блока changed_files нет даже при наличии файлов', () => {
    const out = buildPrompt(makeConfig({ includeFiles: false }), 'DIFF_BODY', ['src/a.ts']);
    assert.ok(!out.includes('<changed_files>'), 'блока нет');
  });

  test('пустой список файлов -> блока changed_files нет', () => {
    const out = buildPrompt(makeConfig({ includeFiles: true }), 'DIFF_BODY', []);
    assert.ok(!out.includes('<changed_files>'), 'блока нет');
  });

  test('extraInstructions -> блок extra_instructions с текстом', () => {
    const out = buildPrompt(makeConfig({ extraInstructions: 'Always mention the ticket' }), 'D');
    assert.ok(out.includes('<extra_instructions>'), 'есть блок');
    assert.ok(out.includes('Always mention the ticket'), 'есть текст');
  });

  test('English не добавляет language-блок', () => {
    const out = buildPrompt(makeConfig({ commitLanguage: 'English' }), 'D');
    // Маркер — уникальная фраза блока, а НЕ тег '<language>': само слово '<language>'
    // встречается в прозе BASE ("follow the <language> block below"), поэтому тег ненадёжен.
    assert.ok(!out.includes('Write the entire commit message in'), 'для английского блока нет');
  });

  test('не-английский язык -> language-блок + verbatim-пример', () => {
    const out = buildPrompt(makeConfig({ commitLanguage: 'Russian' }), 'D');
    assert.ok(out.includes('Write the entire commit message in Russian'), 'есть language-блок');
    assert.ok(out.includes('Добавлен rate limiter'), 'есть few-shot пример из ресёрча');
  });

  test('язык без примера -> language-блок есть, блока примера нет', () => {
    const out = buildPrompt(makeConfig({ commitLanguage: 'Klingon' }), 'D');
    assert.ok(out.includes('Write the entire commit message in Klingon'), 'language-блок есть');
    assert.ok(!out.includes('<language_example>'), 'блока примера нет (пример не выдумываем)');
  });

  test('новые языки ko/tr дают few-shot пример (SOV, действие в конце)', () => {
    const ko = buildPrompt(makeConfig({ commitLanguage: 'Korean' }), 'D');
    assert.ok(ko.includes('추가'), 'корейский: действие 추가 в конце');
    const tr = buildPrompt(makeConfig({ commitLanguage: 'Turkish' }), 'D');
    assert.ok(tr.includes('eklendi'), 'турецкий: SOV-хвост eklendi');
  });

  test('китайские ключи матчатся точно; Traditional отличается глифом (为/為)', () => {
    // Ключи с региональным суффиксом должны 1:1 совпадать с выводом resolveLanguage,
    // иначе few-shot молча пропадёт. Голый Chinese даём упрощённым.
    const hans = buildPrompt(makeConfig({ commitLanguage: 'Chinese (Simplified)' }), 'D');
    assert.ok(hans.includes('为公共 API 添加限流器'), 'упрощённый: 为');
    const hant = buildPrompt(makeConfig({ commitLanguage: 'Chinese (Traditional)' }), 'D');
    assert.ok(hant.includes('為公共 API 添加限流器'), 'традиционный: 為');
    const bare = buildPrompt(makeConfig({ commitLanguage: 'Chinese' }), 'D');
    assert.ok(bare.includes('为公共 API 添加限流器'), 'голый Chinese = упрощённый');
  });
});

describe('buildPrompt — авто-локаль из vscode.env.language', () => {
  test("commitLanguage='auto' берёт язык из env.language", () => {
    const original = vscode.env.language;
    try {
      (vscode.env as { language: string }).language = 'ru';
      const out = buildPrompt(makeConfig({ commitLanguage: 'auto' }), 'D');
      assert.ok(
        out.includes('Write the entire commit message in Russian'),
        'язык выведен из локали ru',
      );
    } finally {
      (vscode.env as { language: string }).language = original;
    }
  });
});

describe('buildPrompt — кастомный promptTemplate', () => {
  test('плейсхолдеры {$diff}/{$lang}/{$style} подставляются', () => {
    const tpl = 'LANG={$lang} STYLE={$style}\n<diff>{$diff}</diff>';
    const out = buildPrompt(
      makeConfig({ promptTemplate: tpl, commitLanguage: 'German', style: 'scoped' }),
      'DIFF_BODY',
    );
    assert.ok(out.includes('LANG=German'), 'lang подставлен');
    assert.ok(out.includes('STYLE=scoped'), 'style подставлен');
    assert.ok(out.includes('DIFF_BODY'), 'diff подставлен');
    assert.ok(!out.includes('Write a plain commit message.'), 'дефолтные блоки не примешаны');
  });

  test('шаблон без {$diff} -> diff дописывается автоматически', () => {
    const out = buildPrompt(
      makeConfig({ promptTemplate: 'Just summarize the change.' }),
      'DIFF_BODY',
    );
    assert.ok(out.includes('Just summarize the change.'), 'шаблон на месте');
    assert.ok(out.includes('<diff>\nDIFF_BODY\n</diff>'), 'diff добавлен сам');
  });
});
