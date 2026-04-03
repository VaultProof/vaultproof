/**
 * Scheduled Scan — extracted core scan logic.
 *
 * `executeScan` performs steps 4-11 of a scan (fetch repo, scan files,
 * verify keys, filter allowlists, insert findings, update scan record).
 * Used by both the interactive `handleScan` route and the cron handler.
 */

import type { Env } from '../types.js';
import { getSupabase } from './supabase.js';
import { githubApi } from './github.js';
import { auditLog } from './github.js';
import {
  KEY_PATTERNS,
  SDK_INIT_PATTERNS,
  HTTP_URL_REGEX,
  PROVIDER_URLS,
  PROCESS_ENV_REGEX,
  OS_ENVIRON_REGEX,
  ENV_VAR_MAP,
  PLATFORM_FILES,
  MAX_FILES,
  MAX_FILE_LINES,
  MAX_LINE_LENGTH,
  MIN_ENTROPY,
  shannonEntropy,
  detectProvider,
  shouldScanFile,
  recommendMode,
  verifyKey,
  getProviderInfo,
} from './secret-patterns.js';

export interface ScanResult {
  findings: Array<{
    envName: string;
    provider: string;
    file: string;
    line: number | null;
    mode: string;
    verified: string;
    source: string;
    maskedValue: string;
    value: string;
  }>;
  platforms: string[];
  keysFound: number;
  keysActive: number;
  keysRevoked: number;
}

/**
 * Execute a full repo scan (steps 4-11 from handleScan).
 *
 * Creates findings, verifies keys, filters allowlists, stores results in DB,
 * and returns summary counts. Raw key values are zeroed before returning.
 */
