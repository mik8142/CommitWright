import * as vscode from 'vscode';
import type { CommitStyle, CommitWrightConfig, MessageMode } from './config';

// Сборка промпта для CLI. Два пути:
//   1) пользователь задал свой шаблон (commitwright.promptTemplate) -> плейсхолдер-движок {$...};
//   2) шаблона нет -> собираем дефолтный промпт из XML-блоков (data/instruction separation,
//      жёсткий output-контракт, формат-правила и пример последними — по ресёрчу: так Claude
//      стабильнее держит формат, особенно слабые модели вроде Haiku).
// Функция чистая (вход — конфиг + diff + файлы, выход — строка) -> легко покрыть unit-тестом.

// Плейсхолдеры для кастомного шаблона: {$diff} {$lang} {$style} {$tags} {$extra} {$files}.
// Теги по стилю — подсказка для кастома и для FORMAT-блоков. scoped/plain без жёсткого энума.
const TAGS_BY_STYLE: Record<CommitStyle, string> = {
  plain: '',
  scoped: '',
  conventional: 'feat, fix, docs, style, refactor, perf, test, build, ci, chore',
  brackets: '[FIX], [NEW FEATURE], [REFACTOR], [DOCS], [TEST], [CHORE]',
};

// Карта локаль VS Code -> человекочитаемое имя языка для промпта. Неизвестную локаль
// не угадываем — отдаём English (явный fallback, как в требованиях).
const LOCALE_TO_LANGUAGE: Record<string, string> = {
  en: 'English',
  ru: 'Russian',
  uk: 'Ukrainian',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  'pt-br': 'Portuguese',
  pl: 'Polish',
  tr: 'Turkish',
  ja: 'Japanese',
  ko: 'Korean',
  zh: 'Chinese',
  'zh-cn': 'Chinese (Simplified)',
  'zh-tw': 'Chinese (Traditional)',
};

// Частые языки для пикера команды selectLanguage. Это лишь подсказки — пользователь
// всегда может ввести своё значение (хоть 'Elvish'), поэтому список не обязан быть полным.
//   native  — как показываем в пикере (название на самом языке);
//   english — что уходит в промпт ({$lang}) и хранится в настройке (стабильное значение).
export interface CommonLanguage {
  native: string;
  english: string;
}

export const COMMON_LANGUAGES: readonly CommonLanguage[] = [
  { native: 'English', english: 'English' },
  { native: 'Русский', english: 'Russian' },
  { native: 'Deutsch', english: 'German' },
  { native: 'Français', english: 'French' },
  { native: 'Español', english: 'Spanish' },
  { native: 'Italiano', english: 'Italian' },
  { native: 'Português', english: 'Portuguese' },
  { native: 'Polski', english: 'Polish' },
  { native: 'Türkçe', english: 'Turkish' },
  { native: '日本語', english: 'Japanese' },
  { native: '한국어', english: 'Korean' },
  { native: '简体中文', english: 'Chinese (Simplified)' },
  { native: '繁體中文', english: 'Chinese (Traditional)' },
];

// Разрешение языка: 'auto' ИЛИ пустая строка -> по vscode.env.language; иначе строка как есть.
export function resolveLanguage(commitLanguage: string, locale: string): string {
  const trimmed = commitLanguage.trim();
  if (trimmed !== '' && trimmed.toLowerCase() !== 'auto') {
    return trimmed;
  }
  const key = locale.toLowerCase();
  return LOCALE_TO_LANGUAGE[key] ?? LOCALE_TO_LANGUAGE[key.split('-')[0]] ?? 'English';
}

// ── XML-блоки дефолтного промпта (по research_commitwright.md) ──────────────────

const BASE = `You are a tool that writes a single git commit message for a staged git diff.
Read the diff below and summarize the PURPOSE of the change — describe WHAT
changed and WHY, never HOW. Never produce a message that just lists the changed
files or restates the diff. If the change is genuinely trivial, still describe it
in purpose terms as concisely as you can (e.g. "Add test fixtures"), but never
invent meaning that isn't there.
In English, use the imperative mood ("Add", "Fix", "Remove" — not "Added"/"Adds").
For other languages, follow the <language> block below, which overrides this mood
rule with that language's own commit conventions. Be specific and concrete;
never invent changes that are not in the diff.`;

