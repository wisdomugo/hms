#!/usr/bin/env bash
#
# Milestone 05a — verify the Patient Registration data layer and API.
#
#   cd api/scripts
#   ./verify-05a.sh you@example.com 'your-password'
#
# RUN THIS IN GIT BASH, not cmd.exe or PowerShell. cmd.exe does not understand
# single-quoted JSON, and PowerShell aliases `curl` to Invoke-WebRequest, which
# takes different arguments entirely. Git Bash ships with Git for Windows and
# behaves like every example you will find online.
#
# It creates real rows in the hospital you point it at. Point it at a test
# hospital, never at one with real patients in it.

set -u

BASE="${BASE:-http://clinic.localhost:3000}"
EMAIL="${1:-}"
PASSWORD="${2:-}"
JAR="$(mktemp)"

PASS=0
FAIL=0

if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
  echo "usage: ./verify-05a.sh <email> <password>"
  echo "       BASE=http://other.localhost:3000 ./verify-05a.sh ..."
  exit 1
fi

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

# req METHOD PATH [JSON] -> sets STATUS and BODY
req() {
  local method="$1" path="$2" data="${3:-}" out
  if [ -n "$data" ]; then
    out=$(curl -s -w $'\n%{http_code}' -b "$JAR" -c "$JAR" -X "$method" \
      -H 'Content-Type: application/json' -d "$data" "$BASE$path")
  else
    out=$(curl -s -w $'\n%{http_code}' -b "$JAR" -c "$JAR" -X "$method" "$BASE$path")
  fi
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

# check N "description" EXPECTED_STATUS ["must contain"]
check() {
  local n="$1" desc="$2" want="$3" contains="${4:-}"
  local ok=1

  [ "$STATUS" = "$want" ] || ok=0
  if [ -n "$contains" ] && [ "$ok" = 1 ]; then
    case "$BODY" in *"$contains"*) ;; *) ok=0 ;; esac
  fi

  if [ "$ok" = 1 ]; then
    printf '  \033[32m✓\033[0m %-3s %s\n' "$n" "$desc"
    PASS=$((PASS + 1))
  else
    printf '  \033[31m✗\033[0m %-3s %s\n' "$n" "$desc"
    printf '        expected %s%s, got %s\n' "$want" \
      "${contains:+ containing \"$contains\"}" "$STATUS"
    printf '        %s\n' "$(echo "$BODY" | cut -c1-200)"
    FAIL=$((FAIL + 1))
  fi
}

jget()  { echo "$BODY" | grep -o "\"$1\":[0-9]*"      | head -1 | cut -d: -f2; }
jstr()  { echo "$BODY" | grep -o "\"$1\":\"[^\"]*\""  | head -1 | cut -d'"' -f4; }

echo
echo "Milestone 05a — Patient Registration API"
echo "  $BASE"
echo

# ---------------------------------------------------------------------------
req POST /api/auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
if [ "$STATUS" != "200" ]; then
  echo "  Could not sign in ($STATUS). Everything else needs a session."
  echo "  $BODY"
  exit 1
fi
echo "  signed in as $EMAIL"
echo

# --- the no-mandatory-fields rule ------------------------------------------
echo "  The rule: nothing is compulsory"

req POST /api/patients '{"patient":{"surname":"Okafor"}}'
check 1 "a surname alone is a valid registration" 201 '"mrn"'
P1=$(jget id); MRN1=$(jstr mrn)

req POST /api/patients '{"patient":{}}'
check 2 "an entirely empty registration is valid" 201 '"mrn"'
P2=$(jget id)

req POST /api/patients '{"patient":{"surname":"Balogun"}}'
check 3 "a third registration succeeds" 201 '"mrn"'
MRN3=$(jstr mrn)
printf '        numbers issued: %s then %s\n' "$MRN1" "$MRN3"

# --- format is still enforced ----------------------------------------------
echo
echo "  Format is still checked when a value is present"

