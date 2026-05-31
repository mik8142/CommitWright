import * as vscode from 'vscode';
import type { CommitStyle, CommitWrightConfig } from './config';

// Сборка промпта для CLI. Шаблон с плейсхолдерами вида {$name} — синтаксис задан явно,
// чтобы пользователь мог переписать промпт целиком (настройка commitwright.promptTemplate)
// и при этом ссылаться на динамические части. Поддерживаемые плейсхолдеры:
//   {$diff}  — сам diff (если в шаблоне его нет, добавляется в конец автоматически);
//   {$lang}  — язык сообщения (из commitLanguage; 'auto' -> человекочитаемый язык локали);
//   {$style} — стиль (conventional/brackets/plain);
//   {$tags}  — список допустимых тегов, выведенный из стиля;
//   {$extra} — произвольные правила пользователя (extraInstructions).
// Функция чистая (вход — конфиг + diff, выход — строка) -> легко покрыть unit-тестом.

// Теги, выводимые из стиля. brackets-теги — заглушка-набросок (наполним позже, тезис №6).
const TAGS_BY_STYLE: Record<CommitStyle, string> = {
  conventional: 'feat, fix, docs, refactor, perf, test, build, ci, chore, style',
  brackets: '[FIX], [NEW FEATURE], [REFACTOR], [DOCS], [TEST], [CHORE]',
  plain: '',
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
// Разделение ролей: видим родное название, в промпт идёт чистый английский. Поиск в пикере
// матчит по обоим (native через label, english через description + matchOnDescription).
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
// Пустую трактуем как auto осознанно: пользователь может очистить поле настройки, ожидая
// «вернуть по умолчанию» — это и есть auto, а не «писать на пустом языке».
export function resolveLanguage(commitLanguage: string, locale: string): string {
  const trimmed = commitLanguage.trim();
  if (trimmed !== '' && trimmed.toLowerCase() !== 'auto') {
    return trimmed;
  }
  const key = locale.toLowerCase();
  return LOCALE_TO_LANGUAGE[key] ?? LOCALE_TO_LANGUAGE[key.split('-')[0]] ?? 'English';
}

// ВРЕМЕННЫЙ дефолтный промпт. Будет заменён выверенным текстом (ресёрч Миши) — менять
// только эту константу, движок подстановок трогать не нужно. Требование к ответу:
// ТОЛЬКО текст сообщения, без преамбулы и без ```-ограждений.
export const DEFAULT_TEMPLATE = `You are a Git commit message generator.
Write a commit message for the staged changes shown in the diff below.

Requirements:
- Style: {$style}. Allowed type tags: {$tags}.
- Write the message in {$lang}.
- First line is a concise subject (<= 72 characters), imperative mood, no trailing period.
- If helpful, add a blank line and a short body explaining what changed and why.
- Output ONLY the commit message. No preamble, no explanation, no code fences.
{$extra}

Diff:
{$diff}`;

// Подстановка плейсхолдеров. Простая замена по карте; неизвестные {$...} остаются как есть
// (это осознанно: пользователь увидит опечатку в своём шаблоне, а не молчаливое исчезновение).
function fillTemplate(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{$${key}}`).join(value);
  }
  return out;
}

export function buildPrompt(cfg: CommitWrightConfig, diff: string): string {
  const template = cfg.promptTemplate.trim() || DEFAULT_TEMPLATE;
  const lang = resolveLanguage(cfg.commitLanguage, vscode.env.language);
  const extra = cfg.extraInstructions.trim() ? `\nExtra instructions: ${cfg.extraInstructions.trim()}` : '';

  // Если в шаблоне нет {$diff} — diff не потеряется: добавим его в конец.
  const hasDiffPlaceholder = template.includes('{$diff}');
  const base = hasDiffPlaceholder ? template : `${template}\n\nDiff:\n{$diff}`;

  return fillTemplate(base, {
    diff,
    lang,
    style: cfg.style,
    tags: TAGS_BY_STYLE[cfg.style],
    extra,
  });
}
