import * as vscode from 'vscode';
import { getScmTitlePosition, getEntrypoints, ENTRYPOINT_KEYS } from './config';
import type { CommitWrightConfig } from './config';
import { getActiveRepository, getGitApi } from './git';
import type { GitRepository } from './git';
import { COMMON_LANGUAGES } from './prompt';
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

  // Отслеживаем наличие staged-изменений (для context-key commitwright.hasStaged).
  trackStagedContext(context);

  // Status bar — программная точка входа (не манифест).
  registerStatusBar(context);

  // Slash-триггер «/generate» в поле сообщения — программная точка входа.
  registerSlashTrigger(context);
}

// Держим context-key commitwright.hasStaged актуальным: true, когда в репозитории есть
// проиндексированные (staged) изменения. По нему инлайн-кнопка стоит у «Staged Changes», когда
// staged есть, и у «Changes», когда пусто. Слушаем state.onDidChange каждого репозитория (и новые
// — через onDidOpenRepository): это состояние самого git, а не наша настройка.
function trackStagedContext(context: vscode.ExtensionContext): void {
  const apply = (): void => {
    const repo = getActiveRepository();
    const hasStaged = repo ? repo.state.indexChanges.length > 0 : false;
    void vscode.commands.executeCommand('setContext', 'commitwright.hasStaged', hasStaged);
  };
  apply();

  const api = getGitApi();
  if (!api) {
    return; // git-расширение ещё не активно — ключ останется false до следующего повода
  }
  const hook = (repo: GitRepository): void => {
    context.subscriptions.push(repo.state.onDidChange(apply));
  };
  api.repositories.forEach(hook);
  context.subscriptions.push(
    api.onDidOpenRepository((repo) => {
      hook(repo);
      apply();
    }),
  );
}

// Status bar — программная точка входа: элемент слева с командой генерации. Видимость по настройке
// entrypoints.statusBar (показ/скрытие на лету). В отличие от тулбар-точек, это не when/context-key,
// а прямой show()/hide() самого элемента.
function registerStatusBar(context: vscode.ExtensionContext): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.command = 'commitwright.generate';
  item.text = '$(chat-sparkle) CommitWright';
  item.tooltip = t('Generate commit message with CommitWright');
  context.subscriptions.push(item);

  const apply = (): void => {
    if (getEntrypoints().statusBar) {
      item.show();
    } else {
      item.hide();
    }
  };
  apply();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('commitwright.entrypoints')) {
        apply();
      }
    }),
  );
}

// Slash-триггер — программная точка входа: автодополнение в поле commit-сообщения (язык scminput).
// Печать «/generate» предлагает пункт, выбор которого убирает напечатанный триггер и запускает
// команду генерации. Видимость читаем в момент вызова (getEntrypoints().slashTrigger) — галочка
// действует реактивно без перерегистрации провайдера.
// Пресеты slash-меню: каждый — частичный override, уходящий в команду generate. Композится с
// глобальным конфигом (переопределяет только свои оси: стиль / режим / язык).
const SLASH_PRESETS: ReadonlyArray<{
  cmd: string;
  detail: string;
  override: Partial<CommitWrightConfig>;
}> = [
  { cmd: '/generate', detail: t('default'), override: {} },
  { cmd: '/plain', detail: t('plain subject'), override: { style: 'plain' } },
  { cmd: '/scoped', detail: 'scope: summary', override: { style: 'scoped' } },
  { cmd: '/conventional', detail: 'feat / fix(…)', override: { style: 'conventional' } },
  { cmd: '/brackets', detail: '[FIX] …', override: { style: 'brackets' } },
  { cmd: '/subject', detail: t('subject only'), override: { messageMode: 'subject' } },
  { cmd: '/body', detail: t('subject + body'), override: { messageMode: 'subjectBody' } },
];

function registerSlashTrigger(context: vscode.ExtensionContext): void {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document, position) {
      if (!getEntrypoints().slashTrigger) {
        return [];
      }
      const prefix = document.lineAt(position).text.slice(0, position.character);
      // Только когда «/» — первый непробельный символ поля (не слэш в середине текста сообщения).
      const trimmed = prefix.trimStart();
      if (!trimmed.startsWith('/')) {
        return [];
      }
      const slash = prefix.length - trimmed.length;
      const range = new vscode.Range(position.line, slash, position.line, position.character);
      const generateCmd = (override: Partial<CommitWrightConfig>): vscode.Command => ({
        command: 'commitwright.generate',
        title: 'Generate',
        arguments: [override],
      });

      // Второй уровень: «/lang …» -> список языков, выбор запускает генерацию на этом языке.
      if (/^\/lang\b/.test(trimmed)) {
        return COMMON_LANGUAGES.map((l) => {
          const it = new vscode.CompletionItem(l.english, vscode.CompletionItemKind.Value);
          it.detail = l.native === l.english ? undefined : l.native;
          it.filterText = `/lang ${l.english}`;
          it.insertText = '';
          it.range = range;
          it.command = generateCmd({ commitLanguage: l.english });
          return it;
        });
      }

      // Первый уровень: плоские пресеты форматов + вход в /lang (двухуровневый).
      const items = SLASH_PRESETS.map((p) => {
        const it = new vscode.CompletionItem(p.cmd, vscode.CompletionItemKind.Event);
        it.detail = p.detail;
        it.insertText = '';
        it.range = range;
        it.command = generateCmd(p.override);
        return it;
      });
      const langItem = new vscode.CompletionItem('/lang', vscode.CompletionItemKind.Folder);
      langItem.detail = t('choose language…');
      langItem.insertText = '/lang ';
      langItem.range = range;
      // Не запускаем генерацию — вставляем «/lang » и перевызываем автодополнение (второй уровень).
      langItem.command = { command: 'editor.action.triggerSuggest', title: '' };
      items.push(langItem);
      return items;
    },
  };
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider('scminput', provider, '/'),
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