req POST /api/patients '{"patient":{"surname":"Test","dateOfBirth":"2099-01-01"}}'
check 4 "a future date of birth is refused" 400 'future'

req POST /api/patients '{"patient":{"surname":"Test","sex":"banana"}}'
check 5 "an unknown sex is refused, listing the allowed values" 400 'female'

req POST /api/patients '{"patient":{"surname":"Test","email":"not-an-email"}}'
check 6 "a malformed email is refused" 400 'email'

req POST /api/patients '{"patient":{"surname":"Test","firstname":"typo"}}'
check 7 "an unrecognised field is NAMED, not silently dropped" 400 'firstname'

# --- duplicates advise, never block ----------------------------------------
echo
echo "  Duplicate detection advises; it never blocks"

req POST /api/patients/check-duplicates '{"surname":"Okafor"}'
check 8 "the earlier Okafor is offered as a candidate" 200 '"advisory":true'

req POST /api/patients "{\"patient\":{\"surname\":\"Okafor\"},\"acknowledgedDuplicates\":[$P1]}"
check 9 "registering the duplicate anyway is allowed" 201 '"mrn"'
DUP=$(jget id)

# --- the emergency path ----------------------------------------------------
echo
echo "  The red button"

req POST /api/patients/emergency '{"sex":"female","estimatedAge":30}'
check 10 "sex and an estimated age are enough" 201 'TEMP-'
EMERG=$(jget id); TEMP=$(jstr mrn)

req POST "/api/patients/$EMERG/reconcile" '{"surname":"Adeyemi","firstName":"Ngozi"}'
check 11 "reconciling issues a real MRN" 200 '"previousMrn"'

req GET "/api/patients/$EMERG"
check 12 "the temporary number survives as an identifier" 200 "$TEMP"

# --- the worklist ----------------------------------------------------------
echo
echo "  Incomplete is the normal state, so it gets a worklist"

req GET /api/worklists/incomplete
check 13 "sparse records are listed with completeness scores" 200 '"completeness"'

# --- the whitelist ---------------------------------------------------------
echo
echo "  What cannot be changed"

req PATCH "/api/patients/$P1" '{"mrn":"MINE/2026/00001-0"}'
check 14 "mrn is refused by name, not swallowed" 400 'mrn'

req PATCH "/api/patients/$P1" '{"phone":"08031234567"}'
check 15 "an editable field updates normally" 200 '"phone"'

# --- merge -----------------------------------------------------------------
echo
echo "  Duplicates are merged, never deleted"

req POST "/api/patients/$P1/merge" "{\"mergedId\":$DUP,\"reason\":\"Same person, registered twice\"}"
check 16 "the merge succeeds" 200 '"mergedMrn"'
LOST=$(jstr mergedMrn)

req GET "/api/patients?q=$LOST"
check 17 "the losing number still finds the surviving record" 200 "$MRN1"

req PATCH "/api/patients/$DUP" '{"phone":"08030000000"}'
check 18 "the merged-away record refuses edits" 409 'merged'

# --- confidentiality -------------------------------------------------------
echo
echo "  The audit log"

req GET '/api/audit?take=100'
check 19 "events are being recorded" 200 'patient.registered'
check 20 "the view event exists — the one most systems omit" 200 'patient.viewed'

if echo "$BODY" | grep -qiE 'Okafor|Balogun|Adeyemi|Ngozi'; then
  printf '  \033[31m✗\033[0m %-3s %s\n' 21 "NO PATIENT NAME APPEARS IN THE LOG"
  echo "        A patient name was found in an audit row. That is the one rule"
  echo "        this log has. Check what meta the routes are passing."
  FAIL=$((FAIL + 1))
else
  printf '  \033[32m✓\033[0m %-3s %s\n' 21 "no patient name appears anywhere in the log"
  PASS=$((PASS + 1))
fi

# ---------------------------------------------------------------------------
rm -f "$JAR"

echo
echo "  ────────────────────────────────"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
echo
[ "$FAIL" = 0 ] || exit 1
