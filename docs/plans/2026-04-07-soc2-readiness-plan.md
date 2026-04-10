# SOC 2 Type I Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the full SOC 2 Type I readiness infrastructure — policy docs (via Shasta), controls tracker, and automated compliance-check script covering GitHub, Supabase, and CF Workers.

**Architecture:** Shasta runs once locally to bootstrap policy templates. A `docs/compliance/` folder in this private repo tracks controls and evidence. A bash script auto-checks live systems and emits timestamped evidence JSON.

**Tech Stack:** Shasta (Python, local only), `gh` CLI, `wrangler` CLI, Supabase Management API, bash

**Privacy:** All compliance docs stay in this private repo (`zkvault`). Never commit to `vaultproof-open`.

---

### Task 1: Create the compliance folder structure

**Files:**
- Create: `docs/compliance/README.md`
- Create: `docs/compliance/controls/CC1-control-environment.md`
- Create: `docs/compliance/controls/CC2-communication.md`
- Create: `docs/compliance/controls/CC3-risk-assessment.md`
- Create: `docs/compliance/controls/CC5-control-activities.md`
- Create: `docs/compliance/controls/CC6-logical-access.md`
- Create: `docs/compliance/controls/CC7-system-operations.md`
- Create: `docs/compliance/controls/CC8-change-management.md`
- Create: `docs/compliance/controls/CC9-risk-mitigation.md`
- Create: `docs/compliance/controls/CONF-confidentiality.md`
- Create: `docs/compliance/evidence/.gitkeep`
- Create: `docs/compliance/policies/.gitkeep`

**Step 1: Create README.md**

```markdown
# VaultProof SOC 2 Type I Readiness

**Scope:** Security (CC1–CC9) + Confidentiality
**Target:** Type I (point-in-time snapshot)
**Status:** In Progress

## In-Scope Systems
- CF Workers — core proxy + key split logic
- Supabase — user data, vault metadata, auth
- CF Pages — frontend dashboard
- GitHub — source control, CI/CD
- Stripe — billing (PCI via Stripe)

## Control Status
| Criterion | Status | Last Checked |
|-----------|--------|--------------|
| CC1 Control Environment | 🔴 Not started | — |
| CC2 Communication | 🔴 Not started | — |
| CC3 Risk Assessment | 🔴 Not started | — |
| CC5 Control Activities | 🔴 Not started | — |
| CC6 Logical Access | 🔴 Not started | — |
| CC7 System Operations | 🔴 Not started | — |
| CC8 Change Management | 🔴 Not started | — |
| CC9 Risk Mitigation | 🔴 Not started | — |
| CONF Confidentiality | 🔴 Not started | — |

## Evidence Index
- See `evidence/` for timestamped compliance-check outputs and pentest reports
```

**Step 2: Create each controls file with this template** (repeat for all 9 files, updating criterion name/description):

```markdown
# CC1 — Control Environment

## Requirement
The entity demonstrates a commitment to integrity and ethical values, defines organizational structure, and ensures accountability for internal control.

## Current State
<!-- Describe what VaultProof currently does for this criterion -->

## Evidence
<!-- Links to evidence files or descriptions -->

## Gaps
<!-- List anything not yet in place -->

## Status
🔴 Not started
```

For CC6 (Logical Access) and CC7 (System Operations), note in the Current State section that existing evidence exists:
- CC7: `docs/plans/2026-04-01-security-pentest-report.md`, `SECURITY_AUDIT.md`
- CC6: Same pentest report covers access control findings

**Step 3: Commit**

```bash
git add docs/compliance/
git commit -m "feat(compliance): scaffold SOC 2 Type I readiness structure"
```

---

### Task 2: Install Shasta and generate policy drafts

**Files:**
- Create: `docs/compliance/policies/security-policy.md`
- Create: `docs/compliance/policies/access-control-policy.md`
- Create: `docs/compliance/policies/incident-response-policy.md`
- Create: `docs/compliance/policies/change-management-policy.md`
- Create: `docs/compliance/policies/vendor-management-policy.md`

**Step 1: Clone Shasta locally (outside this repo)**

```bash
cd /tmp
git clone https://github.com/transilienceai/shasta
cd shasta
pip install -e .
```

**Step 2: Initialize Shasta**

```bash
shasta init
```

Answer the questionnaire:
- Company type: SaaS / security
- Cloud provider: Other (not AWS/Azure — skip cloud scanning)
- Data types: API credentials, user PII
- Team size: <10
- Compliance framework: SOC 2

**Step 3: Run policy generation**

```bash
shasta generate-policies --output /tmp/shasta-policies/
```

**Step 4: Copy generated policies into compliance folder**

```bash
cp /tmp/shasta-policies/*.md /path/to/zkvault/docs/compliance/policies/
```

**Step 5: Adapt each policy** — open each file and:
- Replace any AWS/Azure references with "Cloudflare Workers"
- Replace generic company name with "VaultProof"
- Update data retention references to match Supabase (PostgreSQL)
- Remove sections that don't apply (e.g. on-prem server policies)

