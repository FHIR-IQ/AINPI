#!/usr/bin/env bash
#
# scan-anti-patterns.sh — AINPI repo-specific anti-pattern scanner
#
# Runs against the DIFF of changed files (not the full repo) on every PR + push.
# Catches three classes of issue that the existing gitleaks + CodeQL workflows don't:
#
#   1. Hardcoded API keys / service-account credentials
#   2. Cost-overbill patterns (BQ queries without per-query caps, re-enabling
#      paid APIs that were deliberately disabled, direct BigQuery client
#      instantiation outside the project's bounded helper)
#   3. Public-framing policy violations (state-agency attribution per CLAUDE.md)
#
# Each rule prints offending file:line + a short remediation pointer.
# Exit code 1 if any rule fires; 0 if clean.
#
# Local run:  bash .github/scripts/scan-anti-patterns.sh
# CI run:     .github/workflows/anti-patterns.yml invokes this

set -u

# ---------------------------------------------------------------------------
# Determine which files changed
# ---------------------------------------------------------------------------
if [ -n "${GITHUB_BASE_REF:-}" ] && [ "${GITHUB_EVENT_NAME:-}" = "pull_request" ]; then
  # PR: diff against base branch
  git fetch origin "$GITHUB_BASE_REF" --depth=1 >/dev/null 2>&1
  CHANGED_FILES=$(git diff --name-only --diff-filter=AM "origin/$GITHUB_BASE_REF...HEAD")
elif [ -n "${GITHUB_SHA:-}" ]; then
  # Push: diff against previous commit
  CHANGED_FILES=$(git diff --name-only --diff-filter=AM HEAD~1..HEAD)
else
  # Local: diff against main (or all staged files if no main)
  if git rev-parse --verify main >/dev/null 2>&1; then
    CHANGED_FILES=$(git diff --name-only --diff-filter=AM main...HEAD)
  else
    CHANGED_FILES=$(git diff --cached --name-only --diff-filter=AM)
  fi
fi

if [ -z "$CHANGED_FILES" ]; then
  echo "scan-anti-patterns: no changed files to scan."
  exit 0
fi

echo "scan-anti-patterns: scanning $(echo "$CHANGED_FILES" | wc -l | tr -d ' ') changed files…"

ERRORS=()
record() {
  ERRORS+=("$1")
}

# Helper: filter changed files by extension, exclude common noise paths
filter_files() {
  local pattern="$1"
  local exclude_paths='node_modules/|\.next/|/\.private/|/\.superpowers/|playwright-report/|/tests/|test-results/'
  echo "$CHANGED_FILES" | grep -E "$pattern" | grep -Ev "$exclude_paths" | while read -r f; do
    [ -f "$f" ] && echo "$f"
  done
}

# Helper: grep a pattern in a file, return file:line:match for each hit
grep_in() {
  local pattern="$1"
  local file="$2"
  grep -n -E "$pattern" "$file" 2>/dev/null
}

# ---------------------------------------------------------------------------
# RULE 1 — Hardcoded Google API key pattern (AIza…)
# ---------------------------------------------------------------------------
echo "→ Rule 1: hardcoded Google API keys (AIza…)"
for f in $(filter_files '.'); do
  while IFS= read -r match; do
    record "$f: $match  [Rule 1: hardcoded Google API key — store in env var, never commit]"
  done < <(grep_in 'AIza[0-9A-Za-z_-]{35}' "$f")
done

# ---------------------------------------------------------------------------
# RULE 2 — Embedded service-account JSON credential block
# ---------------------------------------------------------------------------
echo "→ Rule 2: embedded service-account JSON keys"
for f in $(filter_files '.'); do
  while IFS= read -r match; do
    record "$f: $match  [Rule 2: service-account JSON — store in env var GCP_SERVICE_ACCOUNT_KEY]"
  done < <(grep_in '"type":[[:space:]]*"service_account"' "$f")
done

