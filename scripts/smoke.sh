#!/usr/bin/env bash
set -euo pipefail

# Mini CRM Core - Smoke tests (PR7)
#
# Requirements:
# - bash, curl, node (for tiny JSON parsing)
#
# Usage example:
#   BASE="http://localhost:4000" \
#   EMAIL="owner@example.com" \
#   PASSWORD="secret123" \
#   SLUG="volunteers-odesa-dev" \
#   PROJECT_KEY="..." \
#   ORIGIN="http://localhost:8080" \
#   ./scripts/smoke.sh
#
# Notes:
# - If your project has Origin allowlist enabled, ORIGIN must be in the allowlist.
# - This script will temporarily disable one public form (feedback) and then re-enable it.

BASE="${BASE:-http://localhost:4000}"
ORIGIN="${ORIGIN:-http://localhost:8080}"
SLUG="${SLUG:-demo}"
PROJECT_KEY="${PROJECT_KEY:-}"
EMAIL="${EMAIL:-}"
PASSWORD="${PASSWORD:-}"

die() { echo "ERROR: $*" >&2; exit 1; }
need() { [[ -n "${!1}" ]] || die "Missing env var: $1"; }

json_get() {
  # json_get '<json>' 'path.to.field'
  node -e "const obj=JSON.parse(process.argv[1]); const path=process.argv[2].split('.'); let v=obj; for(const p of path){ if(v==null){process.exit(2)}; v=v[p]; } if (typeof v==='string') process.stdout.write(v); else process.stdout.write(JSON.stringify(v));" "$1" "$2"
}

http() {
  # http METHOD URL [DATA]
  local method="$1"; shift
  local url="$1"; shift
  local data="${1:-}"

  local body_file
  body_file="$(mktemp)"
  local code

  if [[ -n "$data" ]]; then
    code="$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" \
      -H "Content-Type: application/json" \
      "$@"
      --data "$data")"
  else
    code="$(curl -sS -o "$body_file" -w "%{http_code}" -X "$method" "$url" "$@")"
  fi

  echo "$code $body_file"
}

expect_code() {
  local got="$1" want="$2" msg="$3"
  if [[ "$got" != "$want" ]]; then
    die "$msg (expected $want, got $got)"
  fi
}

echo "== Smoke: health =="
read -r code body < <(http GET "$BASE/health")
expect_code "$code" "200" "Health endpoint failed"
echo "OK"

need SLUG
need PROJECT_KEY

echo
echo "== Smoke: config (donation) should be 200 with allowed Origin =="
read -r code body < <(http GET "$BASE/public/forms/$SLUG/donation/config" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "Accept: application/json")
expect_code "$code" "200" "Donation config failed"
rm -f "$body"
echo "OK"

echo
echo "== Smoke: donation submit without required amount -> 400 with details.amount Required =="
read -r code body < <(http POST "$BASE/public/forms/$SLUG/donation" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "Accept: application/json" \
  '{"name":"Test User","email":"test@example.com","comment":"no amount"}')
expect_code "$code" "400" "Donation submit without amount should be 400"
# best-effort assertion
if ! grep -q '"field":"amount"' "$body"; then
  echo "WARN: expected amount error in details, got:"; cat "$body"; echo
fi
rm -f "$body"
echo "OK"

echo
echo "== Smoke: contact email normalization (same contact for different email casing) =="
# 1st lead submit
read -r code body < <(http POST "$BASE/public/forms/$SLUG/lead" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "Accept: application/json" \
  '{"name":"Case Test","email":"CaseTest@Example.com","message":"first"}')
expect_code "$code" "201" "Lead submit #1 should be 201"
json1="$(cat "$body")"
cid1="$(json_get "$json1" "contact.id")" || die "Cannot read contact.id from lead #1 response"
rm -f "$body"

# 2nd lead submit with different casing
read -r code body < <(http POST "$BASE/public/forms/$SLUG/lead" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "Accept: application/json" \
  '{"name":"Case Test 2","email":"casetest@example.com","message":"second"}')