**Step 6: Verify policies cover these topics** (if Shasta misses any, write them manually):
- Information security policy
- Access control (who can access what systems)
- Incident response (what happens when a breach occurs)
- Change management (how code changes are reviewed/deployed)
- Vendor management (Supabase, Stripe, Cloudflare as vendors)

**Step 7: Commit**

```bash
git add docs/compliance/policies/
git commit -m "feat(compliance): add SOC 2 policy docs (Shasta-generated, adapted)"
```

---

### Task 3: Write the automated compliance check script

**Files:**
- Create: `docs/compliance/scripts/compliance-check.sh`

**Step 1: Create the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

DATE=$(date +%Y-%m-%d)
OUTPUT_FILE="docs/compliance/evidence/check-${DATE}.json"
PASS=0
FAIL=0
RESULTS=()

log_result() {
  local status="$1"
  local check="$2"
  local detail="$3"
  if [ "$status" = "PASS" ]; then
    echo "[PASS] $check"
    PASS=$((PASS + 1))
  else
    echo "[FAIL] $check — $detail"
    FAIL=$((FAIL + 1))
  fi
  RESULTS+=("{\"status\":\"$status\",\"check\":\"$check\",\"detail\":\"$detail\"}")
}

echo "=== VaultProof SOC 2 Compliance Check — $DATE ==="
echo ""

# ── GitHub Checks ──────────────────────────────────────────────────────────────
echo "## GitHub"

# Branch protection on main
BP=$(gh api repos/windsurftemplate/vaultproof/branches/main/protection 2>&1 || true)
if echo "$BP" | grep -q "required_pull_request_reviews"; then
  log_result "PASS" "GitHub: branch protection on main" "PR reviews required"
else
  log_result "FAIL" "GitHub: branch protection on main" "No PR review requirement found"
fi

# 2FA required for org
TWO_FA=$(gh api orgs/windsurftemplate 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('two_factor_requirement_enabled','false'))" 2>/dev/null || echo "false")
if [ "$TWO_FA" = "True" ] || [ "$TWO_FA" = "true" ]; then
  log_result "PASS" "GitHub: 2FA required for org" ""
else
  log_result "FAIL" "GitHub: 2FA required for org" "two_factor_requirement_enabled is false or inaccessible"
fi

# Secret scanning
SS=$(gh api repos/windsurftemplate/vaultproof/secret-scanning/alerts 2>&1 || true)
if echo "$SS" | grep -q "\[\]" || echo "$SS" | grep -q "number"; then
  log_result "PASS" "GitHub: secret scanning enabled" ""
else
  log_result "FAIL" "GitHub: secret scanning enabled" "Secret scanning may not be active"
fi

echo ""

# ── Supabase Checks ────────────────────────────────────────────────────────────
echo "## Supabase"

if [ -z "${SUPABASE_SERVICE_KEY:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  log_result "FAIL" "Supabase: env vars set" "SUPABASE_SERVICE_KEY or SUPABASE_PROJECT_REF not set"
else
  log_result "PASS" "Supabase: env vars set" ""

  # Check RLS on all tables
  RLS_RESULT=$(curl -s \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    "https://${SUPABASE_PROJECT_REF}.supabase.co/rest/v1/rpc/pg_tables" 2>/dev/null || echo "error")

  # Query information_schema for tables without RLS
  NO_RLS=$(curl -s \
    -X POST \
    -H "apikey: ${SUPABASE_SERVICE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    -H "Content-Type: application/json" \
    "https://${SUPABASE_PROJECT_REF}.supabase.co/rest/v1/rpc/check_rls" \
    -d '{}' 2>/dev/null || echo "error")

  # Simpler: use the management API to list tables
  TABLES=$(curl -s \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_KEY}" \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/tables" 2>/dev/null || echo "[]")

  if echo "$TABLES" | python3 -c "
import sys, json
tables = json.load(sys.stdin)
no_rls = [t['name'] for t in tables if not t.get('rls_enabled', True) and t.get('schema') == 'public']
if no_rls:
    print('FAIL:' + ','.join(no_rls))
else:
    print('PASS')
