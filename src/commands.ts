import * as vscode from 'vscode';
import { COMMON_LANGUAGES, resolveLanguage } from './prompt';
import type { CommonLanguage } from './prompt';
import { COMMON_MODELS } from './cli';
import type { CommonModel } from './cli';
import { t } from './i18n';
import { ENTRYPOINT_KEYS } from './config';
import type { EntrypointKey } from './config';

// Пользовательские команды поверх главной commitwright.generate.
// Сейчас здесь selectLanguage и selectModel; в Фазе 2 сюда добавится configureEntrypoints.

interface ComboItem extends vscode.QuickPickItem {
  value?: string; // значение для сохранения; undefined у разделителя
  isCustom?: boolean; // живой пункт «использовать введённый текст»
}

interface ComboPickOptions {
  settingKey: string; // ключ настройки commitwright.* (источник истины)
  title: string;
  placeholder: string;
  successMessage: (value: string) => string;
  /** Пункт «Auto» сверху: его value ('auto' или '') и описание. */
  auto: { value: string; description: string };
  /** Готовые пункты-подсказки (без Auto). */
  choices: ComboItem[];
  /** Тексты, по которым ищется совпадение с известным выбором (для показа custom-пункта). */
  knownMatches: (typed: string) => boolean;
}

// Общий движок комбобокса «выбери из списка ИЛИ введи своё». Сделан на низкоуровневом
// createQuickPick (а не showQuickPick), потому что нужен живой пункт «использовать свой
// текст», который НЕ исчезает при вводе неизвестного значения (showQuickPick его отфильтровал
// бы — тупик). Источник истины один — настройка; туда же пишем результат (Global: это
// личные преференции пользователя). Возвращает true, если значение записано.
async function pickValueWithCustom(opts: ComboPickOptions): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('commitwright');
  const current = (cfg.get<string>(opts.settingKey) ?? '').trim();

  const baseItems: ComboItem[] = [
    { label: t('Auto'), description: opts.auto.description, value: opts.auto.value },
    { label: '', kind: vscode.QuickPickItemKind.Separator },
    ...opts.choices,
  ];

  // Отметить текущий выбор маркером в описании.
  for (const item of baseItems) {
    if (item.value !== undefined && item.value.toLowerCase() === current.toLowerCase()) {
      item.description = item.description ? `${item.description} • ${t('current')}` : t('current');
    }
  }

  const picked = await new Promise<string | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<ComboItem>();
    qp.title = opts.title;
    qp.placeholder = opts.placeholder;
    qp.matchOnDescription = true; // искать и по описанию (англ. имя / алиас), не только по label
    qp.items = baseItems;

    // На каждый ввод: если текст не совпал с известным выбором — показать в конце живой пункт
    // «Использовать "<текст>"» (alwaysShow обходит фильтр). Базовые пункты VS Code фильтрует сам.
    qp.onDidChangeValue((raw) => {
      const value = raw.trim();
      if (!value || opts.knownMatches(value)) {
        qp.items = baseItems;
        return;
      }
      qp.items = [
        ...baseItems,
        { label: t('$(pencil) Use "{0}"', value), alwaysShow: true, isCustom: true, value },
      ];
    });

    qp.onDidAccept(() => {
      const sel = qp.selectedItems[0] ?? qp.activeItems[0];
      if (sel) {
        resolve(sel.isCustom ? (sel.value ?? qp.value.trim()) : sel.value);
      } else {
        const typed = qp.value.trim();
        resolve(typed || undefined);
      }
      qp.hide();
    });

    qp.onDidHide(() => {
      qp.dispose();
      resolve(undefined);
    });

    qp.show();
  });

  if (picked === undefined) {
    return; // отменили
  }
  await cfg.update(opts.settingKey, picked, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(opts.successMessage(picked));
}

