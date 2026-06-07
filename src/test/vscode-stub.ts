// Лёгкий стаб модуля `vscode` для unit-тестов. Модуля `vscode` нет в обычном
// Node-процессе — его предоставляет только Extension Host. Поэтому при сборке тестов
// (esbuild.js --test) импорт 'vscode' подменяется alias'ом на этот файл.
//
// Содержит лишь то, к чему реально обращаются загружаемые тестами модули:
//   - vscode.env.language — читает buildPrompt (prompt.ts) при commitLanguage='auto';
//   - vscode.l10n.t       — i18n.ts реэкспортит его на верхнем уровне модуля.
// Объект env мутабельный: тест может выставить env.language, чтобы проверить auto-локаль.
// Остальные поля — пустые заглушки на случай обращения при загрузке модуля; сами
// тестируемые чистые функции их не вызывают (вызовут — тест честно упадёт, а не молча соврёт).

export const env = { language: 'en' };
export const l10n = { t: (message: string): string => message };

export const window = {} as Record<string, unknown>;
export const commands = {} as Record<string, unknown>;
export const workspace = {} as Record<string, unknown>;
export const extensions = {} as Record<string, unknown>;
export const Uri = {} as Record<string, unknown>;
