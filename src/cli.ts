import type { CommitWrightConfig } from './config';

// Вызов локального CLI. Расширяемость через настройки сведена к одной точке:
// buildInvocation(cfg) собирает команду + аргументы + env, а runCli исполняет.
// Добавить новый параметр = одна строка в buildInvocation.

export interface CliInvocation {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

// TODO (Фаза 1): собрать вызов из конфига.
//   diff передаём через stdin (не аргументом — упрёмся в лимит длины командной строки);
//   model -> `--model`, при необходимости уровень мышления и лимит токенов.
//   Точные флаги print-режима сверить через `claude --help`, не по памяти.
export function buildInvocation(_cfg: CommitWrightConfig): CliInvocation {
  throw new Error('buildInvocation: not implemented yet (Phase 1)');
}

// TODO (Фаза 1): запустить CLI, diff -> stdin, навесить таймаут, обрезать вывод (.trim()).
//   Windows: бинарь может быть .exe/.cmd, PATH виден не во всех шеллах — отсюда cliPath.
export async function runCli(_invocation: CliInvocation, _diff: string): Promise<string> {
  throw new Error('runCli: not implemented yet (Phase 1)');
}
