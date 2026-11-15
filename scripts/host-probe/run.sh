#!/usr/bin/env bash
# Throwaway Strato host probe for slice 1/1 (#2).
#
# Uploads scripts/host-probe/probe.php into a random folder under the web root over OpenSSH
# sftp (password via SSHPASS, pinned or freshly scanned host key), reads it over HTTPS, tests
# rename-overwrite and an .htaccess rewrite, then removes every file it created.
#
# Inputs (environment): SITE_URL, REMOTE_ROOT, DOCROOT, DEPLOY_HOST, DEPLOY_PORT,
# DEPLOY_KNOWN_HOSTS (optional), SFTP_USER, SSHPASS, DB_HOST, DB_PORT (optional), DB_NAME,
# DB_USER, DB_PASSWORD.
# Secrets never reach argv or output: sftp reads them from 0600 files and the environment.
# Output: findings as Markdown on stdout and in $GITHUB_STEP_SUMMARY when set.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

: "${SITE_URL:?}" "${DEPLOY_HOST:?}" "${SFTP_USER:?}" "${SSHPASS:?}"
: "${DB_HOST:?}" "${DB_NAME:?}" "${DB_USER:?}" "${DB_PASSWORD:?}"
remote_root=${REMOTE_ROOT:-/}
docroot=${DOCROOT:-}
docroot=${docroot#/}
docroot=${docroot%/}
port=${DEPLOY_PORT:-22}
site=${SITE_URL%/}
case $site in http://*|https://*) ;; *) site="https://$site" ;; esac
site_host=${site#https://}
site_host=${site_host#http://}
site_host=${site_host%%/*}

rand=$(openssl rand -hex 8)
token=$(openssl rand -hex 24)
root=${remote_root%/}

out() { printf '%s\n' "$*"; if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$*" >>"$GITHUB_STEP_SUMMARY"; fi; }

# --- files -----------------------------------------------------------------------------------
printf 'A' >"$work/a.txt"
printf 'B' >"$work/b.txt"
( umask 077; TOKEN=$token jq -n '{token: env.TOKEN, db: {host: env.DB_HOST, port: (env.DB_PORT // ""), name: env.DB_NAME, user: env.DB_USER, pass: env.DB_PASSWORD}}' >"$work/config.json" )

# --- ssh session -----------------------------------------------------------------------------
known="$work/known_hosts"
if [ -n "${DEPLOY_KNOWN_HOSTS:-}" ]; then
  printf '%s\n' "$DEPLOY_KNOWN_HOSTS" >"$known"
  host_key_source="pinned (PROD_DEPLOY_KNOWN_HOSTS)"
else
  ssh-keyscan -p "$port" -T 15 "$DEPLOY_HOST" 2>/dev/null >"$known"
  host_key_source="scanned once from the runner (trust on first use)"
fi
chmod 600 "$known"
fingerprints=$(ssh-keygen -lf "$known" | awk '{print $4 " " $2}' | sort -u | paste -sd ';' -)

( umask 077; cat >"$work/ssh_config" <<EOF
Host target
  HostName $DEPLOY_HOST
  Port $port
  User $SFTP_USER
  StrictHostKeyChecking yes
  UserKnownHostsFile $known
  GlobalKnownHostsFile /dev/null
  ConnectTimeout 30
  PasswordAuthentication yes
  PubkeyAuthentication no
  PreferredAuthentications password
  LogLevel ERROR
EOF
)

sftp_batch() { # $1 = batch file; returns sftp's exit code, stderr suppressed (may name the user)
  sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$1" target >/dev/null 2>"$work/sftp.err"
}

cleanup() { sftp_batch "$work/cleanup" && cleaned=yes || cleaned=no; }
cleaned=no

out "## Strato host probe"
out ""
out "- Site: \`$site\`"
out "- Host key: $host_key_source; fingerprints: \`$fingerprints\`"

# --- find the served folder when DOCROOT is not configured -------------------------------------
if [ -z "$docroot" ] && [ -z "${DOCROOT_SET:-}" ]; then
  printf 'ls -l %s\n' "${root:-/}" >"$work/lsroot"
  sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$work/lsroot" target 2>/dev/null \
    | awk '$1 ~ /^d/ {print $NF}' | grep -vE '^\.{1,2}$' | grep -vE '[[:space:]]' >"$work/dirs" || true
  candidates=("") ; while IFS= read -r d; do candidates+=("$d"); done <"$work/dirs"
  : >"$work/markers"; : >"$work/unmark"
  for i in "${!candidates[@]}"; do
    printf '%s' "$i" >"$work/marker-$i.txt"
    target_dir="$root${candidates[$i]:+/${candidates[$i]}}"
    printf -- '-put %s %s/probe-%s.txt\n' "$work/marker-$i.txt" "$target_dir" "$rand" >>"$work/markers"
    printf -- '-rm %s/probe-%s.txt\n' "$target_dir" "$rand" >>"$work/unmark"
  done
  sftp_batch "$work/markers" || true
  hit=$(curl -fsSk --max-time 20 "$site/probe-$rand.txt" || true)
  sftp_batch "$work/unmark" || true
  if [[ "$hit" =~ ^[0-9]+$ ]] && [ "$hit" -lt "${#candidates[@]}" ]; then
    docroot=${candidates[$hit]}
    out "- Served folder (found by marker): \`${docroot:-SFTP root}\` (checked the SFTP root and ${#candidates[@]} - 1 top-level folders)"
  else
    out "- Served folder: **not found** — no marker in the SFTP root or its top-level folders was served at \`$site\`"
    exit 1
  fi
fi

if [ -n "$docroot" ]; then
  probe_dir="$root/$docroot/probe-$rand"
  config_remote="$root/probe-$rand.json"
  depth=$(( $(tr -cd '/' <<<"$docroot" | wc -c) + 2 ))
  config_relative=$(printf '../%.0s' $(seq 1 "$depth"))"probe-$rand.json"
  config_note="above the web root"
else
  probe_dir="$root/probe-$rand"
  config_remote="$probe_dir/config.json"
  config_relative="config.json"
  config_note="inside the probe folder behind a deny rule (the web root is the SFTP root, so nothing above it is reachable)"
fi
sed "s#__CONFIG_RELATIVE__#$config_relative#" "$here/probe.php" >"$work/index.php"
printf 'RewriteEngine On\nRewriteCond %%{REQUEST_FILENAME} !-f\nRewriteRule ^api/(.*)$ index.php?route=$1 [QSA,L]\n<Files "config.json">\n  Require all denied\n</Files>\n' >"$work/htaccess"
out "- Probe config placed $config_note"

cat >"$work/upload" <<EOF
mkdir $probe_dir
put $work/index.php $probe_dir/index.php
put $work/htaccess $probe_dir/.htaccess
put $work/a.txt $probe_dir/rename-a.txt
put $work/b.txt $probe_dir/rename-b.txt
put $work/config.json $config_remote
EOF
cat >"$work/rename" <<EOF
rename $probe_dir/rename-b.txt $probe_dir/rename-a.txt
EOF
cat >"$work/cleanup" <<EOF
-rm $probe_dir/rename-a.txt
-rm $probe_dir/rename-b.txt
-rm $probe_dir/.htaccess
-rm $probe_dir/index.php
-rm $config_remote
-rmdir $probe_dir
EOF

if sftp_batch "$work/upload"; then upload=yes; else upload=no; fi
out "- SFTP login and upload into the web root and above it: **$upload**"
if [ "$upload" = no ]; then
  out "- SFTP error class: \`$(grep -oE 'Permission denied|No such file|Connection (refused|timed out|closed)|Host key verification failed|Couldn.t [a-z ]+' "$work/sftp.err" | head -1 || true)\`"
  cleanup; out "- Cleanup: **$cleaned**"; exit 1
fi

if sftp_batch "$work/rename"; then rename=yes; else rename=no; fi
served=$(curl -fsSk --max-time 20 "$site/probe-$rand/rename-a.txt" || true)
out "- OpenSSH \`sftp\` rename onto an existing file: **$rename**; file served afterwards: \`${served:-none}\` (expected \`B\`)"

https_status=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$site/" || true)
http_status=$(curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}' --max-time 20 "http://$site_host/" || true)
cert=$(echo | openssl s_client -connect "$site_host:443" -servername "$site_host" 2>/dev/null | openssl x509 -noout -issuer -enddate -ext subjectAltName 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g' || true)
verify=$(curl -s -o /dev/null -w '%{ssl_verify_result}' --max-time 20 "$site/" || echo "failed")
out "- HTTPS: status \`$https_status\` on \`/\`, certificate verification result \`$verify\` (0 = valid)"
out "- Certificate: \`${cert:-not readable}\`"
out "- Plain HTTP on \`/\`: \`$http_status\`"

probe_json=$(curl -fsSk --max-time 30 "$site/probe-$rand/index.php?t=$token" || echo '{"error":"probe not reachable"}')
rewrite_json=$(curl -fsSk --max-time 30 "$site/probe-$rand/api/hello?t=$token" || echo '{"error":"rewrite not reachable"}')
rewrite_route=$(jq -r '.server.route // "none"' <<<"$rewrite_json" 2>/dev/null || echo none)
denied=$(curl -sk -o /dev/null -w '%{http_code}' --max-time 20 "$site/probe-$rand/config.json" || true)
[ -n "$docroot" ] || out "- Config file inside the web root answers HTTP \`$denied\` (expected 403)"
out "- \`.htaccess\` front-controller rewrite reaches PHP: **$([ "$rewrite_route" = hello ] && echo yes || echo no)** (route seen: \`$rewrite_route\`)"
out ""
out "### PHP and database (probe response)"
out ""
out '```json'
out "$probe_json"
out '```'

cleanup
out ""
out "- Cleanup of all probe files: **$cleaned**"
printf 'ls -1 %s\n' "${root}${docroot:+/$docroot}" >"$work/list"
entries=$(sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$work/list" target 2>/dev/null | grep -v '^sftp>' | grep -c . || true)
out "- Visible entries left in the web root after cleanup: \`$entries\`"
