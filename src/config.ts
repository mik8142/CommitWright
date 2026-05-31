import * as vscode from 'vscode';

// Типизированное чтение настроек `commitwright.*`. Один источник истины для всего
// расширения: остальные модули получают готовый объект, а не лезут в getConfiguration сами.

export type DiffSource = 'staged' | 'all' | 'auto';

// Заложено на будущее (Фаза 1): conventional — по умолчанию, plain — простой текст,
// brackets — теги вида [FIX] (наполним позже).
export type CommitStyle = 'conventional' | 'brackets' | 'plain';

export interface CommitWrightConfig {
  /** Путь к CLI. На Windows надёжнее абсолютный путь (PATH виден не во всех шеллах). */
  cliPath: string;
  /** Переопределение модели; пустая строка — модель по умолчанию у CLI. */
  model: string;
  /** Что отдавать генератору: только staged или все отслеживаемые изменения. */
  diffSource: DiffSource;
  /** Стиль сообщения: conventional / brackets / plain. Влияет на {$tags} в промпте. */
  style: CommitStyle;
  /** Язык коммита: 'auto' (по локали VS Code) или свободная строка ('Russian', 'elvish', …). */
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
    diffSource: c.get<DiffSource>('diffSource') ?? 'auto',
    style: c.get<CommitStyle>('style') ?? 'conventional',
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
  return c.get<ButtonPosition>('position.scmTitle') ?? 'right';
}
