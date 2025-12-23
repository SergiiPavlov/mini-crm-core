#!/usr/bin/env bash
set -euo pipefail

# mini-crm-core — one-command public integration smoke test
#
# What it checks (single chain):
# 1) /health
# 2) /auth/login → JWT
# 3) /projects/current/integration → slug + publicKey
# 4) POST /projects/current/allowed-origins (201 or 409 is OK)
# 5) POST /public-forms/seed
# 6) GET /public/forms/:slug/feedback/config with X-Project-Key + Origin
#
# Requirements: curl + node (for JSON parsing)

BASE="${BASE:-http://localhost:4000}"
EMAIL="${EMAIL:-owner@example.com}"
PASSWORD="${PASSWORD:-${PASS:-secret123}}"
ORIGIN_DEFAULT="https://test.local"
ORIGIN="${ORIGIN:-$ORIGIN_DEFAULT}"

# Optional: make origin unique per run (to avoid allowlist collisions during repeated testing)
if [[ "${SMOKE_ORIGIN_UNIQUE:-0}" == "1" && "$ORIGIN" == "$ORIGIN_DEFAULT" ]]; then
  ORIGIN="https://test-$(date +%s).local"
fi

log()  { printf "[smoke] %s\n" "$*"; }
fail() { printf "❌ SMOKE FAIL: %s\n" "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "Missing dependency: $1"; }
need curl
need node

http_code() {
  # usage: http_code <curl args...>
  curl -sS -o /dev/null -w "%{http_code}" "$@" || true
}

json_get() {
  # usage: json_get '<js expr>' <<< "$json"
  # Example: json_get 'j.token'
  node -e "const fs=require('fs');const s=fs.readFileSync(0,'utf8');let j={};try{j=JSON.parse(s)}catch(e){};const v=(()=>{try{return ${1}}catch(e){return ''}})();process.stdout.write((v??'')+'');"
}

# 1) Health
log "Health: $BASE/health"
code="$(http_code "$BASE/health")"
[[ "$code" == "200" ]] || fail "Health check failed (HTTP $code). Is server running: npm run dev ?"

# 2) Login
log "Login: $EMAIL"
LOGIN_JSON="$(curl -sS -X POST "$BASE/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" || true
TOKEN="$(json_get 'j.token || j.accessToken || j.jwt' <<<"$LOGIN_JSON")"
[[ -n "$TOKEN" ]] || fail "Login failed: token is empty. Response: $LOGIN_JSON"

# 3) Integration
log "Integration: slug + publicKey"
INTEGRATION_JSON="$(curl -sS "$BASE/projects/current/integration" -H "Authorization: Bearer $TOKEN")" || true
SLUG="$(json_get 'j.project?.slug || j.slug' <<<"$INTEGRATION_JSON")"
PUBLIC_KEY="$(json_get 'j.project?.publicKey || j.publicKey' <<<"$INTEGRATION_JSON")"
[[ -n "$SLUG" ]] || fail "Cannot read slug from /projects/current/integration. Response: $INTEGRATION_JSON"
[[ -n "$PUBLIC_KEY" ]] || fail "Cannot read publicKey from /projects/current/integration. Response: $INTEGRATION_JSON"
log "Project: slug=$SLUG publicKey=${PUBLIC_KEY:0:8}…"

# 4) Ensure allowlist origin
log "Allowlist: ensure origin '$ORIGIN'"
code="$(http_code -X POST "$BASE/projects/current/allowed-origins" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"origin\":\"$ORIGIN\"}")"

if [[ "$code" != "201" && "$code" != "409" ]]; then
  fail "Adding allowed origin failed (HTTP $code)"
fi

if [[ "$code" == "409" ]]; then
  log "Allowlist: origin already exists → OK"
else
  log "Allowlist: added → OK"
fi

# 5) Seed public forms
log "Seed: /public-forms/seed"
code="$(http_code -X POST "$BASE/public-forms/seed" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}')"
[[ "$code" == "200" || "$code" == "201" ]] || fail "Seed failed (HTTP $code)"

# 6) Public config: feedback
log "Public config: /public/forms/$SLUG/feedback/config"
code="$(http_code "$BASE/public/forms/$SLUG/feedback/config" \
  -H "X-Project-Key: $PUBLIC_KEY" \
  -H "Origin: $ORIGIN")"
