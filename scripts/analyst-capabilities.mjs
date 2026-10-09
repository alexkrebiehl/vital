#!/usr/bin/env node
// ── Generate docs/analyst-capabilities.md ────────────────────────────────────
//
//   npm run analyst:capabilities            write the table
//   node scripts/analyst-capabilities.mjs --check    exit 1 when the committed file is out of date
//
// Renders the capability registry (src/lib/analyst/capabilities) with the same
// renderCapabilityDoc the parity test compares the committed file against. The file
// holds area, capability, tool, parameters, what it holds and the privacy category:
// no value, and nothing read from a database, a health source or a model.
//
// Like scripts/lab-audit.mjs it runs TypeScript through Node with a small resolver
// hook that teaches Node the `@/` alias and extension-less relative imports, and
// transpiles with the project's own `typescript` devDependency. No build step and
// no new dependency.

import { register } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SRC = join(REPO, 'src');
const OUT = join(REPO, 'docs', 'analyst-capabilities.md');

const HOOK = `
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
  const paths = candidates(specifier, context.parentURL ?? ${JSON.stringify(pathToFileURL(join(HERE, 'analyst-capabilities.mjs')).href)});
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

register(`data:text/javascript,${encodeURIComponent(HOOK)}`);

const { CAPABILITIES } = await import(join(SRC, 'lib/analyst/capabilities/registry.ts'));
const { renderCapabilityDoc } = await import(join(SRC, 'lib/analyst/capabilities/doc.ts'));

const text = renderCapabilityDoc(CAPABILITIES);

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
  if (current !== text) {
    console.error('docs/analyst-capabilities.md is out of date. Run: npm run analyst:capabilities');
    process.exit(1);
  }
  console.log(`docs/analyst-capabilities.md is up to date (${CAPABILITIES.length} capabilities).`);
} else {
  writeFileSync(OUT, text);
  console.log(`Wrote docs/analyst-capabilities.md (${CAPABILITIES.length} capabilities).`);
}
