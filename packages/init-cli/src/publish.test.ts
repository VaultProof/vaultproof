#!/usr/bin/env tsx
/**
 * Publish-time invariants.
 *
 * Verifies that the package is structured correctly for distribution.
 * Running this before shipping catches issues that otherwise only
 * surface when a user tries to run `vaultproof-init`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else { failed++; console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); }
}

// ── package.json fields ──────────────────────────────────────────────────
console.log('── package.json ──');
{
  const pkgPath = path.join(PKG_ROOT, 'package.json');
  ok('package.json exists', fs.existsSync(pkgPath));
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;

  ok('name is @vaultproof/init', pkg.name === '@vaultproof/init');
  ok('has version', typeof pkg.version === 'string' && (pkg.version as string).length > 0);
  ok('type is module', pkg.type === 'module');
  ok('has description', typeof pkg.description === 'string' && (pkg.description as string).length > 10);
  ok('has license MIT', pkg.license === 'MIT');
  ok('has author', typeof pkg.author === 'string');
  ok('has homepage', typeof pkg.homepage === 'string');
  ok('has repository', typeof pkg.repository === 'object');
  ok('has bugs', typeof pkg.bugs === 'object');

  const bin = pkg.bin as Record<string, string>;
  ok('bin.vaultproof-init points to dist/index.js', bin?.['vaultproof-init'] === 'dist/index.js');

  const files = pkg.files as string[];
  ok('files includes dist', Array.isArray(files) && files.includes('dist'));
  ok('files includes providers.json', files.includes('providers.json'));
  ok('files includes README.md', files.includes('README.md'));
  ok('files includes LICENSE', files.includes('LICENSE'));

  const engines = pkg.engines as Record<string, string>;
  ok('engines.node >= 18', /^>=?\s*1[89]|^>=?\s*[2-9][0-9]/.test(engines?.node || ''));

  const scripts = pkg.scripts as Record<string, string>;
  ok('has prepublishOnly script', typeof scripts?.prepublishOnly === 'string');
  ok('prepublishOnly rebuilds dist', scripts.prepublishOnly.includes('build'));

  const publishConfig = pkg.publishConfig as Record<string, string>;
  ok('publishConfig.access is public', publishConfig?.access === 'public');

  const deps = pkg.dependencies as Record<string, string>;
  ok('depends on @vaultproof/shamir', typeof deps?.['@vaultproof/shamir'] === 'string');
  ok('depends on chalk', typeof deps?.chalk === 'string');
  ok('depends on ora', typeof deps?.ora === 'string');
}

// ── Required files present ───────────────────────────────────────────────
console.log('── required files ──');
{
  ok('README.md exists', fs.existsSync(path.join(PKG_ROOT, 'README.md')));
  ok('LICENSE exists', fs.existsSync(path.join(PKG_ROOT, 'LICENSE')));
  ok('providers.json exists', fs.existsSync(path.join(PKG_ROOT, 'providers.json')));

  const readme = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf-8');
  ok('README mentions vaultproof-init', readme.includes('vaultproof-init'));
  ok('README has usage example', readme.includes('vaultproof-init'));
  ok('README has MIT license line', readme.includes('MIT'));
  ok('README under 20 KB', readme.length < 20_000, `${readme.length} bytes`);

  const license = fs.readFileSync(path.join(PKG_ROOT, 'LICENSE'), 'utf-8');
  ok('LICENSE is MIT', license.includes('MIT License'));

  const providers = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'providers.json'), 'utf-8'));
  ok('providers.json has providers array', Array.isArray(providers.providers));
  ok('providers.json has at least 10 providers', providers.providers.length >= 10);
}

// ── Compiled dist ────────────────────────────────────────────────────────
console.log('── compiled dist ──');
{
  const distDir = path.join(PKG_ROOT, 'dist');
  ok('dist/ exists', fs.existsSync(distDir));

  const distIndex = path.join(distDir, 'index.js');
  ok('dist/index.js exists', fs.existsSync(distIndex));

  const indexContent = fs.readFileSync(distIndex, 'utf-8');
  ok('dist/index.js has shebang', indexContent.startsWith('#!/usr/bin/env node'));
  ok('dist/index.js imports shamir', indexContent.includes('@vaultproof/shamir'));

  const distFiles = fs.readdirSync(distDir);
  const testFiles = distFiles.filter((f) => f.includes('.test.'));
  ok('no test files in dist', testFiles.length === 0, testFiles.join(', '));

  const resolvedPath = path.join(distDir, '..', 'providers.json');
  ok('providers.json resolvable from dist/', fs.existsSync(resolvedPath));
}

// ── No accidentally-committed secrets in package files ──────────────────
console.log('── no accidentally-committed secrets ──');
{
  const distDir = path.join(PKG_ROOT, 'dist');
  const allDistFiles = fs.readdirSync(distDir).filter((f) => f.endsWith('.js'));
  const patterns = [
    { name: 'OpenAI key', re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
    { name: 'Stripe live key', re: /sk_live_[A-Za-z0-9]{20,}/ },
    { name: 'Supabase JWT', re: /eyJ[A-Za-z0-9_-]{40,}\.eyJ[A-Za-z0-9_-]{40,}/ },
    { name: 'vp_live_ key', re: /vp_live_[A-Za-z0-9]{20,}/ },
  ];
  let leaks = 0;
  for (const f of allDistFiles) {
    const content = fs.readFileSync(path.join(distDir, f), 'utf-8');
    for (const p of patterns) {
      if (p.re.test(content)) {
        console.log(`    SECRET-LIKE: ${p.name} in dist/${f}`);
        leaks++;
      }
    }
  }
  ok('no secret-like strings in dist files', leaks === 0);
}

// ── doctor command ──────────────────────────────────────────────────────
console.log('\n── doctor command presence in dist ──');
import { readFileSync as readFS } from 'node:fs';
import { fileURLToPath as fURL } from 'node:url';
import { join as joinPath, dirname as dirPath } from 'node:path';
const __doctorDir = dirPath(fURL(import.meta.url));
const distSrc = readFS(joinPath(__doctorDir, '..', 'dist', 'index.js'), 'utf-8');
ok('doctor command branch present', distSrc.includes("cmd === 'doctor'"));
ok('runDoctor function present', distSrc.includes('runDoctor'));
ok('doctor in usage string', distSrc.includes("vaultproof-init doctor"));
ok('legacy migration command branch present', distSrc.includes("cmd === 'migrate-from-legacy'"));
ok('short -y flag supported', distSrc.includes("flags.has('-y')"));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
