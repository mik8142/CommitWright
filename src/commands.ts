import * as vscode from 'vscode';
import { COMMON_LANGUAGES, resolveLanguage } from './prompt';
import type { CommonLanguage } from './prompt';
import { t } from './i18n';

// Пользовательские команды поверх главной commitwright.generate.
// Сейчас здесь selectLanguage; в Фазе 2 сюда добавится configureEntrypoints (QuickPick видимости).

interface LangItem extends vscode.QuickPickItem {
  value?: string; // язык для сохранения; undefined у разделителя
  isCustom?: boolean; // живой пункт «использовать введённый текст»
}

// Команда «Select Commit Language». Сделана на низкоуровневом createQuickPick (а не
// showQuickPick), потому что нужен комбобокс: печатаешь — список фильтруется по родному И
// английскому имени, и при этом ВСЕГДА есть пункт «использовать свой текст». showQuickPick
// так не умеет: ввод чужого языка отфильтровал бы и сам пункт «ввести своё» (тупик).
// Источник истины один — настройка commitLanguage (туда же пишем результат).
export function registerSelectLanguageCommand(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('commitwright.selectLanguage', async () => {
    const cfg = vscode.workspace.getConfiguration('commitwright');
    const current = (cfg.get<string>('commitLanguage') ?? 'auto').trim();
    const autoResolved = resolveLanguage('auto', vscode.env.language);

    // Базовые пункты: Auto + частые языки. label — родное имя (видит пользователь),
    // description — английское (= value, уходит в промпт; поиск матчит и по нему).
    const baseItems: LangItem[] = [
      {
        label: t('Auto'),
        description: t('follow VS Code language ({0})', autoResolved),
        value: 'auto',
      },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      ...COMMON_LANGUAGES.map(
        (lang: CommonLanguage): LangItem => ({
          label: lang.native,
          description: lang.native === lang.english ? undefined : lang.english,
          value: lang.english,
        }),
      ),
    ];

    // Отметить текущий выбор галочкой-маркером в описании.
    for (const item of baseItems) {
      if (item.value && item.value.toLowerCase() === current.toLowerCase()) {
        item.description = item.description ? `${item.description} • ${t('current')}` : t('current');
      }
    }

    const picked = await new Promise<string | undefined>((resolve) => {
      const qp = vscode.window.createQuickPick<LangItem>();
      qp.title = t('CommitWright: Select Commit Language');
      qp.placeholder = t('Pick a language, or type your own and press Enter');
      qp.matchOnDescription = true; // искать и по английскому имени, не только по родному
      qp.items = baseItems;

      // На каждый ввод: если текст не совпадает с известным языком — показать в конце
      // живой пункт «Использовать "<текст>"» (alwaysShow обходит фильтр). Базовые пункты
      // VS Code фильтрует сам, так что совпадения остаются выше custom-пункта.
      qp.onDidChangeValue((raw) => {
        const value = raw.trim();
        const known =
          !value ||
          COMMON_LANGUAGES.some(
            (l) =>
              l.native.toLowerCase() === value.toLowerCase() ||
              l.english.toLowerCase() === value.toLowerCase(),
          );
        if (known) {
          qp.items = baseItems;
          return;
        }
        const customItem: LangItem = {
          label: t('$(pencil) Use "{0}"', value),
          alwaysShow: true,
          isCustom: true,
          value,
        };
        qp.items = [...baseItems, customItem];
      });

      qp.onDidAccept(() => {
        const sel = qp.selectedItems[0] ?? qp.activeItems[0];
        if (sel) {
          resolve(sel.isCustom ? (sel.value ?? qp.value.trim()) : sel.value);
        } else {
          // Ничего не подсвечено, но есть введённый текст — принять его как свой язык.
          const typed = qp.value.trim();
          resolve(typed || undefined);
        }
        qp.hide();
      });

      qp.onDidHide(() => {
        qp.dispose();
        resolve(undefined); // повторный resolve игнорируется, если уже приняли
      });

      qp.show();
    });

    if (!picked) {
      return; // отменили или пусто
    }

    // Один источник истины = настройка. Global: язык коммитов — личная преференция.
    await cfg.update('commitLanguage', picked, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(t('CommitWright: commit language set to "{0}".', picked));
    // Примечание: если редактор настроек открыт, его поле обновится не сразу, а при смене
    // фокуса — это известное ограничение VS Code (microsoft/vscode#237496), не наш баг.
  });

  context.subscriptions.push(disposable);
}