[[ "$code" == "200" ]] || fail "Feedback config failed (HTTP $code). Check X-Project-Key + Origin allowlist."

# Optional: idempotency check (repeat same submit should NOT create duplicates)
if [[ "${SMOKE_TEST_IDEMPOTENCY:-0}" == "1" ]]; then
  REQ_ID="smoke-$(date +%s)-$$"
  log "Idempotency: POST /public/forms/$SLUG/feedback (X-Request-Id=$REQ_ID)"
  BODY='{"name":"Smoke Test","email":"smoke@example.com","message":"Smoke feedback","source":"smoke","clientRequestId":"'"$REQ_ID"'"}'

  code1="$(http_code -X POST "$BASE/public/forms/$SLUG/feedback"     -H "Content-Type: application/json"     -H "X-Project-Key: $PUBLIC_KEY"     -H "Origin: $ORIGIN"     -H "X-Request-Id: $REQ_ID"     -H "X-Smoke-Test: 1"     -d "$BODY")"
  [[ "$code1" == "201" || "$code1" == "200" ]] || fail "Idempotency submit (first) failed (HTTP $code1)"

  RESP2="$(curl -sS -X POST "$BASE/public/forms/$SLUG/feedback"     -H "Content-Type: application/json"     -H "X-Project-Key: $PUBLIC_KEY"     -H "Origin: $ORIGIN"     -H "X-Request-Id: $REQ_ID"     -H "X-Smoke-Test: 1"     -d "$BODY")" || true
  IDEMP="$(json_get 'j.idempotent' <<<"$RESP2")"
  [[ "$IDEMP" == "true" ]] || fail "Idempotency submit (second) did not return idempotent=true. Response: $RESP2"
  log "Idempotency: OK"
fi


# Optional: validation check (invalid payload should return 400)
if [[ "${SMOKE_TEST_VALIDATION:-0}" == "1" ]]; then
  log "Validation: POST /public/forms/$SLUG/feedback (expect 400)"
  RESP="$(curl -sS -X POST "$BASE/public/forms/$SLUG/feedback" \
    -H "Content-Type: application/json" \
    -H "X-Project-Key: $PUBLIC_KEY" \
    -H "Origin: $ORIGIN" \
    -H "X-Smoke-Test: 1" \
    -d "{}" -w "\n%{http_code}")" || true
  CODE="$(tail -n1 <<<"$RESP" | tr -d "\r")"
  BODY="$(sed '$d' <<<"$RESP")"
  [[ "$CODE" == "400" ]] || fail "Validation test failed: expected HTTP 400, got $CODE. Response: $BODY"
  ERR="$(json_get 'j.error' <<<"$BODY")"
  [[ "$ERR" == "Validation error" ]] || fail "Validation test failed: expected error=Validation error, got: $BODY"
  log "Validation: OK"
fi

# Optional: rate-limit check (burst submits should trigger 429 at default limits)
if [[ "${SMOKE_TEST_RATELIMIT:-0}" == "1" ]]; then
  log "RateLimit: burst POST /public/forms/$SLUG/feedback (expect at least one 429)"
  hit429=0
  for i in $(seq 1 12); do
    REQ_ID="smoke-rl-$(date +%s)-$$-$i"
    BODY='{"name":"Smoke RL","email":"smoke@example.com","message":"Smoke rate limit","source":"smoke","clientRequestId":"'"$REQ_ID"'"}'
    code="$(http_code -X POST "$BASE/public/forms/$SLUG/feedback" \
      -H "Content-Type: application/json" \
      -H "X-Project-Key: $PUBLIC_KEY" \
      -H "Origin: $ORIGIN" \
      -H "X-Request-Id: $REQ_ID" \
      -H "X-Smoke-Test: 1" \
      -d "$BODY")"
    if [[ "$code" == "429" ]]; then
      hit429=1
      break
    fi
  done
  [[ "$hit429" == "1" ]] || fail "RateLimit test did not observe HTTP 429. Either limiter is disabled or PUBLIC_SUBMIT_RL_MAX is too high."
  log "RateLimit: OK"
fi
log "Summary: base=$BASE slug=$SLUG formKey=feedback origin=$ORIGIN publicKey=${PUBLIC_KEY:0:8}…"
printf "✅ SMOKE OK\n"