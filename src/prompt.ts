import type { CommitWrightConfig } from './config';

// Сборка промпта для CLI. Отделена от вызова, чтобы её можно было покрыть unit-тестами
// как чистую функцию (вход — конфиг + diff, выход — строка промпта).

// TODO (Фаза 1): собрать промпт по style + языку коммитов (auto -> локаль VS Code,
//   fallback English) + произвольным пользовательским правилам (extraInstructions).
//   Требование к ответу: ТОЛЬКО текст сообщения, без преамбулы.
export function buildPrompt(_cfg: CommitWrightConfig, _diff: string): string {
  throw new Error('buildPrompt: not implemented yet (Phase 1)');
}
