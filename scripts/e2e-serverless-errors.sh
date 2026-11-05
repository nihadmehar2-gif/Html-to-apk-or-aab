#!/bin/bash
# E2E: verify clean 503s (never 500s) under serverless-like conditions,
# and zero regression on a normal host with a real database.
set -u
cd /home/z/my-project
PORT=3111
BASE="http://127.0.0.1:$PORT"
SRV_LOG=/tmp/h2a-e2e-server.log

start_server() {  # $1 = extra env string
  env -u DATABASE_URL $1 PORT=$PORT HOSTNAME=127.0.0.1 node .next/standalone/server.js > "$SRV_LOG" 2>&1 &
  SRV_PID=$!
  for i in $(seq 1 40); do
    curl -s -o /dev/null "$BASE/" && return 0
    sleep 0.5
  done
  echo "SERVER FAILED TO START"; cat "$SRV_LOG"; exit 1
}
stop_server() { kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; }

pass=0; fail=0
check() { # desc expected actual
  if [ "$3" = "$2" ]; then echo "PASS: $1 (HTTP $3)"; pass=$((pass+1));
  else echo "FAIL: $1 — expected $2, got $3"; fail=$((fail+1)); fi
}

echo "=== Scenario A: Vercel-like (read-only storage, no DATABASE_URL) ==="
mkdir -p /tmp/h2a-ro && chmod 555 /tmp/h2a-ro
start_server "H2A_STORAGE_DIR=/tmp/h2a-ro"
A_REG=$(curl -s -o /tmp/a_reg.json -w "%{http_code}" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{"email":"t@a.test","password":"password123","name":"T"}')
check "register → 503 (was 500)" 503 "$A_REG"
echo "  body: $(head -c 160 /tmp/a_reg.json)"
A_ME=$(curl -s -o /tmp/a_me.json -w "%{http_code}" "$BASE/api/auth/me")
check "me → 200 (boot no longer 500s)" 200 "$A_ME"
A_IDX=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/")
check "landing → 200" 200 "$A_IDX"
stop_server

echo "=== Scenario B: writable storage but no DATABASE_URL ==="
mkdir -p /tmp/h2a-rw
start_server "H2A_STORAGE_DIR=/tmp/h2a-rw"
B_REG=$(curl -s -o /tmp/b_reg.json -w "%{http_code}" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d '{"email":"t@a.test","password":"password123","name":"T"}')
check "register → 503 DB_UNAVAILABLE" 503 "$B_REG"
echo "  body: $(head -c 160 /tmp/b_reg.json)"
B_ME=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/auth/me")
check "me → 200" 200 "$B_ME"
stop_server

echo "=== Scenario C: normal host (real SQLite, writable storage) ==="
cp db/custom.db /tmp/h2a-e2e.db
EMAIL="e2e-$(date +%s)@test.local"
start_server "DATABASE_URL=file:/tmp/h2a-e2e.db H2A_STORAGE_DIR=/tmp/h2a-rw"
C_REG=$(curl -s -c /tmp/c_cookies -o /tmp/c_reg.json -w "%{http_code}" -X POST "$BASE/api/auth/register" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\",\"name\":\"E2E\"}")
check "register → 200" 200 "$C_REG"
C_ME=$(curl -s -b /tmp/c_cookies -o /tmp/c_me.json -w "%{http_code}" "$BASE/api/auth/me")
check "me (with session cookie) → 200 + user" 200 "$C_ME"
grep -q "$EMAIL" /tmp/c_me.json && echo "PASS: session cookie resolves to user" && pass=$((pass+1)) || { echo "FAIL: me body: $(cat /tmp/c_me.json)"; fail=$((fail+1)); }
C_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}")
check "login → 200" 200 "$C_LOGIN"
stop_server

echo ""
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
