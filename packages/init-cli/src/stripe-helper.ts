/**
 * Stripe SDK v14+ helper.
 *
 * Scans the user's project for `new Stripe(` constructors and shows
 * exactly where and how to add `host: 'init.vaultproof.dev'`.
 *
 * Stripe is the only major SDK that doesn't support a BASE_URL env var,
 * so it needs one line of code change. This module finds the exact file
 * and line number so the user doesn't have to hunt for it.
 */
import fs from 'node:fs';
import path from 'node:path';

export interface StripeFinding {
  file: string;
  line: number;
  content: string;
  alreadyPatched: boolean;
}

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.worktrees', 'dist', 'build', '.vercel', '.output', 'opensrc', 'vendor', '.cache']);

function walkFiles(dir: string, results: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walkFiles(path.join(dir, entry.name), results);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (SCAN_EXTENSIONS.has(ext)) {
        results.push(path.join(dir, entry.name));
      }
    }
  }
}

/**
 * Find all `new Stripe(` constructors in the project.
 * Returns the file, line number, line content, and whether
 * `init.vaultproof.dev` is already in the constructor.
 */
export function findStripeConstructors(projectDir: string): StripeFinding[] {
  const files: string[] = [];
  walkFiles(projectDir, files);

  const findings: StripeFinding[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = fs.readFileSync(file, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('new Stripe(') || line.includes('new Stripe (')) {
        // Check if init.vaultproof.dev is anywhere in the file
        // (the host config might be in a different code path or a comment)
        const alreadyPatched = content.includes('init.vaultproof.dev');

        findings.push({
          file: path.relative(projectDir, file),
          line: i + 1,
          content: line.trim(),
          alreadyPatched,
        });
      }
    }
  }

  return findings;
}
