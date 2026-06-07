import * as vscode from 'vscode';

// Типизированное чтение настроек `commitwright.*`. Один источник истины для всего
// расширения: остальные модули получают готовый объект, а не лезут в getConfiguration сами.

export type DiffSource = 'staged' | 'all' | 'auto';

// Стиль сообщения. По данным ресёрча (research_commitwright.md):
//   plain        — простой императивный subject (дефолт; покрывает большинство репо);
//   scoped       — "scope: summary" без жёсткого энума (~44% реальных репо);
//   conventional — Conventional Commits (feat:/fix:…; ~16%, но любим для changelog/semver);
//   brackets     — [FIX]/[NEW FEATURE]… (нишевый, по запросу автора).
export type CommitStyle = 'plain' | 'scoped' | 'conventional' | 'brackets';

// Режим вывода: только subject или subject + тело.
export type MessageMode = 'subject' | 'subjectBody';

export interface CommitWrightConfig {
  /** Путь к CLI. На Windows надёжнее абсолютный путь (PATH виден не во всех шеллах). */
  cliPath: string;
  /** Переопределение модели; пустая строка — модель по умолчанию у CLI. */
  model: string;
  /** Уровень мышления CLI (--effort): по умолчанию 'high'; пустая строка — дефолт модели. */
  effort: string;
  /** Что отдавать генератору: staged / all / auto. */
  diffSource: DiffSource;
  /** Стиль сообщения. */
  style: CommitStyle;
  /** Режим вывода: только subject или subject+body. */
  messageMode: MessageMode;
  /** Включать ли список изменённых файлов в промпт (помогает выводить scope). */
  includeFiles: boolean;
  /** Язык коммита: 'auto' (по локали VS Code) / пусто или свободная строка ('Russian', 'elvish', …). */
  commitLanguage: string;
  /** Произвольные пользовательские правила, попадают в {$extra}. */
  extraInstructions: string;
  /** Свой шаблон промпта; пустая строка -> встроенный шаблон по умолчанию. */
  promptTemplate: string;
  /** Таймаут вызова CLI в миллисекундах. */
  timeoutMs: number;
}

export function getConfig(): CommitWrightConfig {
  const c = vscode.workspace.getConfiguration('commitwright');
  return {
    cliPath: c.get<string>('cliPath') ?? 'claude',
    model: c.get<string>('model') ?? '',
    effort: c.get<string>('effort') ?? 'high',
    diffSource: c.get<DiffSource>('diffSource') ?? 'auto',
    style: c.get<CommitStyle>('style') ?? 'plain',
    messageMode: c.get<MessageMode>('messageMode') ?? 'subject',
    includeFiles: c.get<boolean>('includeChangedFiles') ?? true,
    commitLanguage: c.get<string>('commitLanguage') ?? 'auto',
    extraInstructions: c.get<string>('extraInstructions') ?? '',
    promptTemplate: c.get<string>('promptTemplate') ?? '',
    timeoutMs: c.get<number>('timeoutMs') ?? 60_000,
  };
}

// Расположение кнопки в тулбаре точки входа (лево/право). Пока одна точка (scm/title);
// в Фазе 2 обобщим на остальные. Читается по требованию, как и прочие настройки.
export type ButtonPosition = 'left' | 'right';

export function getScmTitlePosition(): ButtonPosition {
  const c = vscode.workspace.getConfiguration('commitwright');
  return c.get<ButtonPosition>('position.scmTitle') ?? 'left';
}

// Точки входа: видимость каждой хранится в одном object commitwright.entrypoints с булевыми полями.
// Ключи — единый источник истины (их читают и механика context-keys, и пульт configureEntrypoints).
export const ENTRYPOINT_KEYS = [
  'scmTitle',
  'editorButton',
  'changesInline',
  'panel',
  'slashTrigger',
  'statusBar',
] as const;
export type EntrypointKey = (typeof ENTRYPOINT_KEYS)[number];

// Видимость каждой точки. Подстраховка: отсутствующее поле -> true (показываем), чтобы частично
// заданный пользователем object не «погасил» точки, которых он в settings.json не упоминал.
export function getEntrypoints(): Record<EntrypointKey, boolean> {
  const obj =
    vscode.workspace
      .getConfiguration('commitwright')
      .get<Partial<Record<EntrypointKey, boolean>>>('entrypoints') ?? {};
  const result = {} as Record<EntrypointKey, boolean>;
  for (const key of ENTRYPOINT_KEYS) {
    result[key] = obj[key] ?? true;
  }
  return result;
}
