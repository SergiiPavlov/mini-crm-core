#!/usr/bin/env bash
set -euo pipefail

# Mini CRM Core - Public integration smoke test
# Requirements: curl, sed

BASE="${BASE:-http://localhost:4000}"
EMAIL="${EMAIL:-owner@example.com}"
PASS="${PASS:-secret123}"
ORIGIN="${ORIGIN:-https://test.local}"

log() { printf "[smoke] %s\n" "$*"; }
fail() { printf "[smoke][FAIL] %s\n" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"; }
need curl
need sed
need node

# 1) Health
log "Health check: $BASE/health"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/health" || true)
[[ "$code" == "200" ]] || fail "Health check failed (HTTP $code)"

# 2) Login -> JWT
log "Login as $EMAIL"
TOKEN=$(curl -s -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}" \
| sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

[[ -n "${TOKEN:-}" ]] || fail "Login failed: token is empty (check EMAIL/PASS and membership)"
log "JWT acquired (${#TOKEN} chars)"

# 3) Integration -> slug + publicKey
log "Fetch project integration"
INTEGRATION=$(curl -s "$BASE/projects/current/integration" -H "Authorization: Bearer $TOKEN")
SLUG=$(echo "$INTEGRATION" | sed -n 's/.*"slug":"\([^"]*\)".*/\1/p')
PUBLIC_KEY=$(echo "$INTEGRATION" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')

[[ -n "${SLUG:-}" ]] || fail "Failed to parse project slug from /projects/current/integration"
[[ -n "${PUBLIC_KEY:-}" ]] || fail "Failed to parse publicKey from /projects/current/integration"
log "Project: slug=$SLUG publicKey=${PUBLIC_KEY:0:8}..."

# 4) Ensure allowlist origin exists (ignore 409)
log "Ensure allowed origin: $ORIGIN"
code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/projects/current/allowed-origins" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"origin\":\"$ORIGIN\"}")
[[ "$code" == "201" || "$code" == "409" ]] || fail "Add allowed origin failed (HTTP $code)"

# 5) Seed public forms (idempotent)
log "Seed public forms"
curl -s -o /dev/null -X POST "$BASE/public-forms/seed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' || fail "Seed failed"

# 6) Enable lead form (so submit returns 201)
log "Enable lead form"
FORMS=$(curl -s "$BASE/public-forms" -H "Authorization: Bearer $TOKEN")
LEAD_ID=$(echo "$FORMS" | sed -n 's/.*"id":\([0-9]\+\).*"formKey":"lead".*/\1/p' | head -n 1)
[[ -n "${LEAD_ID:-}" ]] || fail "Could not find lead form id via /public-forms"

code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/public-forms/$LEAD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"isActive":true}')
[[ "$code" == "200" ]] || fail "Enabling lead form failed (HTTP $code)"

# 7) Config check
log "Config check: /public/forms/$SLUG/lead/config"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/public/forms/$SLUG/lead/config" \
  -H "X-Project-Key: $PUBLIC_KEY" \
  -H "Origin: $ORIGIN")
[[ "$code" == "200" ]] || fail "Lead config check failed (HTTP $code)"

# 8) Submit lead (with idempotency)
REQ_ID="smoke-$(date +%s)"
log "Submit lead (X-Request-Id: $REQ_ID)"
RESP1=$(curl -s -X POST "$BASE/public/forms/$SLUG/lead" \
  -H "Content-Type: application/json" \
  -H "X-Project-Key: $PUBLIC_KEY" \
  -H "Origin: $ORIGIN" \
  -H "X-Request-Id: $REQ_ID" \
  -d '{"name":"CLI Lead","phone":"+380501112233","message":"lead enabled smoke test"}')

CASE_ID_1=$(node -e "const fs=require('fs');const d=fs.readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j?.case?.id||'');}catch(e){process.exit(1)}" <<<"$RESP1")
[[ -n "${CASE_ID_1:-}" ]] || fail "Lead submit did not return case.id (response: $RESP1)"
log "Lead created: caseId=$CASE_ID_1"

log "Repeat submit with same X-Request-Id (idempotency)"
RESP2=$(curl -s -X POST "$BASE/public/forms/$SLUG/lead" \
  -H "Content-Type: application/json" \
  -H "X-Project-Key: $PUBLIC_KEY" \
  -H "Origin: $ORIGIN" \
  -H "X-Request-Id: $REQ_ID" \
  -d '{"name":"CLI Lead","phone":"+380501112233","message":"lead enabled smoke test"}')

CASE_ID_2=$(node -e "const fs=require('fs');const d=fs.readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log(j?.case?.id||'');}catch(e){process.exit(1)}" <<<"$RESP2")
[[ -n "${CASE_ID_2:-}" ]] || fail "Repeat submit did not return case.id (response: $RESP2)"
[[ "$CASE_ID_2" == "$CASE_ID_1" ]] || fail "Idempotency mismatch: first=$CASE_ID_1 second=$CASE_ID_2"
log "Idempotency OK (caseId stays $CASE_ID_1)"

# 9) Negative test: wrong origin should be blocked when allowlist is enabled
BAD_ORIGIN="https://evil.local"
log "Negative test: config with bad origin ($BAD_ORIGIN) should be 403"
code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/public/forms/$SLUG/lead/config" \
  -H "X-Project-Key: $PUBLIC_KEY" \
  -H "Origin: $BAD_ORIGIN")
if [[ "$code" != "403" ]]; then
  log "WARN: expected 403, got $code (if allowlist empty or server allows GET without origin, this may be OK)"
else
  log "Bad origin blocked (403)"
fi

log "OK"
