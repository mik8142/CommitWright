import * as vscode from 'vscode';
import { t } from './i18n';

// Каталог ошибок. Принцип — никаких молчаливых сбоев: каждый класс ошибки получает
// человекочитаемый текст и рекомендованное действие в UI.

export type CommitWrightErrorKind =
  | 'cli-not-found' // бинарь не найден (ENOENT) -> [Open Settings] [How to install]
  | 'auth' // ошибка авторизации
  | 'limit' // исчерпан лимит
  | 'timeout' // вызов не уложился в таймаут
  | 'nonzero-exit' // CLI вернул ненулевой код
  | 'empty-output' // пустой ответ от CLI
  | 'unknown';

/** Ошибка с машинной категорией — по ней showError подбирает текст и действия. */
export class CommitWrightError extends Error {
  constructor(
    readonly kind: CommitWrightErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'CommitWrightError';
  }
}

// Документ по установке CLI — показываем при cli-not-found.
const INSTALL_DOC_URL = 'https://docs.claude.com/en/docs/claude-code/overview';
// Документ про вход — показываем при auth (не выполнен `claude /login`).
const SIGNIN_DOC_URL = 'https://docs.claude.com/en/docs/claude-code/setup';

// Человекочитаемый текст по категории. detail (например stderr) добавляем отдельной строкой.
function describe(kind: CommitWrightErrorKind): string {
  switch (kind) {
    case 'cli-not-found':
      return t('CommitWright: the CLI was not found. Set its path in settings or install it.');
    case 'auth':
      return t('CommitWright: the CLI is not authenticated. Sign in to your Claude CLI and try again.');
    case 'limit':
      return t('CommitWright: usage limit reached. Try again later.');
    case 'timeout':
      return t('CommitWright: the request timed out. Try again or raise the timeout in settings.');
    case 'nonzero-exit':
      return t('CommitWright: the CLI exited with an error.');
    case 'empty-output':
      return t('CommitWright: the CLI returned an empty response.');
    default:
      return t('CommitWright: something went wrong.');
  }
}

// Показать ошибку с уместными действиями. Действия зависят от категории.
// detail (например stderr) подклеиваем в текст: в обычном (не модальном) тосте
// поле detail не отображается, а терять причину нельзя (принцип «никаких молчаливых ошибок»).
export async function showError(err: unknown): Promise<void> {
  const kind: CommitWrightErrorKind = err instanceof CommitWrightError ? err.kind : 'unknown';
  const detail = err instanceof Error ? err.message : String(err);
  const message = describe(kind);
  const full = detail ? `${message}\n${truncate(detail, 300)}` : message;

  const openSettings = t('Open Settings');
  const howToInstall = t('How to install');
  const howToSignIn = t('How to sign in');

  let actions: string[] = [];
  if (kind === 'cli-not-found') {
    actions = [openSettings, howToInstall];
  } else if (kind === 'auth') {
    actions = [howToSignIn];
  } else if (kind === 'timeout') {
    actions = [openSettings];
  }

  const choice = await vscode.window.showErrorMessage(full, ...actions);
  if (choice === openSettings) {
    void vscode.commands.executeCommand('workbench.action.openSettings', 'commitwright');
  } else if (choice === howToInstall) {
    void vscode.env.openExternal(vscode.Uri.parse(INSTALL_DOC_URL));
  } else if (choice === howToSignIn) {
    void vscode.env.openExternal(vscode.Uri.parse(SIGNIN_DOC_URL));
  }
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max) + '…';
}
