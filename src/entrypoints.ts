import * as vscode from 'vscode';
import { getScmTitlePosition, getEntrypoints, ENTRYPOINT_KEYS } from './config';
import { t } from './i18n';

// Точки входа (entry points) и управление их видимостью/расположением.
//
// Порядок кнопок в тулбар-меню статичен в манифесте (group@order), в рантайме его не сдвинуть.
// Поэтому позицию задаём переключением видимости между двумя заранее объявленными вкладами одной
// команды (navigation@-100 / navigation@100): настройка commitwright.position.* -> setContext ->
// when каждого вклада. Это реактивно — меняется на лету, без перезагрузки окна.

// Настройки, которые нельзя применить на лету и которые требуют перезагрузки окна.
// Цель архитектуры — держать список пустым (всё реактивно либо читается в момент вызова команды).
// Пока пуст: ни одна наша настройка перезагрузки не требует.
const RELOAD_REQUIRED_KEYS: readonly string[] = [];

export function registerEntrypoints(context: vscode.ExtensionContext): void {
  // Выставить context-keys сразу при активации. Важно: активация ранняя (onStartupFinished),
  // иначе до неё ключ не выставлен -> обе записи when ложны -> кнопки нет -> клик не активирует.
  applyContextKeys();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('commitwright.position') ||
        e.affectsConfiguration('commitwright.entrypoints')
      ) {
        applyContextKeys();
      }
      maybePromptReload(e);
    }),
  );
}

// Один источник истины = настройки: читаем их и транслируем в context-keys для when.
function applyContextKeys(): void {
  // Позиция тулбар-кнопки (лево/право) — выбирает между двумя scm/title-вкладами.
  void vscode.commands.executeCommand(
    'setContext',
    'commitwright.pos.scmTitle',
    getScmTitlePosition(),
  );
  // Видимость каждой точки входа: commitwright.show.<key> -> when соответствующего вклада.
  const entrypoints = getEntrypoints();
  for (const key of ENTRYPOINT_KEYS) {
    void vscode.commands.executeCommand('setContext', `commitwright.show.${key}`, entrypoints[key]);
  }
}

// Если изменилась настройка из списка «требует reload» — предложить перезагрузку окна.
// Пока список пуст, поэтому функция фактически no-op; инфраструктура готова на будущее.
function maybePromptReload(e: vscode.ConfigurationChangeEvent): void {
  if (!RELOAD_REQUIRED_KEYS.some((key) => e.affectsConfiguration(key))) {
    return;
  }
  const reload = t('Reload Window');
  void vscode.window
    .showInformationMessage(t('CommitWright: this change applies after a window reload.'), reload)
    .then((choice) => {
      if (choice === reload) {
        void vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
    });
}
