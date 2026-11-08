#!/bin/sh
# Creates the app's two roles and its database. Runs once when the Docker volume is first created
# (docker-entrypoint-initdb.d), and from CI against a service container. Safe to run again.
#
#   manorg_owner  owns the tables; runs migrations and the seed. Not a superuser, so FORCE ROW
#                 LEVEL SECURITY applies to it too. CREATEDB lets Prisma make its shadow database
#                 and the tests make manorg_test.
#   manorg_app    the API's runtime role: no ownership, no BYPASSRLS, so RLS filters every query.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
# Production compose sets MANORG_REQUIRE_STRONG_PASSWORDS=1. Development keeps the defaults below.
sh "$SCRIPT_DIR/check-passwords.sh"

: "${POSTGRES_USER:=postgres}"
: "${MANORG_OWNER_PASSWORD:=manorg_owner_dev}"
: "${MANORG_APP_PASSWORD:=manorg_app_dev}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$MANORG_OWNER_PASSWORD" -v app_password="$MANORG_APP_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE manorg_owner LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS CREATEDB', :'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_owner')
\gexec
SELECT format('CREATE ROLE manorg_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app')
\gexec
SELECT 'CREATE DATABASE manorg OWNER manorg_owner'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'manorg')
\gexec
SQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname manorg <<'SQL'
GRANT CONNECT ON DATABASE manorg TO manorg_app;
GRANT USAGE ON SCHEMA public TO manorg_app;
SQL
