import { rollup } from 'rollup';
import ts from 'typescript';
import { existsSync, readFileSync, rmSync, statSync } from 'fs';
import { dirname, resolve } from 'path';
import { babel } from '@rollup/plugin-babel';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import fg from 'fast-glob';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
const externalPackages = [
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.peerDependencies),
  ...Object.keys(packageJson.devDependencies),
];

const isRelative = (id) => id.startsWith('.');

function isExternal(id) {
  // `\0` ids are rollup/babel virtual modules (e.g. bundled helpers)
  if (isRelative(id) || id.startsWith('\0') || resolve(id) === id) return false;
  if (externalPackages.some((name) => id === name || id.startsWith(name + '/'))) return true;
  throw new Error(`Unexpected bare import "${id}": add it to package.json dependencies or peerDependencies`);
}

function createTypeProgram() {
  const tsconfigPath = resolve('./tsconfig.json');
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsconfigPath,
    {
      declaration: true,
      declarationDir: resolve('dist/types'),
      outDir: resolve('dist/source'),
      rootDir: resolve('src'),
    },
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (diagnostic) => { throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')); } },
  );
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences });
}

function failOnDiagnostics(program) {
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length === 0) return;
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}

// Node's ESM resolver and TS nodenext need explicit extensions in emitted .d.ts specifiers
function createDeclarationSpecifierRewriter(sourceDir) {
  return (specifier) => {
    if (!isRelative(specifier) || /\.[cm]?[jt]sx?$|\.json$/.test(specifier)) return specifier;
    const target = resolve(sourceDir, specifier);
    const isDirectory = existsSync(target) && statSync(target).isDirectory();
    return specifier.replace(/\/$/, '') + (isDirectory ? '/index.js' : '.js');
  };
}

function declarationExtensionTransformer(context) {
  return (sourceFile) => {
    const rewrite = createDeclarationSpecifierRewriter(dirname(sourceFile.fileName));
    const factory = context.factory;
    const rewriteLiteral = (literal) => factory.createStringLiteral(rewrite(literal.text));

    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        return factory.updateImportDeclaration(
          node, node.modifiers, node.importClause, rewriteLiteral(node.moduleSpecifier), node.attributes,
        );
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        return factory.updateExportDeclaration(
          node, node.modifiers, node.isTypeOnly, node.exportClause, rewriteLiteral(node.moduleSpecifier), node.attributes,
        );
      }
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const argument = factory.updateLiteralTypeNode(node.argument, rewriteLiteral(node.argument.literal));
        return factory.updateImportTypeNode(
          node, argument, node.attributes, node.qualifier, node.typeArguments, node.isTypeOf,
        );
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitEachChild(sourceFile, visit, context);
  };
}

const program = createTypeProgram();
failOnDiagnostics(program);

if (existsSync('./dist')) rmSync(resolve('./dist'), { recursive: true });

const inputs = fg.sync('src/**/*.{ts,tsx}', { ignore: ['**/*.d.ts'], absolute: true });

async function buildJs({ generate, format, dir, entryExtension }) {
  const bundle = await rollup({
    input: inputs,
    external: isExternal,
    plugins: [
      nodeResolve({ extensions: ['.js', '.jsx', '.ts', '.tsx'] }),
      babel({
        babelHelpers: 'bundled',
        babelrc: false,
        configFile: false,
        exclude: '/**/node_modules/**',
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
        presets: [
          ['babel-preset-solid', { generate, hydratable: true }],
          '@babel/preset-typescript',
        ],
      }),
      commonjs(),
    ],
    treeshake: true,
  });
  await bundle.write({
    format,
    dir: resolve(dir),
    preserveModules: true,
    preserveModulesRoot: 'src',
    entryFileNames: `[name]${entryExtension}`,
    chunkFileNames: `[name]${entryExtension}`,
  });
  await bundle.close();
}

await buildJs({ generate: 'dom', format: 'esm', dir: 'dist/esm', entryExtension: '.js' });
await buildJs({ generate: 'ssr', format: 'cjs', dir: 'dist/cjs', entryExtension: '.cjs' });

const emitResult = program.emit(undefined, undefined, undefined, false, {
  afterDeclarations: [declarationExtensionTransformer],
});
if (emitResult.emitSkipped) {
  console.error('TypeScript emit was skipped');
  process.exit(1);
}
