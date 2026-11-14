import ts from 'typescript';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.resolve(process.env.ACCESSRELAY_SDK_ROOT || path.join(root, '../../../AccessRelayStudio-Source'));
const ui = path.join(root, 'ui');
const files = (await readdir(ui)).filter(name => /\.tsx?$/.test(name));
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.ReactJSX,
  strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
  typeRoots: [path.join(sdk, 'src/AccessRelayStudio/DesktopUi/node_modules/@types')],
  paths: { '@accessrelay/plugin-ui': [path.join(sdk, 'src/AccessRelayStudio/DesktopUi/src/game-plugins/api.ts')],
    'react': [path.join(sdk, 'src/AccessRelayStudio/DesktopUi/node_modules/@types/react/index.d.ts')],
    'react/*': [path.join(sdk, 'src/AccessRelayStudio/DesktopUi/node_modules/@types/react/*.d.ts')] } };
const program = ts.createProgram([...files.map(name => path.join(ui, name)), path.join(sdk, 'src/AccessRelayStudio/DesktopUi/src/env.d.ts')], options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: f => f, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exit(1);
}
await mkdir(path.join(root, 'dist/ui'), { recursive: true });
for (const name of files) {
  const result = ts.transpileModule(await readFile(path.join(ui, name), 'utf8'), {
    fileName: name, compilerOptions: { ...options, jsx: ts.JsxEmit.React, noEmit: false, allowImportingTsExtensions: false } });
  if (/from\s+['"]react(?:\/|['"])/.test(result.outputText)) throw new Error('Plugin must use the host React singleton.');
  await writeFile(path.join(root, 'dist/ui', name.replace(/\.tsx?$/, '.js')), result.outputText);
}
console.log('SUCCESS NBA interface compiled against Studio shared UI API; no bundled React runtime.');
