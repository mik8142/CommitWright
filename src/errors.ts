// Каталог ошибок. Принцип — никаких молчаливых сбоев: каждый класс ошибки получает
// человекочитаемый текст и рекомендованное действие в UI (Фаза 1).

export type CommitWrightErrorKind =
  | 'cli-not-found' // бинарь не найден (ENOENT) -> [Указать путь] [Как установить]
  | 'auth' // ошибка авторизации
  | 'limit' // исчерпан лимит
  | 'timeout' // вызов не уложился в таймаут
  | 'nonzero-exit' // CLI вернул ненулевой код
  | 'empty-output' // пустой ответ от CLI
  | 'unknown';

/** Ошибка с машинной категорией — по ней errors.ts (Фаза 1) подберёт текст и действия. */
export class CommitWrightError extends Error {
  constructor(
    readonly kind: CommitWrightErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CommitWrightError';
  }
}

// TODO (Фаза 1): сопоставление kind -> { сообщение, действия } и показ через
//   vscode.window.showErrorMessage(msg, ...actions). Сигнатуру ошибки лимита определить опытно.
