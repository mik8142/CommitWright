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

const GIT_EXEC_OPTS = {
  maxBuffer: 64 * 1024 * 1024, // 64 МБ: не упираемся в дефолтный лимит 1 МБ
  windowsHide: true,
} as const;

// Запуск git с фиксированными аргументами (без shell -> нет инъекции).
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, ...GIT_EXEC_OPTS });
  return stdout;
}

// Есть ли в репозитории хотя бы один коммит (HEAD). В свежем репозитории HEAD ещё нет,
// и `git diff HEAD` упал бы — это важно при самом первом коммите.
async function hasHead(cwd: string): Promise<boolean> {
  try {
    await runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

// Diff неотслеживаемых (untracked) файлов. `git diff HEAD` их не показывает, поэтому
// собираем вручную: перечисляем (с уважением к .gitignore) и для каждого делаем
// `git diff --no-index /dev/null <file>` — это даёт diff «нового файла» БЕЗ изменения
// индекса (в отличие от `add -N`, который наследил бы в чужом репозитории).
// Тонкость: --no-index возвращает код 1 при наличии различий (это норма, не ошибка),
// а promisify(execFile) на ненулевом коде режектит — поэтому ловим reject и берём stdout.
// /dev/null понимается git'ом на всех платформах, включая Windows (это git-изм, не путь ОС).
async function diffUntracked(cwd: string): Promise<string> {
  const list = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
  const files = list.split('\n').map((s) => s.trim()).filter(Boolean);

  let out = '';
  for (const file of files) {
    if (out.length >= MAX_DIFF_CHARS) {
      break; // дальше всё равно усечём — не читаем лишние файлы
    }
    try {
      out += await runGit(cwd, ['diff', '--no-index', '--', '/dev/null', file]);
    } catch (err) {
      // Код 1 = найдены различия (ожидаемо): diff лежит в stdout ошибки.
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) {
        out += stdout;
      }
      // Иначе — реальная ошибка по конкретному файлу: пропускаем (best-effort).
    }
  }
  return out;
}

// «Все изменения»: отслеживаемые (staged + unstaged) + неотслеживаемые файлы.
// has HEAD -> `git diff HEAD`; свежий репозиторий без коммитов -> эквивалент `--cached`.
async function getAllChanges(cwd: string): Promise<string> {
  const tracked = (await hasHead(cwd))
    ? await runGit(cwd, ['diff', 'HEAD'])
    : await runGit(cwd, ['diff', '--cached']);
  const untracked = await diffUntracked(cwd);
  if (tracked && untracked) {
    return `${tracked}\n${untracked}`;
  }
  return tracked || untracked;
}

// Возвращает diff в зависимости от источника:
//   'staged' -> только проиндексированное (`git diff --cached`);
//   'all'    -> все изменения (tracked staged+unstaged + untracked);
//   'auto'   -> «по-умному»: есть staged -> берём его (уважаем явный выбор пользователя);
//               ничего не застейджено -> берём все изменения (как привычная кнопка по Changes).
export async function getDiff(cwd: string, source: DiffSource): Promise<string> {
  if (source === 'staged') {
    return runGit(cwd, ['diff', '--cached']);
  }
  if (source === 'auto') {
    const staged = await runGit(cwd, ['diff', '--cached']);
    if (staged.trim()) {
      return staged;
    }
    // ничего не застейджено -> падаем в режим «все изменения»
  }
  return getAllChanges(cwd);
}

// Input-guard: усечение слишком большого diff. Вынесено отдельной чистой функцией —
// удобно покрыть unit-тестом (Фаза 3) и применять перед сборкой промпта.
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return diff.slice(0, maxChars) + '\n\n[... diff truncated by CommitWright: too large ...]';
}
