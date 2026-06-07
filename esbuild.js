// Скрипт сборки: склеивает src/ в один файл dist/extension.js.
// Запуск: `node esbuild.js` (разовая сборка), `--watch` (пересборка на лету),
// `--production` (минификация без source map — для упаковки .vsix).

const esbuild = require('esbuild');
const fs = require('node:fs');
const path = require('node:path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

// Плагин-«мостик» к панели Problems: печатает маркеры начала/конца сборки и
// ошибки в формате file:line:column. Их разбирает problemMatcher из .vscode/tasks.json,
// поэтому ошибки сборки видны в панели Problems.
/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log('[watch] build finished');
    });
  },
};

// Сборка расширения: src/extension.ts -> dist/extension.js. 'vscode' остаётся external
// (его даёт сам редактор в рантайме).
async function buildExtension() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs', // VS Code загружает расширение как CommonJS-модуль
    platform: 'node', // расширение работает в Node-хосте VS Code, не в браузере
    target: 'node20', // рантайм extension host (Electron) — Node 20.x
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    outfile: 'dist/extension.js',
    // 'vscode' предоставляет сам редактор в рантайме — его НИКОГДА не бандлим.
    // Всё остальное (наши модули и любые npm-зависимости) попадает в bundle.
    external: ['vscode'],
    logLevel: 'silent',
    plugins: [problemMatcherPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

// Сборка unit-тестов: src/test/*.test.ts -> out/test/*.test.js для запуска `node --test`.
// Ключевое отличие от сборки расширения: 'vscode' НЕ external, а подменяется лёгким стабом
// (alias) — в обычном Node-процессе модуля 'vscode' нет, его даёт только Extension Host.
// Так чистые функции (buildInvocation, truncateDiff, resolveLanguage, buildPrompt,
// classifyExit) тестируются без поднятия редактора. sourcemap inline -> стектрейсы на .ts.
async function buildTests() {
  const dir = 'src/test';
  const entryPoints = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => path.join(dir, f));
  await esbuild.build({
    entryPoints,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    sourcesContent: false,
    outdir: 'out/test',
    alias: { vscode: path.resolve(__dirname, 'src/test/vscode-stub.ts') },
  });
}

async function main() {
  await (test ? buildTests() : buildExtension());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
