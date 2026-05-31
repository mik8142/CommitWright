const vscode = require('vscode');
// const { execFile } = require('node:child_process'); // понадобится для getStagedDiff / runCli

/**
 * CommitWright — генерация Git commit-сообщения из staged-изменений через локальный CLI.
 *
 * ЭТО СКЕЛЕТ. Каркас (команда, кнопка в SCM, доступ к git) уже работает —
 * запусти F5 и нажми кнопку-звёздочку в панели Source Control, увидишь тост-заглушку.
 * Бизнес-логика помечена TODO 1..4 — реализуй её ниже.
 *
 * Поток целиком: staged diff -> CLI -> вставить результат в commit input box.
 */

function activate(context) {
  const disposable = vscode.commands.registerCommand('commitwright.generate', async () => {
    try {
      const repo = getActiveRepository();
      if (!repo) {
        vscode.window.showErrorMessage('CommitWright: Git-репозиторий не найден.');
        return;
      }

      // TODO 1: получить diff.
      //   cwd = repo.rootUri.fsPath
      //   источник из настройки commitwright.diffSource: 'staged' -> `git diff --cached`, 'all' -> `git diff HEAD`
      //   реализовать getStagedDiff(cwd) ниже.
      // const diff = await getStagedDiff(repo.rootUri.fsPath);

      // TODO 2: если diff пустой -> showInformationMessage('Нет изменений для коммита') и return.

      // TODO 3: вызвать CLI с промптом + diff, получить текст сообщения.
      //   путь к бинарю — из настройки commitwright.cliPath, модель — commitwright.model.
      //   реализовать runCli(diff) ниже.
      // const message = await runCli(diff);

      // TODO 4: вставить результат в поле commit-сообщения.
      // repo.inputBox.value = message;

      vscode.window.showInformationMessage('CommitWright: каркас на месте. Допиши TODO 1–4.');
    } catch (err) {
      vscode.window.showErrorMessage(`CommitWright: ${err && err.message ? err.message : err}`);
    }
  });

  context.subscriptions.push(disposable);
}

/**
 * Возвращает активный git-репозиторий через встроенное расширение `vscode.git`.
 * Это самая надёжная точка интеграции — не парсим git руками, берём готовый API.
 */
function getActiveRepository() {
  const gitExtension = vscode.extensions.getExtension('vscode.git');
  if (!gitExtension || !gitExtension.isActive) {
    // расширение git может быть ещё не активировано — но обычно активно к моменту клика по SCM
    if (gitExtension && !gitExtension.isActive) {
      // best-effort: не блокируемся, просто вернём undefined и покажем ошибку выше
    }
    return undefined;
  }
  const api = gitExtension.exports.getAPI(1);
  if (!api.repositories.length) return undefined;
  return api.repositories[0]; // TODO (позже): при нескольких репо выбрать активный (по фокусу/последнему)
}

// =====================================================================
// TODO-функции — реализовать ниже.
// =====================================================================

// async function getStagedDiff(cwd) {
//   // обёртка над child_process.execFile('git', ['diff', '--cached'], { cwd, maxBuffer: ... })
//   // вернуть stdout; пустую строку трактовать как "нет изменений".
//   // большой diff НЕ передавать дальше аргументом командной строки — только через stdin.
// }

// async function runCli(diff) {
//   // взять commitwright.cliPath из vscode.workspace.getConfiguration('commitwright')
//   // вызвать CLI в print-режиме, diff передать через stdin, промпт — отдельным аргументом.
//   // Windows: бинарь может быть claude.exe; PATH иногда виден только в login-shell —
//   //   поэтому абсолютный путь из настройки надёжнее.
//   // распарсить stdout (.trim()); подстраховаться от возможной преамбулы.
// }

function deactivate() {}

module.exports = { activate, deactivate };
