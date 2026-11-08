#!/bin/sh
# Exits 1 when production asked for strong passwords and a value is missing,
# short, or one of the development defaults. Does nothing in development.
set -eu

if [ "${MANORG_REQUIRE_STRONG_PASSWORDS:-}" != "1" ]; then
  exit 0
fi

fail() {
  echo "$1" >&2
  exit 1
}

check() {
  name="$1"
  value="$2"
  if [ -z "$value" ]; then
    fail "$name is required"
  fi
  if [ "${#value}" -lt 24 ]; then
    fail "$name must be at least 24 characters"
  fi
  case "$value" in
    *manorg_owner_dev* | *manorg_app_dev* | *postgres_dev*)
      fail "$name uses a development default"
      ;;
  esac
}

check POSTGRES_PASSWORD "${POSTGRES_PASSWORD:-}"
check MANORG_OWNER_PASSWORD "${MANORG_OWNER_PASSWORD:-}"
check MANORG_APP_PASSWORD "${MANORG_APP_PASSWORD:-}"