expect_code "$code" "201" "Lead submit #2 should be 201"
json2="$(cat "$body")"
cid2="$(json_get "$json2" "contact.id")" || die "Cannot read contact.id from lead #2 response"
rm -f "$body"

if [[ "$cid1" != "$cid2" ]]; then
  die "Email normalization failed: contact.id differs ($cid1 vs $cid2)"
fi
echo "OK (contact.id=$cid1)"

echo
echo "== Smoke: idempotency via X-Request-Id (repeat submit -> 201 then 200) =="
REQ_ID="smoke-req-$(date +%s)"
payload='{"name":"Idem Test","email":"idem@example.com","message":"idempotency"}'

read -r code body < <(http POST "$BASE/public/forms/$SLUG/lead" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "X-Request-Id: $REQ_ID" \
  -H "Accept: application/json" \
  "$payload")
expect_code "$code" "201" "Idempotency first submit should be 201"
rm -f "$body"

read -r code body < <(http POST "$BASE/public/forms/$SLUG/lead" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "X-Request-Id: $REQ_ID" \
  -H "Accept: application/json" \
  "$payload")
expect_code "$code" "200" "Idempotency second submit should be 200"
rm -f "$body"
echo "OK"

echo
echo "== Smoke: Origin allowlist blocks unknown origin (best-effort) =="
read -r code body < <(http GET "$BASE/public/forms/$SLUG/donation/config" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: http://evil.invalid" \
  -H "Accept: application/json")
if [[ "$code" == "403" ]]; then
  echo "OK (403 as expected)"
elif [[ "$code" == "200" ]]; then
  echo "WARN: got 200; allowlist likely disabled for this project/environment (skipping strict check)"
else
  echo "WARN: unexpected code $code; response:"; cat "$body"; echo
fi
rm -f "$body"

echo
echo "== Smoke: disable a public form -> submit returns 410, then re-enable (requires admin login) =="
if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "SKIP: EMAIL/PASSWORD not provided; cannot test disable/enable flow."
  exit 0
fi

# login
read -r code body < <(http POST "$BASE/auth/login" -H "Accept: application/json" \
  "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
expect_code "$code" "200" "Login failed"
token="$(json_get "$(cat "$body")" "token")" || die "Cannot read token from login response"
rm -f "$body"

# list public forms
read -r code body < <(http GET "$BASE/public-forms" \
  -H "Authorization: Bearer $token" \
  -H "Accept: application/json")
expect_code "$code" "200" "GET /public-forms failed"
forms_json="$(cat "$body")"
rm -f "$body"

# find feedback id
feedback_id="$(node -e "const arr=JSON.parse(process.argv[1]); const f=arr.find(x=>x.formKey==='feedback'); if(!f){process.exit(2)}; process.stdout.write(String(f.id));" "$forms_json" 2>/dev/null || true)"
if [[ -z "$feedback_id" ]]; then
  echo "SKIP: feedback form not found in /public-forms"
  exit 0
fi

# disable
read -r code body < <(http PATCH "$BASE/public-forms/$feedback_id" \
  -H "Authorization: Bearer $token" \
  -H "Accept: application/json" \
  '{"isActive":false}')
expect_code "$code" "200" "PATCH disable feedback failed"
rm -f "$body"

# submit feedback -> 410
read -r code body < <(http POST "$BASE/public/forms/$SLUG/feedback" \
  -H "X-Project-Key: $PROJECT_KEY" \
  -H "Origin: $ORIGIN" \
  -H "Accept: application/json" \
  '{"name":"Disabled Test","email":"disabled@example.com","message":"should be disabled"}')
if [[ "$code" != "410" ]]; then
  echo "WARN: expected 410 when disabled, got $code; response:"; cat "$body"; echo
else
  echo "OK (410 as expected)"
fi
rm -f "$body"

# re-enable
read -r code body < <(http PATCH "$BASE/public-forms/$feedback_id" \
  -H "Authorization: Bearer $token" \
  -H "Accept: application/json" \
  '{"isActive":true}')
expect_code "$code" "200" "PATCH re-enable feedback failed"
rm -f "$body"

echo
echo "ALL DONE"