export async function executeScan(
  env: Env,
  userId: string,
  token: string,
  repoFullName: string,
  branch: string | undefined,
  scanId: string,
): Promise<ScanResult> {
  const supabase = getSupabase(env);

  // 4. Fetch repo metadata
  const repo = await githubApi(token, `/repos/${repoFullName}`);
  const targetBranch = branch || repo.default_branch;
  await supabase
    .from('scan_results')
    .update({ branch: targetBranch })
    .eq('id', scanId);

  // 5. Fetch file tree
  const tree = await githubApi(
    token,
    `/repos/${repoFullName}/git/trees/${targetBranch}?recursive=1`,
  );
  const allTreeFiles = tree.tree as Array<{
    path: string;
    sha: string;
    type: string;
  }>;
  const scannableFiles = allTreeFiles
    .filter((f) => f.type === 'blob' && shouldScanFile(f.path))
    .slice(0, MAX_FILES);

  // 6. Detect platforms
  const allPaths = allTreeFiles.map((f) => f.path);
  const platformSet = new Set<string>();
  for (const filePath of allPaths) {
    const platform = PLATFORM_FILES[filePath];
    if (platform) platformSet.add(platform);
    if (filePath.startsWith('.github/workflows/'))
      platformSet.add('GitHub Actions');
  }
  const platforms = [...platformSet];

  // Internal findings array (raw values kept in memory only, never stored)
  const findings: ScanResult['findings'] = [];
  const seenValues = new Set<string>();

  // 7. Fetch file contents in batches of 10
  const BLOB_BATCH = 10;
  const fileContents: Array<{ path: string; content: string }> = [];
  for (let i = 0; i < scannableFiles.length; i += BLOB_BATCH) {
    const batch = scannableFiles.slice(i, i + BLOB_BATCH);
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          const blob = await githubApi(
            token,
            `/repos/${repoFullName}/git/blobs/${file.sha}`,
          );
          const raw = atob(blob.content.replace(/\n/g, ''));
          if (raw.length > 500_000) return null;
          return { path: file.path, content: raw };
        } catch {
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) fileContents.push(r);
    }
  }

  // 8-10. Scan each file
  for (const file of fileContents) {
    const basename = file.path.split('/').pop() || '';
    const isEnvFile = basename === '.env' || basename.startsWith('.env.');

    if (isEnvFile) {
      // Phase A: .env files — parse KEY=VALUE pairs
      for (const line of file.content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const name = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (!value || value.length < 10 || seenValues.has(value)) continue;

        const provider = detectProvider(value);
        if (!provider && shannonEntropy(value) < MIN_ENTROPY) continue;

        seenValues.add(value);
        findings.push({
          envName: name,
          provider: provider || 'unknown',
          file: file.path,
          line: null,
          mode: provider ? recommendMode(provider) : 'env-injection',
          verified: 'unknown',
          source: 'current',
          maskedValue: value.slice(0, 6) + '...' + value.slice(-4),
          value,
        });
      }
    } else {
      const lines = file.content.split('\n');
      if (lines.length > MAX_FILE_LINES) continue;

      // Phase B: Hardcoded strings — match quoted strings against KEY_PATTERNS
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.length > MAX_LINE_LENGTH) continue;
        // Skip comment lines
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
        // Skip lines that look like regex patterns, test fixtures, or pattern definitions
        if (/\/(.*?)\//g.test(trimmed) && (trimmed.includes('pattern') || trimmed.includes('regex') || trimmed.includes('RegExp'))) continue;
        const stringMatches = line.matchAll(
          /["'`]([^"'`]{10,512})["'`]/g,
        );
        for (const m of stringMatches) {
          const val = m[1];
          if (seenValues.has(val)) continue;
          // Skip values that are too short to be real keys (just prefixes)
          if (val.length < 20) continue;
          // Skip values that contain regex metacharacters (likely a pattern, not a key)
          if (/[\\^$.*+?{}()|[\]]/.test(val)) continue;
          // Skip placeholder/example values
          if (/^(sk-|sk_test_|sk_live_|pk_test_|pk_live_)\.{3,}|xxx|your[_-]|example|placeholder|TODO/i.test(val)) continue;
          const provider = detectProvider(val);
          if (!provider) continue;
          seenValues.add(val);
          findings.push({
            envName: `${provider.toUpperCase()}_API_KEY`,
            provider,
            file: file.path,
            line: i + 1,
            mode: recommendMode(provider),
            verified: 'unknown',
            source: 'current',
            maskedValue: val.slice(0, 6) + '...' + val.slice(-4),
            value: val,
          });
        }
      }

      // Phase C: Code-level — SDK inits, HTTP URLs, env var refs
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];

        // SDK init patterns
        for (const { pattern, provider } of SDK_INIT_PATTERNS) {
          pattern.lastIndex = 0;
          let sdkMatch: RegExpExecArray | null;
          while ((sdkMatch = pattern.exec(ln)) !== null) {
            const snippet = ln
              .slice(sdkMatch.index, sdkMatch.index + 40)
              .trim();
            findings.push({
              envName: `${provider.toUpperCase()}_API_KEY`,
              provider,
              file: file.path,
              line: i + 1,
              mode: 'sdk-init',
              verified: 'unknown',
              source: 'current',
              maskedValue:
                snippet.length > 36
                  ? snippet.slice(0, 36) + '...'
                  : snippet,
              value: '',
            });
          }
        }

        // HTTP URL patterns
        HTTP_URL_REGEX.lastIndex = 0;
        let urlMatch: RegExpExecArray | null;
        while ((urlMatch = HTTP_URL_REGEX.exec(ln)) !== null) {
          const host = urlMatch[1];
          const provider = PROVIDER_URLS[host];
          if (!provider) continue;
          const url =
            urlMatch[0].length > 60
              ? urlMatch[0].slice(0, 60) + '...'
              : urlMatch[0];
          findings.push({
            envName: `${provider.toUpperCase()}_API_KEY`,
            provider,
            file: file.path,
            line: i + 1,
            mode: 'http-url',
            verified: 'unknown',
            source: 'current',
            maskedValue: url,
            value: '',
          });
        }

        // Env var references (process.env.X / os.environ["X"])
        PROCESS_ENV_REGEX.lastIndex = 0;
        let envMatch: RegExpExecArray | null;
        while ((envMatch = PROCESS_ENV_REGEX.exec(ln)) !== null) {
          const varName = envMatch[1];
          const provider = ENV_VAR_MAP[varName];
          if (!provider) continue;
          findings.push({
            envName: varName,
            provider,
            file: file.path,
            line: i + 1,
            mode: 'env-ref',
            verified: 'unknown',
            source: 'current',
            maskedValue: `process.env.${varName}`,
            value: '',
          });
        }

        OS_ENVIRON_REGEX.lastIndex = 0;
        while ((envMatch = OS_ENVIRON_REGEX.exec(ln)) !== null) {
          const varName = envMatch[1];
          const provider = ENV_VAR_MAP[varName];
          if (!provider) continue;
          findings.push({
            envName: varName,
            provider,
            file: file.path,
            line: i + 1,
            mode: 'env-ref',
            verified: 'unknown',
            source: 'current',
            maskedValue: `os.environ["${varName}"]`,
            value: '',
          });
        }
      }
    }
  }

  // 11. Scan git history (last 10 commits — reduced for Worker CPU limits)
  try {
    const commits = await githubApi(
      token,
      `/repos/${repoFullName}/commits?sha=${targetBranch}&per_page=10`,
    );
    for (const commit of (commits as any[]).slice(0, 10)) {
      let detail: any;
      try {
        detail = await githubApi(
          token,
          `/repos/${repoFullName}/commits/${commit.sha}`,
        );
      } catch {
        continue;
      }
      for (const file of detail.files || []) {
        if (!file.patch) continue;
        for (const line of (file.patch as string).split('\n')) {
          if (!line.startsWith('-') || line.startsWith('---')) continue;
          const content = line.slice(1);
          const matches = content.matchAll(/["'`=]([^"'`\s]{10,512})/g);
          for (const m of matches) {
            const val = m[1];
            if (seenValues.has(val)) continue;
            const provider = detectProvider(val);
            if (!provider) continue;
            seenValues.add(val);
            findings.push({
              envName: `${provider.toUpperCase()}_API_KEY`,
              provider,
              file: `${file.filename} (deleted)`,
              line: null,
              mode: recommendMode(provider),
              verified: 'unknown',
              source: 'git-history',
              maskedValue: val.slice(0, 6) + '...' + val.slice(-4),
              value: val,
            });
          }
        }
      }
    }
  } catch {
    // Git history scan failed — continue without it
  }

  // 12. Verify keys (max 20, batches of 5) — skip code-level findings
  const CODE_LEVEL_MODES = new Set(['sdk-init', 'http-url', 'env-ref']);
  const keyFindings = findings.filter((f) => !CODE_LEVEL_MODES.has(f.mode));
  for (let i = 0; i < Math.min(keyFindings.length, 20); i += 5) {
    const batch = keyFindings.slice(i, i + 5);
    await Promise.all(
      batch.map(async (f) => {
        f.verified = await verifyKey(f.value, f.provider);
      }),
    );
  }

  // Zero raw key values — only maskedValue persists
  for (const f of findings) {
    f.value = '';
  }

  // 12b. Filter out allowlisted findings
  const { data: allowlistEntries } = await supabase
    .from('scan_allowlists')
    .select('pattern_type, pattern')
    .eq('user_id', userId)
    .or(`repo_full_name.eq.${repoFullName},repo_full_name.is.null`);

  if (allowlistEntries && allowlistEntries.length > 0) {
    const beforeCount = findings.length;
    for (let i = findings.length - 1; i >= 0; i--) {
      const f = findings[i];
      for (const entry of allowlistEntries) {
        let matched = false;
        if (entry.pattern_type === 'file_path') {
          if (f.file && (f.file === entry.pattern || f.file.startsWith(entry.pattern))) {
            matched = true;
          }
        } else if (entry.pattern_type === 'env_name') {
          if (f.envName && f.envName === entry.pattern) {
            matched = true;
          }
        }
        if (matched) {
          findings.splice(i, 1);
          break;
        }
      }
    }
    const filtered = beforeCount - findings.length;
    if (filtered > 0) {
      auditLog(env, userId, scanId, 'allowlist_filtered', { filtered, total: beforeCount });
    }
  }

  // 13. Store findings
  for (const f of findings) {
    await supabase.from('scan_findings').insert({
      id: crypto.randomUUID(),
      scan_id: scanId,
      env_name: f.envName,
      provider: f.provider,
      file: f.file,
      line: f.line,
      mode: f.mode,
      verified: f.verified,
      source: f.source,
      action: 'pending',
      masked_value: f.maskedValue,
      created_at: new Date().toISOString(),
    });
  }

  // 14. Update scan result
  const keysActive = keyFindings.filter(
    (f) => f.verified === 'active',
  ).length;
  const keysRevoked = keyFindings.filter(
    (f) => f.verified === 'revoked',
  ).length;
  const keysFound = keyFindings.length;

  await supabase
    .from('scan_results')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      keys_found: keysFound,
      keys_active: keysActive,
      keys_revoked: keysRevoked,
      platforms,
    })
    .eq('id', scanId);
  auditLog(env, userId, scanId, 'completed_scan', {
    keysFound,
    keysActive,
    keysRevoked,
  });

  return { findings, platforms, keysFound, keysActive, keysRevoked };
}
