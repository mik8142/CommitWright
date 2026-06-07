import * as vscode from 'vscode';
import { getActiveRepository, getDiff, getChangedFiles, truncateDiff } from './git';
import type { GitRepository } from './git';
import { getConfig } from './config';
import { buildPrompt } from './prompt';
import { buildInvocation, runCli } from './cli';
import { showError } from './errors';
import { registerEntrypoints } from './entrypoints';
import { registerCommands } from './commands';
import { t } from './i18n';

// CommitWright — генерация Git commit-сообщения из staged-изменений через локальный CLI.
// Поток целиком: diff -> промпт -> CLI -> вставка результата в поле commit-сообщения.

export function activate(context: vscode.ExtensionContext): void {
  // Выставить context-keys точек входа (позиция/видимость) сразу при активации.
  registerEntrypoints(context);
  // Команды выбора языка и модели (QuickPick + свободный ввод).
  registerCommands(context);

  const disposable = vscode.commands.registerCommand('commitwright.generate', async () => {
    try {
      const repo = getActiveRepository();
      if (!repo) {
        vscode.window.showInformationMessage(t('CommitWright: no Git repository found.'));
        return;
      }

      const cfg = getConfig();
      const diff = await getDiff(repo.rootUri.fsPath, cfg.diffSource);
      if (!diff.trim()) {
        const hint =
          cfg.diffSource === 'staged'
            ? t('CommitWright: nothing staged. Stage changes first, or set diffSource to "all".')
            : t('CommitWright: no changes to describe.');
        vscode.window.showInformationMessage(hint);
        return;
      }

      const files = cfg.includeFiles ? await getChangedFiles(repo.rootUri.fsPath, cfg.diffSource) : [];
      const prompt = buildPrompt(cfg, truncateDiff(diff), files);

      const message = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.SourceControl, title: t('Generating commit message…') },
        () => runCli(buildInvocation(cfg), prompt, cfg.timeoutMs),
      );

      // Кладём черновик для ревью: в активную вкладку COMMIT_EDITMSG, если она открыта,
      // иначе — в поле ввода Source Control.
      await insertMessage(repo, message);
    } catch (err) {
      await showError(err);
    }
  });

  context.subscriptions.push(disposable);
}

// Куда положить сгенерированное сообщение. Если активна вкладка COMMIT_EDITMSG (язык git-commit) —
// пишем в неё, сохраняя git-комментарии (строки с '#'): именно из этого файла git берёт сообщение,
// когда коммит редактируется как вкладка. Иначе — в поле ввода Source Control.
async function insertMessage(repo: GitRepository, message: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (editor?.document.languageId === 'git-commit') {
    const doc = editor.document;
    // Тело сообщения для git — всё выше первой строки-комментария ('#' = дефолтный core.commentChar).
    let firstComment = doc.lineCount;
    for (let i = 0; i < doc.lineCount; i++) {
      if (doc.lineAt(i).text.startsWith('#')) {
        firstComment = i;
        break;
      }
    }
    const hasComments = firstComment < doc.lineCount;
    const end = hasComments
      ? new vscode.Position(firstComment, 0)
      : doc.lineAt(doc.lineCount - 1).range.end;
    const range = new vscode.Range(new vscode.Position(0, 0), end);
    // Перед блоком комментариев оставляем пустую строку-разделитель.
    await editor.edit((eb) => eb.replace(range, hasComments ? `${message}\n\n` : message));
    return;
  }
  repo.inputBox.value = message;
}

export function deactivate(): void {}
