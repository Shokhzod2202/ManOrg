#!/bin/sh
# Creates the ManOrg roles and database. Safe to run more than once.
# Postgres runs docker-entrypoint-initdb.d only while the data directory is empty.
# A failed first start still leaves PG_VERSION, so later starts skip those scripts.
# This container applies the same script over TCP, including on that partial volume.
set -eu

cr=$(printf '\r')
strip() {
  sed "s/${cr}$//" "$1" > "$2"
}

strip /roles/01-roles.sh /tmp/01-roles.sh
strip /roles/check-passwords.sh /tmp/check-passwords.sh

i=0
until pg_isready -h db -p 5432 -U postgres -d postgres; do
  i=$((i + 1))
  if [ "$i" -gt 40 ]; then
    echo 'postgres did not accept connections' >&2
    exit 1
  fi
  sleep 2
done

sh /tmp/01-roles.sh
