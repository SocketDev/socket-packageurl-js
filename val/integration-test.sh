#!/usr/bin/env bash
# Live integration tests for the Socket walkthrough comment val.
# Runs against a deployed Val Town URL. Does NOT require Deno or Node.
#
# Usage:
#   VAL_URL=https://jdalton-socket-walkthroughs.web.val.run ./integration-test.sh
#
# What it covers that unit tests cannot:
#   - CORS preflight (OPTIONS) actually emits ACAO for allowed origins
#   - Disallowed origins are denied
#   - JWT round-trips over HTTPS
#   - SQLite persistence
#   - Email sending (manual step — check inbox)
#
# Run after `pnpm walkthrough deploy-val` + secret config. Expected env
# vars:
#   VAL_URL                  URL of deployed val
#   TEST_EMAIL               a @socket.dev address you control
#   TEST_ORIGIN_ALLOWED      default: https://socketdev.github.io
#   TEST_ORIGIN_DENIED       default: https://evil.example.com

set -eu

VAL_URL=${VAL_URL:?set VAL_URL}
TEST_EMAIL=${TEST_EMAIL:?set TEST_EMAIL}
ALLOWED=${TEST_ORIGIN_ALLOWED:-https://socketdev.github.io}
DENIED=${TEST_ORIGIN_DENIED:-https://evil.example.com}

pass() { printf '\033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo "→ /health"
code=$(curl -sS -o /tmp/val-health.json -w '%{http_code}' "$VAL_URL/health")
[ "$code" = "200" ] && pass "health returns 200" || fail "health: $code"
grep -q '"ok":true' /tmp/val-health.json || fail "health body missing ok:true"

echo "→ CORS preflight (allowed origin)"
acao=$(curl -sS -i -X OPTIONS \
  -H "Origin: $ALLOWED" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  "$VAL_URL/auth/request" \
  | awk '/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:/ {print $2}' \
  | tr -d '\r')
[ "$acao" = "$ALLOWED" ] && pass "ACAO echoes allowed origin" || fail "ACAO: '$acao'"

echo "→ CORS preflight (denied origin)"
acao_denied=$(curl -sS -i -X OPTIONS \
  -H "Origin: $DENIED" \
  -H "Access-Control-Request-Method: POST" \
  "$VAL_URL/auth/request" \
  | awk '/^[Aa]ccess-[Cc]ontrol-[Aa]llow-[Oo]rigin:/ {print $2}' \
  | tr -d '\r')
[ -z "$acao_denied" ] && pass "denied origin has no ACAO" || fail "denied: '$acao_denied'"

echo "→ Security headers"
headers=$(curl -sS -i "$VAL_URL/health")
echo "$headers" | grep -qi 'x-content-type-options: nosniff' && pass "nosniff" || fail "missing nosniff"
echo "$headers" | grep -qi 'referrer-policy:' && pass "referrer-policy" || fail "missing referrer-policy"
echo "$headers" | grep -qi 'x-frame-options: DENY' && pass "x-frame-options" || fail "missing x-frame-options"

echo "→ Request-ID echoed"
reqid=$(curl -sS -i "$VAL_URL/health" | awk '/^[Xx]-[Rr]equest-[Ii]d:/ {print $2}' | tr -d '\r')
[ -n "$reqid" ] && pass "x-request-id: $reqid" || fail "missing x-request-id"

echo "→ Auth: wrong domain returns 200 (enumeration-safe)"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com"}' \
  "$VAL_URL/auth/request")
[ "$code" = "200" ] && pass "wrong domain returns 200" || fail "wrong domain: $code"

echo "→ Auth: malformed JSON"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d 'not-json' \
  "$VAL_URL/auth/request")
[ "$code" = "200" ] && pass "malformed JSON returns 200 uniformly" || fail "malformed: $code"

echo "→ Auth: oversized body"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  --data-binary "$(printf '{"email":"%0.s' $(seq 1 500))$(printf 'a%0.s' $(seq 1 10000))"}" \
  "$VAL_URL/auth/request")
[ "$code" = "200" ] && pass "oversized body handled (uniform 200)" || echo "  oversized: $code (may be 413/200)"

echo "→ Auth: real request (sends email to $TEST_EMAIL)"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\"}" \
  "$VAL_URL/auth/request"

echo
echo '→ Check inbox for sign-in code, then paste to finish (or Ctrl-C):'
read -rp "code: " CODE

echo "→ Auth: verify bad code"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"code\":\"000000\"}" \
  "$VAL_URL/auth/verify")
[ "$code" = "401" ] && pass "bad code returns 401" || fail "bad code: $code"

echo "→ Auth: verify good code"
JWT=$(curl -sS \
  -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"$TEST_EMAIL\",\"code\":\"$CODE\"}" \
  "$VAL_URL/auth/verify" \
  | grep -o '"token":"[^"]*"' | sed 's/.*:"\([^"]*\)"/\1/')
[ -n "$JWT" ] && pass "got JWT" || fail "no JWT"

echo "→ Auth: check"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $JWT" \
  "$VAL_URL/auth/check")
[ "$code" = "200" ] && pass "auth check" || fail "auth check: $code"

echo "→ Comments: list (empty OK)"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $JWT" \
  "$VAL_URL/test-slug/api/comments?part=1")
[ "$code" = "200" ] && pass "list comments" || fail "list: $code"

echo "→ Comments: invalid slug"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $JWT" \
  "$VAL_URL/INVALID_SLUG/api/comments?part=1")
[ "$code" = "400" ] && pass "invalid slug rejected" || fail "invalid slug: $code"

echo "→ Comments: create"
CREATE=$(curl -sS \
  -X POST -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
  -d '{"part":1,"file":"src/a.ts","lineFrom":10,"body":"integration test"}' \
  "$VAL_URL/test-slug/api/comments")
CID=$(echo "$CREATE" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"\([^"]*\)"/\1/')
[ -n "$CID" ] && pass "created comment $CID" || fail "no comment id"

echo "→ Comments: delete"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X DELETE -H "Authorization: Bearer $JWT" \
  "$VAL_URL/test-slug/api/comments/$CID")
[ "$code" = "200" ] && pass "delete own comment" || fail "delete: $code"

echo "→ Logout revokes JWT"
code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -X POST -H "Authorization: Bearer $JWT" \
  "$VAL_URL/auth/logout")
[ "$code" = "200" ] && pass "logout" || fail "logout: $code"

code=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer $JWT" \
  "$VAL_URL/auth/check")
[ "$code" = "401" ] && pass "revoked JWT returns 401" || fail "revoked: $code"

echo
echo '✓ all integration tests passed'
