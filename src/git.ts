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
  /** Состояние репозитория — нужно, чтобы отслеживать наличие staged-изменений. */
  readonly state: {
    readonly indexChanges: readonly unknown[];
    readonly onDidChange: vscode.Event<void>;
  };
}

/** Минимальный контракт git-API (полный объявлен в API расширения vscode.git). */
interface GitApi {
  readonly repositories: readonly GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
}

/** git-API расширения vscode.git (версия 1) или undefined, если оно не активно. */
export function getGitApi(): GitApi | undefined {
  const ext = vscode.extensions.getExtension('vscode.git');
  if (!ext?.isActive) {
    return undefined;
  }
  return ext.exports.getAPI(1) as GitApi; // версия git-API — 1
}

/** Возвращает первый репозиторий воркспейса или undefined, если git-репо нет. */
export function getActiveRepository(): GitRepository | undefined {
  const api = getGitApi();
  if (!api || !api.repositories.length) {
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

// Lock-файлы исключаем из diff (по ресёрчу): они огромные, шумные и не улучшают сообщение.
// Реализуем через git pathspec exclude с glob-магией — фильтрует и сам git, надёжнее ручного.
// '.' — обязательный позитивный pathspec (иначе exclude-only может не сматчиться).
const LOCK_EXCLUDES = [
  ':(exclude,glob)**/package-lock.json',
  ':(exclude,glob)**/yarn.lock',
  ':(exclude,glob)**/pnpm-lock.yaml',
  ':(exclude,glob)**/Cargo.lock',
  ':(exclude,glob)**/go.sum',
  ':(exclude,glob)**/composer.lock',
  ':(exclude,glob)**/Gemfile.lock',
  ':(exclude,glob)**/poetry.lock',
  ':(exclude,glob)**/*.lock',
];
const PATHSPEC = ['--', '.', ...LOCK_EXCLUDES];

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
  const files = await listUntracked(cwd);

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

// Перечислить неотслеживаемые файлы (с уважением к .gitignore и исключением lock-файлов).
async function listUntracked(cwd: string): Promise<string[]> {
  const list = await runGit(cwd, ['ls-files', '--others', '--exclude-standard', ...PATHSPEC]);
  return list
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// «Все изменения»: отслеживаемые (staged + unstaged) + неотслеживаемые файлы.
// has HEAD -> `git diff HEAD`; свежий репозиторий без коммитов -> эквивалент `--cached`.
async function getAllChanges(cwd: string): Promise<string> {
  const tracked = (await hasHead(cwd))
    ? await runGit(cwd, ['diff', 'HEAD', ...PATHSPEC])
    : await runGit(cwd, ['diff', '--cached', ...PATHSPEC]);
  const untracked = await diffUntracked(cwd);
  if (tracked && untracked) {
    return `${tracked}\n${untracked}`;
  }
  return tracked || untracked;
}

// Решение «staged или all» для режима auto — одна точка, чтобы diff и список файлов совпадали.
async function useStaged(cwd: string, source: DiffSource): Promise<boolean> {
  if (source === 'staged') {
    return true;
  }
  if (source === 'all') {
    return false;
  }
  // auto: есть staged -> берём его (уважаем явный выбор); пусто -> все изменения.
  const staged = await runGit(cwd, ['diff', '--cached', ...PATHSPEC]);
  return staged.trim().length > 0;
}

// Возвращает diff в зависимости от источника:
//   'staged' -> только проиндексированное (`git diff --cached`);
//   'all'    -> все изменения (tracked staged+unstaged + untracked);
//   'auto'   -> «по-умному»: есть staged -> берём его; пусто -> все изменения.
// Lock-файлы исключены во всех режимах.
export async function getDiff(cwd: string, source: DiffSource): Promise<string> {
  if (await useStaged(cwd, source)) {
    return runGit(cwd, ['diff', '--cached', ...PATHSPEC]);
  }
  return getAllChanges(cwd);
}

// Список изменённых файлов для блока FILES в промпте (помогает модели вывести scope).
// Зеркалит логику getDiff, чтобы список совпадал с тем, что реально ушло в diff.
export async function getChangedFiles(cwd: string, source: DiffSource): Promise<string[]> {
  if (await useStaged(cwd, source)) {
    return splitLines(await runGit(cwd, ['diff', '--cached', '--name-only', ...PATHSPEC]));
  }
  const tracked = (await hasHead(cwd))
    ? await runGit(cwd, ['diff', 'HEAD', '--name-only', ...PATHSPEC])
    : await runGit(cwd, ['diff', '--cached', '--name-only', ...PATHSPEC]);
  const untracked = await listUntracked(cwd);
  return [...new Set([...splitLines(tracked), ...untracked])];
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Input-guard: усечение слишком большого diff. Вынесено отдельной чистой функцией —
// удобно покрыть unit-тестом (Фаза 3) и применять перед сборкой промпта.
export function truncateDiff(diff: string, maxChars = MAX_DIFF_CHARS): string {
  if (diff.length <= maxChars) {
    return diff;
  }
  return diff.slice(0, maxChars) + '\n\n[... diff truncated by CommitWright: too large ...]';
}
