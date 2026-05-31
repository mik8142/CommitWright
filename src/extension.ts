import * as vscode from 'vscode';
import { getActiveRepository } from './git';
import { registerEntrypoints } from './entrypoints';

// CommitWright — генерация Git commit-сообщения из staged-изменений через локальный CLI.
// Поток целиком: diff -> CLI -> вставка результата в поле commit-сообщения.
// Каркас (команда + кнопка в SCM + доступ к git) работает; бизнес-логика — TODO Фазы 1.

export function activate(context: vscode.ExtensionContext): void {
  // Выставить context-keys точек входа (позиция/видимость) сразу при активации.
  registerEntrypoints(context);

  const disposable = vscode.commands.registerCommand('commitwright.generate', async () => {
    try {
      const repo = getActiveRepository();
      if (!repo) {
        vscode.window.showErrorMessage('CommitWright: Git-репозиторий не найден.');
        return;
      }

      // TODO 1 (Фаза 1): const diff = await getDiff(repo.rootUri.fsPath, cfg.diffSource)
      // TODO 2 (Фаза 1): пустой diff -> showInformationMessage(...) и return
      // TODO 3 (Фаза 1): const message = await runCli(buildInvocation(cfg), diff)  (промпт из prompt.ts)
      // TODO 4 (Фаза 1): repo.inputBox.value = message

      vscode.window.showInformationMessage(
        'CommitWright: каркас на TypeScript. Логика генерации — TODO Фазы 1.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`CommitWright: ${message}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
