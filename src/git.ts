import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DiffSource } from './config';

const execFileAsync = promisify(execFile);

// Интеграция с git идёт через встроенное расширение `vscode.git`, а не через ручной
// парсинг — это самый надёжный API. Ниже — минимальный контракт того, что нам нужно
// от репозитория (полный тип объявлен в API git-расширения).
export interface GitRepository {
  readonly rootUri: vscode.Uri;
  /** Поле ввода commit-сообщения в панели Source Control — сюда кладём результат. */
  readonly inputBox: { value: string };
}

/** Возвращает первый репозиторий воркспейса или undefined, если git-репо нет. */
export function getActiveRepository(): GitRepository | undefined {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext?.isActive) {
    return undefined;
  }
  const api = ext.exports.getAPI(1); // версия git-API — 1
  if (!api.repositories.length) {
    return undefined;
  }
  // TODO (позже): при нескольких репозиториях выбрать активный (по фокусу SCM).
  return api.repositories[0];
}

// Максимум символов diff, которые отдаём CLI. Огромные diff'ы (лок-файлы, сгенерированный
// код, вендоринг) раздувают запрос и не улучшают сообщение — усекаем на своей стороне.
const MAX_DIFF_CHARS = 100_000;

// Есть ли в репозитории хотя бы один коммит (HEAD). В свежем репозитории HEAD ещё нет,
// и `git diff HEAD` упал бы — это важно для source='all' при самом первом коммите.
async function hasHead(cwd: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// Возвращает diff в зависимости от источника:
//   'staged' -> только проиндексированное (`git diff --cached`);
//   'all'    -> все изменения отслеживаемых файлов против HEAD (staged + unstaged),
//               а в свежем репозитории без коммитов — эквивалент staged.
// Запуск через execFile (без shell — нет инъекции); maxBuffer поднят: diff бывает большим.
export async function getDiff(cwd: string, source: DiffSource): Promise<string> {
  let args: string[];
  if (source === 'staged') {
    args = ['diff', '--cached'];
  } else {
    args = (await hasHead(cwd)) ? ['diff', 'HEAD'] : ['diff', '--cached'];
  }
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 64 * 1024 * 1024, // 64 МБ: не упираемся в дефолтный лимит 1 МБ
    windowsHide: true,
  });
  return stdout;
}

// Input-guard: усечение слишком большого diff. Вынесено отдельной чистой функцией —
// удобно покрыть unit-тестом (Фаза 3) и применять перед сборкой промпта.
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return diff.slice(0, maxChars) + '\n\n[... diff truncated by CommitWright: too large ...]';
}
