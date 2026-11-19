#!/usr/bin/env bash
# Runs the migration + security tests against a throw-away local database.
# Needs a local Postgres; set PGHOST/PGPORT/PGUSER if not default.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=trackgimex_test
dropdb --if-exists "$DB" >/dev/null 2>&1 || true
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/mock_supabase.sql
for f in migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -q -t -v ON_ERROR_STOP=1 -d "$DB" -f tests/security_test.sql 2>&1 | sed -n "s/^.*NOTICE:  //p; /PASSED/p; /ERROR/p"
