import { spawn } from 'node:child_process';
import * as os from 'node:os';
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

export function buildInvocation(cfg: CommitWrightConfig): CliInvocation {
  // -p/--print: неинтерактивный вывод; text: чистый текст; --tools "": без инструментов
  // (нам нужен только текст из нашего diff, не доступ к ФС); --no-session-persistence:
  // не плодить сессии на диске на каждый вызов. Флаги сверены по `claude --help` (v2.1.x).
  const args = ['-p', '--output-format', 'text', '--tools', '', '--no-session-persistence'];
  if (cfg.model.trim()) {
    args.push('--model', cfg.model.trim());
  }
  return { command: cfg.cliPath, args };
}

// Запуск CLI: промпт -> stdin, сбор stdout, таймаут, классификация ошибок.
// Windows: бинарь может быть .exe/.cmd, поэтому shell:true (иначе .cmd не запустится);
// аргументы фиксированы нами (не пользовательский ввод в shell) — инъекции нет.
export function runCli(
  invocation: CliInvocation,
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: os.tmpdir(), // нейтральный cwd: не подхватывать CLAUDE.md репозитория
      env: invocation.env ?? process.env,
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
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

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new CommitWrightError('timeout', `Timed out after ${timeoutMs} ms`));
        return;
      }
      if (code !== 0) {
        reject(classifyExit(code, stderr));
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

// Классификация ненулевого выхода. Точные сигнатуры auth/limit ещё не выверены опытно
// (роадмап: определить, когда столкнёмся) — пока грубая эвристика по stderr + общий случай.
function classifyExit(code: number | null, stderr: string): CommitWrightError {
  const text = stderr.toLowerCase();
  if (/unauthor|not logged in|authentication|login/.test(text)) {
    return new CommitWrightError('auth', stderr || 'Authentication error');
  }
  if (/rate limit|usage limit|quota|too many requests/.test(text)) {
    return new CommitWrightError('limit', stderr || 'Usage limit reached');
  }
  return new CommitWrightError('nonzero-exit', stderr || `CLI exited with code ${code}`);
}
