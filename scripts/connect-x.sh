#!/bin/sh
set -eu

umask 077

dmbridge_bin=${DMBRIDGE_BIN:-dmbridge}
request_file=""
passcode_file=""

cleanup() {
  if [ -t 0 ]; then
    stty echo 2>/dev/null || true
  fi
  if [ -n "$request_file" ]; then
    rm -f "$request_file"
  fi
  if [ -n "$passcode_file" ]; then
    rm -f "$passcode_file"
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

printf 'X OAuth client ID: ' >&2
IFS= read -r client_id
if [ -z "$client_id" ]; then
  printf 'An X OAuth client ID is required.\n' >&2
  exit 2
fi

printf 'Client type [public]: ' >&2
IFS= read -r client_type
client_type=${client_type:-public}
case "$client_type" in
  public)
    client_secret_json=null
    ;;
  confidential)
    read_hidden 'X OAuth client secret: '
    if [ -z "$secret_value" ]; then
      printf 'A confidential X client requires a client secret.\n' >&2
      exit 2
    fi
    client_secret_json="\"$(json_escape "$secret_value")\""
    unset secret_value
    ;;
  *)
    printf 'Client type must be public or confidential.\n' >&2
    exit 2
    ;;
esac

printf 'Redirect URI [http://127.0.0.1/callback]: ' >&2
IFS= read -r redirect_uri
redirect_uri=${redirect_uri:-http://127.0.0.1/callback}

request_file=$(mktemp "${TMPDIR:-/tmp}/dmbridge-connect-x.XXXXXX")
printf '{"clientID":"%s","clientSecret":%s,"clientType":"%s","redirectURI":"%s"}\n' \
  "$(json_escape "$client_id")" \
  "$client_secret_json" \
  "$client_type" \
  "$(json_escape "$redirect_uri")" > "$request_file"
unset client_id client_secret_json

printf '\nStarting X OAuth…\n' >&2
run_dmbridge accounts add x \
  --account "$account" --request "$request_file" --pretty

printf '\nOpen the authorizationURL above and approve access.\n' >&2
printf 'Paste the complete callback URL: ' >&2
IFS= read -r callback_url
if [ -z "$callback_url" ]; then
  printf 'The callback URL is required to finish X OAuth.\n' >&2
  exit 2
fi

printf '{"callbackURL":"%s"}\n' "$(json_escape "$callback_url")" > "$request_file"
unset callback_url
run_dmbridge accounts add x \
  --account "$account" --request "$request_file" --pretty

read_hidden 'XChat passcode (leave blank to skip): '
if [ -n "$secret_value" ]; then
  passcode_file=$(mktemp "${TMPDIR:-/tmp}/dmbridge-x-passcode.XXXXXX")
  printf '%s' "$secret_value" > "$passcode_file"
  unset secret_value
  run_dmbridge accounts set-passcode x \
    --account "$account" --secret "$passcode_file" --pretty
else
  unset secret_value
fi

printf '\nConnected X account %s. Running a live read-only check…\n' "$account" >&2
run_dmbridge x doctor --account "$account" --live --pretty