// Команда «Select Commit Language»: Auto + частые языки (родные названия) + свой ввод.
// label — родное имя (видит пользователь), description — английское (= value, в промпт).
function registerSelectLanguage(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('commitwright.selectLanguage', () =>
    pickValueWithCustom({
      settingKey: 'commitLanguage',
      title: t('CommitWright: Select Commit Language'),
      placeholder: t('Pick a language, or type your own and press Enter'),
      successMessage: (v) => t('CommitWright: commit language set to "{0}".', v),
      auto: {
        value: 'auto',
        description: t('follow VS Code language ({0})', resolveLanguage('auto', vscode.env.language)),
      },
      choices: COMMON_LANGUAGES.map(
        (lang: CommonLanguage): ComboItem => ({
          label: lang.native,
          description: lang.native === lang.english ? undefined : lang.english,
          value: lang.english,
        }),
      ),
      knownMatches: (typed) =>
        COMMON_LANGUAGES.some(
          (l) =>
            l.native.toLowerCase() === typed.toLowerCase() ||
            l.english.toLowerCase() === typed.toLowerCase(),
        ),
    }),
  );
  context.subscriptions.push(disposable);
}

// Команда «Select Model»: Auto (= дефолт CLI) + частые алиасы (opus/sonnet/haiku) + свой ввод
// (полное имя модели или будущая модель). Значение уходит в --model; пустое = дефолт CLI.
function registerSelectModel(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('commitwright.selectModel', () =>
    pickValueWithCustom({
      settingKey: 'model',
      title: t('CommitWright: Select Model'),
      placeholder: t('Pick a model, or type its full name and press Enter'),
      successMessage: (v) => t('CommitWright: model set to "{0}".', v),
      auto: { value: '', description: t('use the CLI default') },
      choices: COMMON_MODELS.map(
        (m: CommonModel): ComboItem => ({ label: m.alias, description: m.hint, value: m.alias }),
      ),
      knownMatches: (typed) =>
        COMMON_MODELS.some((m) => m.alias.toLowerCase() === typed.toLowerCase()),
    }),
  );
  context.subscriptions.push(disposable);
}

// Презентация точек входа в пульте. Ключи — из config.ENTRYPOINT_KEYS (единый источник истины),
// здесь только подписи для QuickPick.
const ENTRYPOINT_LABELS: Record<EntrypointKey, { label: string; detail: string }> = {
  scmTitle: { label: 'Source Control title bar', detail: 'Button in the Source Control panel header.' },
  editorButton: { label: 'Commit editor toolbar', detail: 'Button while editing the commit message (COMMIT_EDITMSG).' },
  changesInline: { label: 'Inline on Changes', detail: 'Action on the Changes group row.' },
  panel: { label: 'Source Control panel', detail: 'Dedicated CommitWright view.' },
  slashTrigger: { label: 'Slash command in message box', detail: 'Type /generate in the commit box.' },
  statusBar: { label: 'Status bar', detail: 'Item in the status bar.' },
};

interface EntrypointPick extends vscode.QuickPickItem {
  key: EntrypointKey;
}

// Пульт «все точки входа разом»: QuickPick с canPickMany (галочки).
// Читает и пишет настройку-object commitwright.entrypoints (видимость каждой точки) целиком.
function registerConfigureEntrypoints(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('commitwright.configureEntrypoints', async () => {
    const cfg = vscode.workspace.getConfiguration('commitwright');
    const current = cfg.get<Partial<Record<EntrypointKey, boolean>>>('entrypoints') ?? {};
    const items: EntrypointPick[] = ENTRYPOINT_KEYS.map((key) => ({
      label: ENTRYPOINT_LABELS[key].label,
      detail: ENTRYPOINT_LABELS[key].detail,
      key,
      picked: current[key] ?? true,
    }));
    const selection = await vscode.window.showQuickPick(items, {
      canPickMany: true,
      title: t('CommitWright: Configure Entry Points'),
      placeHolder: t('Check where the generate action should appear'),
    });
    if (!selection) {
      return; // отменили (Esc)
    }
    const enabled = new Set(selection.map((s) => s.key));
    const next = {} as Record<EntrypointKey, boolean>;
    for (const key of ENTRYPOINT_KEYS) {
      next[key] = enabled.has(key);
    }
    await cfg.update('entrypoints', next, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('CommitWright: entry points updated.'));
  });
  context.subscriptions.push(disposable);
}

export function registerCommands(context: vscode.ExtensionContext): void {
  registerSelectLanguage(context);
  registerSelectModel(context);
  registerConfigureEntrypoints(context);
}