const FORMAT_BLOCKS: Record<CommitStyle, string> = {
  plain: `<format>
Write a plain commit message.
- Subject line: capitalized, no trailing period, keep it concise (ideally under
  ~60 characters), never exceed 72.
- Use the subject mood/grammar set by the rules above (English imperative, or the
  language's own convention per the <language> block).
</format>`,
  scoped: `<format>
Write a "scope: summary" commit message (no fixed type vocabulary).
- Subject format: <scope>: <summary>
- scope is a short lowercase noun for the affected area, derived from the diff's
  file paths (a package, module, or subsystem name). If the change spans
  unrelated areas or no single scope fits, omit the scope and the colon.
- summary: no trailing period, concise, never exceed 72 total; use the subject
  mood/grammar set by the rules above (not necessarily a literal imperative).
</format>`,
  conventional: `<format>
Write a Conventional Commits message.
- Subject format: <type>(<optional scope>): <description>
- type is one of: feat, fix, docs, style, refactor, perf, test, build, ci, chore.
- Choose the single type that best matches the diff. Use "feat" for a new
  capability, "fix" for a bug fix; otherwise pick the most specific type.
- scope is optional: a short lowercase noun for the affected area, derived from
  the diff's file paths. If you cannot derive a clear scope, omit it and the
  parentheses entirely.
- description: lowercase, no trailing period, never exceed 72; use the subject
  mood/grammar set by the rules above (not necessarily a literal imperative).
- For a breaking change, append "!" before the colon (e.g. "feat!:") and, if a
  body is allowed, add a "BREAKING CHANGE: <explanation>" footer.
</format>`,
  brackets: `<format>
Write a bracketed-tag commit message.
- Subject format: [TAG] Summary
- TAG is one of: [FIX], [NEW FEATURE], [REFACTOR], [DOCS], [TEST], [CHORE].
  Choose the single tag that best matches the diff.
- Summary: capitalized, no trailing period, never exceed 72 including the tag;
  use the subject mood/grammar set by the rules above (not necessarily a literal
  imperative).
</format>`,
};

const MODE_BLOCKS: Record<MessageMode, string> = {
  subject: `<mode>
Output ONLY the subject line. Do not write a body.
</mode>`,
  subjectBody: `<mode>
Output a subject line, then a blank line, then a body.
- The body explains WHY the change was made and any important context or
  consequences — not a restatement of the diff.
- Wrap the body at 72 characters. Use "-" bullets for multiple distinct points.
- If the change is trivial and self-explanatory, omit the body entirely.
</mode>`,
};

// Полный language-блок (по research_commitwright.md, раздел Localization). Императив —
// английская конвенция; в других языках mood свой, поэтому правило переопределяется здесь.
// Ключевое: переводим прозу, а жаргон (rate limiter, token bucket, API) оставляем английским.
function languageBlock(lang: string): string {
  const example = LANGUAGE_EXAMPLES[lang];
  const exampleBlock = example
    ? `\n<language_example>\n${example}\n</language_example>`
    : '';
  return `<language>
Write the entire commit message in ${lang}. Use the phrasing, mood, and
conventions that native ${lang}-speaking developers actually use in commit
messages — do NOT translate English commit style word for word, and do NOT use a
literal imperative if that is unnatural in ${lang}.
- Keep code identifiers, file paths, API names, and established technical terms
  in their original form (usually English/Latin), e.g. "rate limiter", "token
  bucket", "API", "OAuth". Translate the prose around them, not the jargon.
- Use the subject grammar native ${lang} developers actually use, NOT a literal
  translation of the English imperative. For Russian specifically: use a neutral
  past form / short passive participle ("Добавлена поддержка…", "Исправлена
  обработка ошибок", "Добавлен rate limiter"); do NOT use the infinitive
  ("Добавить…", which reads like a to-do item) and do NOT use a literal
  imperative ("Добавь"). A nominal form ("Поддержка X", "Рефакторинг Y") is also
  fine when no clear action verb fits.
- Keep lines reasonably short, but do not force a hard character wrap for
  non-Latin scripts.
</language>${exampleBlock}`;
}

