// Скрипт сборки: склеивает src/ в один файл dist/extension.js.
// Запуск: `node esbuild.js` (разовая сборка), `--watch` (пересборка на лету),
// `--production` (минификация без source map — для упаковки .vsix).

const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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

async function main() {
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
