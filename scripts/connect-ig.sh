#!/bin/sh
set -eu

umask 077

dmbridge_bin=${DMBRIDGE_BIN:-dmbridge}
request_file=""

cleanup() {
  if [ -t 0 ]; then
    stty echo 2>/dev/null || true
  fi
  if [ -n "$request_file" ]; then
    rm -f "$request_file"
  fi
}

trap cleanup 0
trap 'exit 130' 1 2 15

if ! command -v "$dmbridge_bin" >/dev/null 2>&1; then
  printf 'dmbridge was not found. Install it or set DMBRIDGE_BIN.\n' >&2
  exit 127
fi

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

read_hidden() {
  printf '%s' "$1" >&2
  if [ -t 0 ]; then
    stty -echo
  fi
  if ! IFS= read -r secret_value; then
    return 1
  fi
  if [ -t 0 ]; then
    stty echo
    printf '\n' >&2
  fi
}

run_dmbridge() {
  if [ -n "$dmbridge_home" ]; then
    "$dmbridge_bin" "$@" --home "$dmbridge_home"
  else
    "$dmbridge_bin" "$@"
  fi
}

printf 'Account name [personal]: ' >&2
IFS= read -r account
account=${account:-personal}

printf 'dmbridge home [default]: ' >&2
IFS= read -r dmbridge_home

read_hidden 'Instagram access token: '
if [ -z "$secret_value" ]; then
  printf 'An Instagram access token is required.\n' >&2
  exit 2
fi

request_file=$(mktemp "${TMPDIR:-/tmp}/dmbridge-connect-ig.XXXXXX")
access_token=$(json_escape "$secret_value")
unset secret_value
printf '{"accessToken":"%s"}\n' "$access_token" > "$request_file"
unset access_token

run_dmbridge accounts add instagram \
  --account "$account" --request "$request_file" --pretty

printf '\nConnected Instagram account %s. Running a live read-only check…\n' "$account" >&2
run_dmbridge instagram doctor --account "$account" --live --pretty
