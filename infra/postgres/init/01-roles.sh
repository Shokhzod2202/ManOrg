#!/bin/sh
# Runs once, when the database volume is first created.
# Creates the API's runtime role. It is NOT the table owner and has no BYPASSRLS,
# so every query it makes is filtered by the row-level security policies.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="${MANORG_APP_PASSWORD:-manorg_app_dev}" <<'SQL'
SELECT format('CREATE ROLE manorg_app LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'manorg_app')
\gexec
GRANT CONNECT ON DATABASE manorg TO manorg_app;
GRANT USAGE ON SCHEMA public TO manorg_app;
SQL