# ---------------------------------------------------------------------------
# RULE 3 — Python BigQuery query without maximum_bytes_billed / job_config
# Catches: client.query("…")  where the file does NOT also reference
# either maximum_bytes_billed or the project's bq_job_config() helper.
# Exempts: tests/ + the _cohorts helper itself (defines bq_job_config)
# ---------------------------------------------------------------------------
echo "→ Rule 3: Python BQ queries missing per-query cap"
for f in $(filter_files '\.py$'); do
  case "$f" in
    analysis/claims_sources/_cohorts.py) continue ;;  # defines the helper
  esac
  if grep -qE 'client\.query\(' "$f"; then
    if ! grep -qE 'job_config=bq_job_config\(|maximum_bytes_billed' "$f"; then
      record "$f: BQ query without per-query cap  [Rule 3: import bq_job_config from analysis.claims_sources._cohorts and pass job_config=bq_job_config()]"
    fi
  fi
done

# ---------------------------------------------------------------------------
# RULE 4 — TS/JS direct BigQuery client outside the bounded helper
# The project's queryBigQuery() helper applies DEFAULT_MAX_BYTES_BILLED;
# anything bypassing it can produce unbounded cost.
# ---------------------------------------------------------------------------
echo "→ Rule 4: direct BigQuery client outside frontend/src/lib/bigquery.ts"
for f in $(filter_files '\.(ts|tsx|js|mjs|cjs)$'); do
  case "$f" in
    frontend/src/lib/bigquery.ts) continue ;;  # the helper itself
  esac
  if grep -qE 'new BigQuery\(' "$f"; then
    record "$f: direct \`new BigQuery(\` instantiation  [Rule 4: use queryBigQuery() from @/lib/bigquery so DEFAULT_MAX_BYTES_BILLED applies]"
  fi
done

# ---------------------------------------------------------------------------
# RULE 5 — Re-enabling deliberately-disabled Maps/Places APIs
# These were disabled at the project level after a cost incident.
# Catch references in code, workflows, or configs that would re-introduce them.
# ---------------------------------------------------------------------------
echo "→ Rule 5: references to disabled Maps/Places APIs"
DISABLED_APIS_PATTERN='(places|maps-android-backend|maps-ios-backend|maps-backend|maps-embed-backend|geocoding-backend|geolocation|directions-backend|distance-matrix-backend|elevation-backend|places-backend)\.googleapis\.com'
for f in $(filter_files '\.(ts|tsx|js|mjs|py|yml|yaml|json|toml|md)$'); do
  case "$f" in
    CLAUDE.md|README.md) continue ;;  # docs may discuss the policy
    .github/scripts/scan-anti-patterns.sh) continue ;;  # this file itself
    .github/workflows/anti-patterns.yml) continue ;;
  esac
  while IFS= read -r match; do
    record "$f: $match  [Rule 5: Maps/Places API was deliberately disabled at project level — do not re-enable without explicit cost review]"
  done < <(grep_in "$DISABLED_APIS_PATTERN" "$f")
done

# ---------------------------------------------------------------------------
# RULE 6 — State-agency attribution language (per CLAUDE.md Public Framing)
# AINPI cannot be framed as produced for / prepared for / guided by /
# shaped by any state agency. Catches the specific patterns.
# ---------------------------------------------------------------------------
echo "→ Rule 6: state-agency attribution language"
ATTRIBUTION_PATTERN='(produced for|prepared for|guided by|shaped by|in partnership with|on behalf of)[[:space:]]+(DMAS|state[[:space:]]+Medicaid|the[[:space:]]+state[[:space:]]+of)'
for f in $(filter_files '\.(md|ts|tsx|js|mjs|py|html)$'); do
  while IFS= read -r match; do
    record "$f: $match  [Rule 6: per CLAUDE.md Public Framing, AINPI cannot be represented as produced for / guided by any state agency]"
  done < <(grep_in "$ATTRIBUTION_PATTERN" "$f")
done

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [ ${#ERRORS[@]} -gt 0 ]; then
  echo ""
  echo "✗ scan-anti-patterns FAILED — ${#ERRORS[@]} issue(s):"
  for e in "${ERRORS[@]}"; do
    echo "  • $e"
  done
  echo ""
  echo "See CLAUDE.md → 'GCP cost controls' and 'Public framing constraints' for the policies these rules enforce."
  exit 1
fi

echo "✓ scan-anti-patterns passed."
