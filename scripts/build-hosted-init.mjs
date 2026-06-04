#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'apps/site/downloads');
const outFile = path.join(outDir, 'vaultproof-init.mjs');
const providersSource = path.join(root, 'apps/site/providers.json');
const providersOut = path.join(outDir, 'providers.json');
const manifestOut = path.join(outDir, 'vaultproof-init-manifest.json');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'packages/init-cli/package.json'), 'utf8'));

const esbuildCandidates = [
  path.join(root, 'node_modules/.bin/esbuild'),
  path.join(root, 'node_modules/tsx/node_modules/esbuild/bin/esbuild'),
  path.join(root, 'node_modules/wrangler/node_modules/esbuild/bin/esbuild'),
];

const esbuild = esbuildCandidates.find((candidate) => fs.existsSync(candidate));
if (!esbuild) {
  throw new Error('Could not find esbuild. Run npm install, then try again.');
}

fs.mkdirSync(outDir, { recursive: true });

run('npm', ['run', 'build', '--workspace', '@vaultproof/shamir']);

run(esbuild, [
  'packages/init-cli/src/index.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node18',
  '--legal-comments=none',
  `--outfile=${outFile}`,
]);

fs.chmodSync(outFile, 0o755);
fs.copyFileSync(providersSource, providersOut);

const files = [
  fileInfo('vaultproof-init.mjs', outFile),
  fileInfo('providers.json', providersOut),
];

fs.writeFileSync(
  manifestOut,
  JSON.stringify({
    name: 'vaultproof-init',
    version: pkg.version,
    generatedAt: new Date().toISOString(),
    install: 'curl -fsSL https://vaultproof.dev/install | sh',
    run: 'vaultproof-init',
    files,
  }, null, 2) + '\n',
);

console.log(`Built hosted VaultProof init ${pkg.version}`);
for (const file of files) {
  console.log(`- ${file.path} ${file.bytes} bytes sha256:${file.sha256}`);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed`);
  }
}

function fileInfo(relativePath, absolutePath) {
  const data = fs.readFileSync(absolutePath);
  return {
    path: relativePath,
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}