" 2>/dev/null | grep -q "PASS"; then
    log_result "PASS" "Supabase: RLS enabled on all public tables" ""
  else
    TABLES_NO_RLS=$(echo "$TABLES" | python3 -c "
import sys, json
tables = json.load(sys.stdin)
no_rls = [t['name'] for t in tables if not t.get('rls_enabled', True) and t.get('schema') == 'public']
print(','.join(no_rls) if no_rls else 'unknown')
" 2>/dev/null)
    log_result "FAIL" "Supabase: RLS enabled on all public tables" "Tables without RLS: $TABLES_NO_RLS"
  fi
fi

echo ""

# ── CF Workers Checks ──────────────────────────────────────────────────────────
echo "## CF Workers"

# Check wrangler.toml for plaintext secrets in [vars]
WRANGLER="packages/worker/wrangler.toml"
if [ -f "$WRANGLER" ]; then
  # Dangerous patterns: API keys, tokens, secrets in [vars]
  PLAINTEXT=$(grep -E '(KEY|SECRET|TOKEN|PASSWORD|PRIVATE)\s*=' "$WRANGLER" | grep -v "^#" | grep -v "ALLOWED_ORIGINS\|ADMIN_EMAILS\|REDIRECT_URI" || true)
  if [ -z "$PLAINTEXT" ]; then
    log_result "PASS" "CF Workers: no plaintext secrets in wrangler.toml [vars]" ""
  else
    log_result "FAIL" "CF Workers: no plaintext secrets in wrangler.toml [vars]" "Found: $PLAINTEXT"
  fi

  # Check staging env exists
  if grep -q "\[env.staging\]" "$WRANGLER"; then
    log_result "PASS" "CF Workers: staging environment defined" ""
  else
    log_result "FAIL" "CF Workers: staging environment defined" "No [env.staging] in wrangler.toml"
  fi
else
  log_result "FAIL" "CF Workers: wrangler.toml found" "File not found at $WRANGLER"
fi

echo ""

# ── Summary ────────────────────────────────────────────────────────────────────
echo "=== Summary ==="
echo "PASS: $PASS  |  FAIL: $FAIL"
echo ""

# Write evidence JSON
RESULTS_JSON=$(IFS=,; echo "[${RESULTS[*]}]")
cat > "$OUTPUT_FILE" <<EOF
{
  "date": "$DATE",
  "pass": $PASS,
  "fail": $FAIL,
  "checks": $RESULTS_JSON
}
EOF

echo "Evidence saved to $OUTPUT_FILE"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
```

**Step 2: Make it executable**

```bash
chmod +x docs/compliance/scripts/compliance-check.sh
```

**Step 3: Do a dry run to confirm it parses correctly**

```bash
bash -n docs/compliance/scripts/compliance-check.sh
```

Expected: no output (syntax is valid)

**Step 4: Commit**

```bash
git add docs/compliance/scripts/compliance-check.sh
git commit -m "feat(compliance): add automated SOC 2 compliance check script"
```

---

### Task 4: Run the compliance check and document gaps

**Step 1: Export required env vars**

```bash
export SUPABASE_SERVICE_KEY=<your service key>
export SUPABASE_PROJECT_REF=<your project ref>
```

**Step 2: Run the check from repo root**

```bash
cd /path/to/zkvault
bash docs/compliance/scripts/compliance-check.sh
```

Expected output: list of PASS/FAIL lines + evidence JSON written to `docs/compliance/evidence/check-YYYY-MM-DD.json`

**Step 3: For each FAIL, open the relevant controls file and add it as a gap**

Example — if "GitHub: 2FA required for org" fails, open `docs/compliance/controls/CC6-logical-access.md` and add:

```markdown
## Gaps
- [ ] Enable 2FA requirement for GitHub org (windsurftemplate)
  - Fix: GitHub → Org Settings → Authentication security → Require two-factor authentication
```

**Step 4: Fix any gaps that are quick wins** (e.g. enabling branch protection, secret scanning in GitHub settings), then re-run the check.

**Step 5: Commit the gap-annotated controls files**

```bash
git add docs/compliance/controls/ docs/compliance/evidence/
git commit -m "feat(compliance): document gaps from initial compliance check"
```

---

### Task 5: Map existing evidence to controls

**Step 1: Copy existing audit evidence into `docs/compliance/evidence/`**

```bash
cp docs/plans/2026-04-01-security-pentest-report.md docs/compliance/evidence/pentest-2026-04-01.md
cp SECURITY_AUDIT.md docs/compliance/evidence/security-audit-2026-03-21.md
```

**Step 2: Update controls files to reference this evidence**

In `docs/compliance/controls/CC7-system-operations.md`:

```markdown
## Evidence
- `evidence/pentest-2026-04-01.md` — Full pentest (26 findings, 9 CRITICALs fixed)
- `evidence/security-audit-2026-03-21.md` — Security architecture audit
```

In `docs/compliance/controls/CC6-logical-access.md`:

```markdown
## Evidence
- `evidence/pentest-2026-04-01.md` — Access control findings in pentest report
```

**Step 3: Update status in README.md**

Change any criteria with evidence from 🔴 to 🟡 (partial — evidence exists, gaps remain) or 🟢 (controls met).

**Step 4: Commit**

```bash
git add docs/compliance/
git commit -m "feat(compliance): map existing pentest/audit evidence to SOC 2 controls"
```

---

### Task 6: Update README with readiness status

**Step 1: Final pass on `docs/compliance/README.md`** — update the status table to reflect actual state after Tasks 1–5.

**Step 2: Add a "Next Steps" section:**

```markdown
## Next Steps to Type I Ready
- [ ] Remediate all open gaps in controls/ files
- [ ] Run compliance-check.sh until 0 failures
- [ ] Get all policies reviewed (self-review is fine for Type I prep)
- [ ] Select auditor (Johanson Group, A-LIGN, or similar)
- [ ] Schedule Type I audit
```

**Step 3: Commit**

```bash
git add docs/compliance/README.md
git commit -m "feat(compliance): finalize SOC 2 readiness tracker and next steps"
```
