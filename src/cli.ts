import { spawn } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CommitWrightConfig } from './config';
import { CommitWrightError } from './errors';

// Вызов локального CLI. Расширяемость через настройки сведена к одной точке:
// buildInvocation(cfg) собирает команду + аргументы + env, а runCli исполняет.
// Добавить новый параметр = одна строка в buildInvocation.
//
// Архитектура (подтверждена живым прогоном claude --print):
//   весь промпт (с уже вставленным diff) уходит в stdin, позиционного аргумента нет.
//   Так нет лимита длины командной строки и diff можно ставить куда угодно в шаблоне.
//
// Изоляция от контекста проекта: запускаем в нейтральном cwd (os.tmpdir()), а НЕ в
// репозитории пользователя. Иначе claude авто-подхватит его CLAUDE.md и загрязнит
// генерацию правилами проекта (подтверждено живьём). diff и так идёт через stdin —
// доступ к файлам репозитория не нужен. (--bare решил бы это же, но ломает OAuth-вход.)

export interface CliInvocation {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

// Частые модели для пикера selectModel. Это подсказки-алиасы — пользователь всегда может
// ввести полное имя (например 'claude-opus-4-8') или будущую модель, поэтому список не
// обязан быть полным. Пустое значение модели = дефолт CLI (см. buildInvocation).
export interface CommonModel {
  /** Алиас, уходящий в --model и в настройку. */
  alias: string;
  /** Краткое пояснение для пикера. */
  hint: string;
}

export const COMMON_MODELS: readonly CommonModel[] = [
  { alias: 'opus', hint: 'most capable' },
  { alias: 'sonnet', hint: 'balanced' },
  { alias: 'haiku', hint: 'fastest' },
];

export function buildInvocation(cfg: CommitWrightConfig): CliInvocation {
  // -p/--print: неинтерактивный вывод; text: чистый текст; --tools "": без инструментов
  // (нам нужен только текст из нашего diff, не доступ к ФС); --no-session-persistence:
  // не плодить сессии на диске на каждый вызов. Флаги сверены по `claude --help` (v2.1.x).
  const args = ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence'];
  if (cfg.model.trim()) {
    args.push('--model', cfg.model.trim());
  }
  // CLI не принимает temperature (нет такого флага — сверено по `claude --help`), поэтому
  // стабильность формата держим промптом. Доступен только --effort: для короткой задачи
  // генерации сообщения хватает низкого уровня (быстрее), но решает пользователь.
  if (cfg.effort.trim()) {
    args.push('--effort', cfg.effort.trim());
  }
  return { command: cfg.cliPath, args };
}

// Существует ли исполняемый файл по этому абсолютному пути.
function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Резолв команды в существующий файл (или null, если не найдена). Делаем сами, ДО запуска:
// при shell:true несуществующий бинарь обрабатывает сам шелл (cmd.exe) — он не кидает ENOENT,
// а возвращает ненулевой код и пишет локализованную (на Windows — CP866) ошибку. Префлайт
// даёт чистую категорию cli-not-found и заодно не пускает шелл печатать кракозябры.
function resolveExecutable(command: string): string | null {
  const isWin = process.platform === 'win32';
  // На Windows к голому имени пробуем расширения из PATHEXT (claude -> claude.exe/.cmd/.bat).
  const exts = isWin
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  // На Windows расширения идут ПЕРЕД голым именем: рядом с `claude.cmd` часто лежит Unix-shim
  // `claude` (без расширения) — он существует как файл, но spawn без shell его не запустит (ENOENT).
  // Голое имя оставляем последним fallback'ом (на случай, когда путь уже задан с расширением).
  const withExts = (base: string): string[] =>
    isWin ? [...exts.map((e) => base + e), base] : [base];

  // Путь с разделителем/абсолютный — проверяем как есть; иначе ищем по каждому каталогу PATH.
  if (path.isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return withExts(command).find(isFile) ?? null;
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const hit = withExts(path.join(dir, command)).find(isFile);
    if (hit) {
      return hit;
    }
  }
  return null;
}

// Метасимволы оболочки, опасные в неэкранированной shell-команде (используется в Windows
// .cmd-ветке ниже, где Node аргументы не экранирует).
const SHELL_UNSAFE = /[&|;<>()^"'`$%\s]/;

// В shell-ветке (.cmd/.bat на Windows) аргументы не экранируются Node — отвергаем те, что содержат
// метасимволы оболочки. Защищает узкий неустранимый угол: свободные значения из настроек (model,
// путь) не должны уйти в shell неэкранированными. Для .exe/Unix shell не используется вовсе.
function assertShellSafeArgs(args: readonly string[]): void {
  for (const arg of args) {
    if (SHELL_UNSAFE.test(arg)) {
      throw new CommitWrightError(
        'unknown',
        `Refusing to run: an argument contains shell metacharacters (${arg}). Check the "model" setting.`,
      );
    }
  }
}

// Запуск CLI: промпт -> stdin, сбор stdout, таймаут, классификация ошибок.
// Безопасность: для .exe/Unix запускаем БЕЗ shell — аргументы идут как argv, оболочка их не парсит,
// инъекция структурно невозможна. Windows .cmd/.bat без shell Node не запускает (BatBadBut), для них
// shell неизбежен: путь к скрипту берём в кавычки сами (иначе пробелы ломают разбор; shell:true даёт
// `cmd /d /s /c "…"`, и /s снимает только внешние кавычки — наши вокруг пути выживают), а свободные
// аргументы валидируем (assertShellSafeArgs) — в shell они не экранируются. .exe/Unix — напрямую.
export function runCli(
  invocation: CliInvocation,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Префлайт: резолвим команду в реальный файл. Не найден -> чистая категория, без запуска shell.
    const resolved = resolveExecutable(invocation.command);
    if (!resolved) {
      reject(
        new CommitWrightError('cli-not-found', `Executable not found: ${invocation.command}`),
      );
      return;
    }

    // Windows .cmd/.bat запускаются только через shell. Путь берём в кавычки сами (пробелы), а
    // свободные аргументы валидируем — в shell они не экранируются.
    const isWinScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved);
    if (isWinScript) {
      try {
        assertShellSafeArgs(invocation.args);
      } catch (err) {
        reject(err);
        return;
      }
    }

    const child = spawn(isWinScript ? `"${resolved}"` : resolved, invocation.args, {
      cwd: os.tmpdir(), // нейтральный cwd: не подхватывать CLAUDE.md репозитория
      env: invocation.env ?? process.env,
      windowsHide: true,
      shell: isWinScript, // .cmd/.bat — только через shell; путь заквочен, аргументы валидированы
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new CommitWrightError('cli-not-found', err.message));
      } else {
        reject(new CommitWrightError('unknown', err.message));
      }
    });

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CommitWrightError('timeout', `Timed out after ${timeoutMs} ms`));
        return;
      }
      const stdout = decodeOutput(Buffer.concat(stdoutChunks));
      const stderr = decodeOutput(Buffer.concat(stderrChunks));
      if (code !== 0) {
        // claude при ошибке пишет диагностику то в stderr, то в stdout — отдаём оба.
        reject(classifyExit(code, stdout, stderr));
        return;
      }
      const message = stdout.trim();
      if (!message) {
        reject(new CommitWrightError('empty-output', 'CLI returned an empty response'));
        return;
      }
      resolve(message);
    });

    // Промпт целиком (с diff) — в stdin, затем закрываем поток.
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Декод вывода процесса. claude печатает UTF-8; но если в выводе оказался текст от cmd.exe
// на русской Windows (CP866), UTF-8-декод даёт «кракозябры» (U+FFFD). В этом случае пробуем
// ibm866 (= CP866) как fallback. WHATWG-метку 'ibm866' Node TextDecoder понимает.
function decodeOutput(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  if (process.platform === 'win32' && utf8.includes('�')) {
    try {
      return new TextDecoder('ibm866').decode(buf);
    } catch {
      // ibm866 недоступна в этой сборке Node — оставляем UTF-8.
    }
  }
  return utf8;
}

// Классификация ненулевого выхода. claude при ошибке (например невыполненном /login) пишет
// диагностику то в stderr, то в stdout — поэтому смотрим оба потока: и для матчинга категории,
// и для текста в тосте (принцип «никаких молчаливых ошибок»). Сигнатуры эвристические;
// auth/limit уточняем по живому выводу.
export function classifyExit(code: number | null, stdout: string, stderr: string): CommitWrightError {
  const diagnostic = [stderr, stdout]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');
  const text = diagnostic.toLowerCase();
  const authPattern =
    /unauthor|not logged in|not authenticated|please.*login|\/login|invalid api key|authentication/;
  if (authPattern.test(text)) {
    return new CommitWrightError('auth', diagnostic || 'Authentication error');
  }
  if (/rate limit|usage limit|quota|too many requests|overloaded/.test(text)) {
    return new CommitWrightError('limit', diagnostic || 'Usage limit reached');
  }
  return new CommitWrightError('nonzero-exit', diagnostic || `CLI exited with code ${code}`);
}