// Verbatim-примеры коммита на целевом языке (plain-стиль) — сильнейший few-shot рычаг.
// Берём из ресёрча; для языков без примера блок просто опускается (не выдумываем).
// Формы — нативные для каждого языка (не инфинитив-калька английского императива): ru — страд.
// причастие; de/es — 3-е л. наст.; fr — номинатив; ja — 体言止め (действие-существительное в конце).
const LANGUAGE_EXAMPLES: Record<string, string> = {
  Russian: 'Добавлен rate limiter (token bucket) для публичного API',
  German: 'Fügt einen Rate-Limiter (Token-Bucket) für die öffentliche API hinzu',
  Japanese: '公開APIにレートリミッター（トークンバケット）を追加',
  French: "Ajout d'un limiteur de débit (token bucket) pour l'API publique",
  Spanish: 'Añade un limitador de tasa (token bucket) para la API pública',
};

function filesBlock(files: readonly string[]): string {
  return `<changed_files>
${files.join('\n')}
</changed_files>
Do NOT list these file names in the message. Use them only to infer which area
or component the change touches (for the scope), never as the content of the
subject.`;
}

function extraBlock(extra: string): string {
  return `<extra_instructions>
${extra}
</extra_instructions>`;
}

// Пример выходного формата — по стилю и режиму. Few-shot пример: самый надёжный
// рычаг «держать формат» для слабых моделей (по ресёрчу).
const SUBJECT_EXAMPLES: Record<CommitStyle, string> = {
  plain: 'Add retry logic to the upload client',
  scoped: 'upload: retry transient network errors',
  conventional: 'fix(upload): retry transient network errors',
  brackets: '[FIX] Retry transient network errors',
};

const BODY_EXAMPLE = `Network blips were causing whole uploads to fail. Retry transient
errors up to three times with exponential backoff before surfacing
the failure to the caller.`;

function outputBlock(style: CommitStyle, mode: MessageMode): string {
  const subject = SUBJECT_EXAMPLES[style];
  const example = mode === 'subjectBody' ? `${subject}\n\n${BODY_EXAMPLE}` : subject;
  return `<output_rules>
Return ONLY the commit message text. Do not include any preamble, explanation,
greeting, or sign-off. Do not wrap the message in markdown, code fences, or
backticks. Do not surround it in quotes. Do not write "Here is the commit
message". Your entire response is passed directly to \`git commit\`.
</output_rules>

<example>
${example}
</example>`;
}

// Кастомный шаблон пользователя: простая подстановка плейсхолдеров {$...}.
// Неизвестные {$...} остаются как есть (осознанно: видна опечатка, а не молчаливая потеря).
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{$${key}}`).join(value);
  }
  return out;
}

export function buildPrompt(
  cfg: CommitWrightConfig,
  diff: string,
  files: readonly string[] = [],
): string {
  const lang = resolveLanguage(cfg.commitLanguage, vscode.env.language);

  // Путь 1: пользователь задал свой шаблон -> плейсхолдер-движок (обратная совместимость).
  if (cfg.promptTemplate.trim()) {
    const template = cfg.promptTemplate.trim();
    const base = template.includes('{$diff}') ? template : `${template}\n\n<diff>\n{$diff}\n</diff>`;
    return fillTemplate(base, {
      diff,
      lang,
      style: cfg.style,
      tags: TAGS_BY_STYLE[cfg.style],
      extra: cfg.extraInstructions.trim(),
      files: files.join('\n'),
    });
  }

  // Путь 2: дефолт — сборка из XML-блоков. Порядок важен: данные/правила разделены,
  // output-контракт и пример идут последними, diff — в самом конце.
  const parts: string[] = [BASE, FORMAT_BLOCKS[cfg.style], MODE_BLOCKS[cfg.messageMode]];
  if (lang !== 'English') {
    parts.push(languageBlock(lang));
  }
  if (cfg.includeFiles && files.length) {
    parts.push(filesBlock(files));
  }
  if (cfg.extraInstructions.trim()) {
    parts.push(extraBlock(cfg.extraInstructions.trim()));
  }
  parts.push(outputBlock(cfg.style, cfg.messageMode));
  parts.push(`<diff>\n${diff}\n</diff>`);
  return parts.join('\n\n');
}
