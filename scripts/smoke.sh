#!/usr/bin/env bash
set -euo pipefail

# mini-crm-core — one-command public integration smoke test
#
# What it checks:
# 1) GET  /health → 200
# 2) POST /auth/login → JWT
# 3) GET  /projects/current/integration → slug + publicKey
# 4) POST /projects/current/allowed-origins (201 or 409 is OK)
# 5) POST /public-forms/seed
# 6) GET  /public/forms/:slug/feedback/config with X-Project-Key + Origin
# Optional (SMOKE_INVITES=1):
# 7) POST /invites → token
# 8) POST /invites/accept-public → JWT
# 9) GET  /cases (admin) → 200
#
# Requirements: bash, curl, node

BASE="${BASE:-http://localhost:4000}"
EMAIL="${EMAIL:-owner@example.com}"
PASSWORD="${PASSWORD:-${PASS:-secret123}}"
ORIGIN_DEFAULT="https://test.local"
ORIGIN="${ORIGIN:-$ORIGIN_DEFAULT}"

log()  { printf "[smoke] %s\n" "$*"; }
fail() { printf "❌ SMOKE FAIL: %s\n" "$*" >&2; exit 1; }

json_get() {
  local expr="$1"
  node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s||'{}');const v=(function(){return (${expr});})(); if(v===undefined||v===null){process.exit(0)}; if(typeof v==='object') console.log(JSON.stringify(v)); else console.log(String(v));}catch(e){process.exit(0)}})" 2>/dev/null || true
}

http_code() {
  # usage: http_code <curl args...>
  curl -sS -o /dev/null -w "%{http_code}" "$@"
}

# 1) Health
log "Health: $BASE/health"
code="$(http_code "$BASE/health")"
[[ "$code" == "200" ]] || fail "Health check failed (HTTP $code). Is server running (npm run dev)?"

# 2) Login
log "Login: $EMAIL"
LOGIN_JSON="$(curl -sS -X POST "$BASE/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")" || true

TOKEN="$(json_get "j.token || j.accessToken || j.jwt" <<<"$LOGIN_JSON")"
[[ -n "${TOKEN:-}" ]] || fail "Login failed: token is empty. Response: $LOGIN_JSON"

# 3) Integration
log "Integration: slug + publicKey"
INTEGRATION_JSON="$(curl -sS "$BASE/projects/current/integration" -H "Authorization: Bearer $TOKEN")" || true
SLUG="$(json_get "j.project?.slug || j.slug" <<<"$INTEGRATION_JSON")"
PUBLIC_KEY="$(json_get "j.project?.publicKey || j.publicKey" <<<"$INTEGRATION_JSON")"
[[ -n "${SLUG:-}" ]] || fail "Cannot read slug from /projects/current/integration. Response: $INTEGRATION_JSON"
[[ -n "${PUBLIC_KEY:-}" ]] || fail "Cannot read publicKey from /projects/current/integration. Response: $INTEGRATION_JSON"
log "Project: slug=$SLUG publicKey=${PUBLIC_KEY:0:8}…"

# 4) Ensure allowlist origin
log "Allowlist: ensure origin '$ORIGIN'"
code="$(http_code -X POST "$BASE/projects/current/allowed-origins"   -H "Authorization: Bearer $TOKEN"   -H "Content-Type: application/json"   -d "{\"origin\":\"$ORIGIN\"}")"

if [[ "$code" != "201" && "$code" != "409" ]]; then
  fail "Allowlist add failed (expected 201/409, got HTTP $code)"
fi

# 5) Seed public forms (idempotent)
log "Seed: /public-forms/seed"
code="$(http_code -X POST "$BASE/public-forms/seed" -H "Authorization: Bearer $TOKEN")"
if [[ "$code" != "200" && "$code" != "201" && "$code" != "204" ]]; then
  fail "Seed failed (HTTP $code)"
fi

# 6) Public config
log "Public config: /public/forms/$SLUG/feedback/config"
CONFIG_JSON="$(curl -sS "$BASE/public/forms/$SLUG/feedback/config"   -H "X-Project-Key: $PUBLIC_KEY"   -H "Origin: $ORIGIN")" || true

FORM_KEY="$(json_get "j.form?.key || j.key || j.formKey" <<<"$CONFIG_JSON")"
[[ -n "${FORM_KEY:-}" ]] || fail "Public config failed: cannot read form key. Response: $CONFIG_JSON"

# Optional: invite-link chain (create invite → accept-public → access /cases)
if [[ "${SMOKE_INVITES:-0}" == "1" ]]; then
  log "Invites: create invite + accept-public + /cases access"

  INVITE_JSON="$(curl -sS -X POST "$BASE/invites"     -H "Authorization: Bearer $TOKEN"     -H "Content-Type: application/json"     -d "{\"role\":\"admin\",\"ttlHours\":168}")" || true

  INVITE_TOKEN="$(json_get "j.token || j.invite?.token || j.data?.token" <<<"$INVITE_JSON")"
  [[ -n "${INVITE_TOKEN:-}" ]] || fail "Invite create failed: token is empty. Response: $INVITE_JSON"

  INVITE_EMAIL="smoke+invite-$(date +%s)-$$@example.com"
  INVITE_PASSWORD="secret123"

  ACCEPT_JSON="$(curl -sS -X POST "$BASE/invites/accept-public" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$INVITE_TOKEN\",\"email\":\"$INVITE_EMAIL\",\"password\":\"$INVITE_PASSWORD\"}")" || true

  ADMIN_TOKEN="$(json_get "j.token || j.accessToken || j.jwt" <<<"$ACCEPT_JSON")"
  [[ -n "${ADMIN_TOKEN:-}" ]] || fail "Invite accept-public failed: token is empty. Response: $ACCEPT_JSON"

  code="$(http_code "$BASE/cases?status=all" -H "Authorization: Bearer $ADMIN_TOKEN")"
  [[ "$code" == "200" ]] || fail "Admin /cases failed (HTTP $code)"
  log "Invites: OK (email=$INVITE_EMAIL)"
fi

log "Summary: base=$BASE slug=$SLUG formKey=feedback origin=$ORIGIN publicKey=${PUBLIC_KEY:0:8}…"
printf "✅ SMOKE OK\n"
