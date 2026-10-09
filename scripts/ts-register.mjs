// ── Run the project's TypeScript from a plain .mjs script ──────────────────
//
// The same small loader hook scripts/analyst-capabilities.mjs and lab-audit.mjs carry:
// it teaches Node the `@/` alias and extension-less relative imports, and transpiles
// .ts/.tsx with the project's own `typescript` devDependency. No build step, no new
// dependency. Call `registerTypeScript(repoRoot)` once, then `await import()` the sources.

import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const hookSource = (REPO, SRC) => `
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import ts from ${JSON.stringify(pathToFileURL(join(REPO, 'node_modules/typescript/lib/typescript.js')).href)};

const SRC = ${JSON.stringify(SRC)};

function candidates(specifier, parent) {
  if (specifier.startsWith('@/')) return [resolvePath(SRC, specifier.slice(2))];
  if (specifier.startsWith('./') || specifier.startsWith('../')) return [resolvePath(dirname(fileURLToPath(parent)), specifier)];
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const paths = candidates(specifier, context.parentURL ?? ${JSON.stringify(pathToFileURL(join(REPO, 'scripts', 'ts-register.mjs')).href)});
  if (paths) {
    for (const path of paths) {
      for (const attempt of [path, path + '.ts', path + '.tsx', resolvePath(path, 'index.ts')]) {
        if (existsSync(attempt) && !attempt.endsWith('.json') && /\\.(ts|tsx)$/.test(attempt)) return nextResolve(pathToFileURL(attempt).href, context);
        if (existsSync(attempt) && attempt.endsWith('.json')) return nextResolve(pathToFileURL(attempt).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.json')) {
    const text = readFileSync(fileURLToPath(url), 'utf8');
    return { format: 'module', source: 'export default ' + text + ';', shortCircuit: true };
  }
  if (url.startsWith('file:') && (url.endsWith('.ts') || url.endsWith('.tsx'))) {
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      fileName: fileURLToPath(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, isolatedModules: true },
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;


export function registerTypeScript(repo) {
  register(`data:text/javascript,${encodeURIComponent(hookSource(repo, join(repo, 'src')))}`);
}
