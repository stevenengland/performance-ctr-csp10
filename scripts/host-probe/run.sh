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
if command -v dig >/dev/null; then
  for resolver in 1.1.1.1 8.8.8.8; do
    out "- DNS via $resolver: NS \`$(dig +short NS "$site_host" @"$resolver" | sort | paste -sd ' ' -)\`, A \`$(dig +short A "$site_host" @"$resolver" | paste -sd ' ' -)\`, AAAA \`$(dig +short AAAA "$site_host" @"$resolver" | paste -sd ' ' -)\`"
  done
  tld=${site_host##*.}
  out "- Delegation at the .$tld registry: \`$(dig +norec +noall +authority NS "$site_host" @"$(dig +short NS "$tld." | head -1)" | awk '{print $5}' | sort | paste -sd ' ' -)\`"
fi
out "- Host key: $host_key_source; fingerprints: \`$fingerprints\`"
if [ -z "${DEPLOY_KNOWN_HOSTS:-}" ]; then
  # Public host keys, safe to show: the lines to store as the SFTP_KNOWN_HOSTS variable
  # after comparing the fingerprints above with the ones recorded on issue #2.
  out "- Lines for the \`SFTP_KNOWN_HOSTS\` variable (public keys):"
  out '```'
  out "$(grep -v '^#' "$known" | sort)"
  out '```'
fi

# --- find the served folder when DOCROOT is not configured -------------------------------------
if [ -z "$docroot" ]; then
  # Level 1: the SFTP root's folders; level 2: their sub-folders (capped).
  printf 'pwd\nls -l %s\n' "${root:-/}" >"$work/ls1"
  if sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$work/ls1" target >"$work/ls1.out" 2>"$work/sftp.err"; then login=yes; else login=no; fi
  out "- SFTP login: **$login**"
  if [ "$login" = no ]; then
    out "- SFTP error class: \`$(grep -oE 'Permission denied|Connection (refused|timed out|closed)|Host key verification failed|Too many authentication failures' "$work/sftp.err" | head -1 || true)\`"
    exit 1
  fi
  list_dirs() { # stdin: sftp batch output of "ls -l <dir>" commands; prints <dir>/<name> per folder
    awk '/^sftp> ls -l / {cur=$4; sub(/\/$/, "", cur); next} $1 ~ /^d/ && $NF != "." && $NF != ".." {print cur "/" $NF}'
  }
  list_dirs <"$work/ls1.out" | grep -vE '[[:space:]]' >"$work/dirs1" || true
  out "- Top-level folders: \`$(sed "s#^${root:-}/##" "$work/dirs1" | paste -sd ',' -)\`"
  : >"$work/ls2"; while IFS= read -r d; do printf 'ls -l %s\n' "$d" >>"$work/ls2"; done <"$work/dirs1"
  : >"$work/dirs2"
  if [ -s "$work/ls2" ]; then
    sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$work/ls2" target 2>/dev/null | list_dirs | grep -vE '[[:space:]]' | head -150 >"$work/dirs2" || true
  fi
  candidates=("${root:-}") ; while IFS= read -r d; do candidates+=("$d"); done < <(cat "$work/dirs1" "$work/dirs2")
  : >"$work/markers"; : >"$work/unmark"
  for i in "${!candidates[@]}"; do
    printf '%s' "$i" >"$work/marker-$i.txt"
    printf -- '-put %s %s/probe-%s.txt\n' "$work/marker-$i.txt" "${candidates[$i]}" "$rand" >>"$work/markers"
    printf -- '-rm %s/probe-%s.txt\n' "${candidates[$i]}" "$rand" >>"$work/unmark"
  done
  sshpass -e sftp -oBatchMode=no -F "$work/ssh_config" -b "$work/markers" target >/dev/null 2>"$work/markers.err" || true
  failed_puts=$(grep -cE "Couldn't|Permission denied|No such file" "$work/markers.err" || true)
  hit=$(curl -fsSkL --max-time 20 "$site/probe-$rand.txt" || true)
  final=$(curl -skL -o /dev/null -w '%{http_code} %{url_effective}' --max-time 20 "$site/probe-$rand.txt" || true)
  sftp_batch "$work/unmark" || true
  out "- Markers: ${#candidates[@]} folders tried (root, $(wc -l <"$work/dirs1") top-level, $(wc -l <"$work/dirs2") second-level), $failed_puts uploads refused; marker URL answered \`$final\`"
  if [[ "$hit" =~ ^[0-9]+$ ]] && [ "$hit" -lt "${#candidates[@]}" ]; then
    docroot=${candidates[$hit]#"${root:-}"}
    docroot=${docroot#/}
    out "- Served folder (found by marker): \`${docroot:-SFTP root}\`"
  else
    out "- Served folder: **not found** at \`$site\` (the domain may point to another host, or serve a deeper folder)"
    out "- \`/\` answers: \`$(curl -skL -o /dev/null -w '%{http_code} %{url_effective}' --max-time 20 "$site/" || true)\`, server: \`$(curl -skI --max-time 20 "$site/" | grep -i '^server:' | tr -d '\r' || true)\`"
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
rewrite_script=$(jq -r '.server.scriptName // "none"' <<<"$rewrite_json" 2>/dev/null || echo none)
rewrite_path=$(jq -r '.server.requestPath // "none"' <<<"$rewrite_json" 2>/dev/null || echo none)
out "- Rewritten request as PHP sees it: \`SCRIPT_NAME\` \`${rewrite_script//probe-$rand/probe-…}\`, \`REQUEST_URI\` path \`${rewrite_path//probe-$rand/probe-…}\` (expected \`/probe-…/index.php\` and \`/probe-…/api/hello\`)"

# --- which front-controller rule form works under the host's PHP handler -------------------------
# The deploy renders `RewriteRule ^api/ api/index.php [END]`; the check above uses `[L]` behind a
# `!-f` condition. Try each form the renderer could use and report status and what PHP saw.
try_rule() { # $1 = label, $2 = .htaccess body
  printf '%b<Files "config.json">\n  Require all denied\n</Files>\n' "$2" >"$work/htaccess-variant"
  printf 'put %s %s/.htaccess\n' "$work/htaccess-variant" "$probe_dir" >"$work/variant"
  if ! sftp_batch "$work/variant"; then out "- Rule form $1: upload failed"; return; fi
  sleep 2
  local body status script
  status=$(curl -sk -o "$work/variant.out" -w '%{http_code}' --max-time 30 "$site/probe-$rand/api/hello?t=$token" || true)
  script=$(jq -r '.server.scriptName // "none"' <"$work/variant.out" 2>/dev/null || echo "not JSON")
  out "- Rule form $1: HTTP \`$status\`, \`SCRIPT_NAME\` \`${script//probe-$rand/probe-…}\`"
}
try_rule '`^api/ index.php [END]` (as deployed)' 'RewriteEngine On\nRewriteRule ^api/ index.php [END]\n'
try_rule '`^api/ index.php [L]` guarded by `REDIRECT_STATUS`' 'RewriteEngine On\nRewriteCond %%{ENV:REDIRECT_STATUS} ^$\nRewriteRule ^api/ index.php [L]\n'
try_rule '`^api/ index.php [L]` guarded by `!-f`' 'RewriteEngine On\nRewriteCond %%{REQUEST_FILENAME} !-f\nRewriteRule ^api/ index.php [L]\n'

# --- what the deployed site answers right now ------------------------------------------------------
for path in /api/health /api/index.php /; do
  live=$(curl -sk -D "$work/live.head" -o "$work/live.body" -w '%{http_code}' --max-time 30 "$site$path" || true)
  ctype=$(grep -i '^content-type:' "$work/live.head" | head -1 | tr -d '\r' | cut -c1-80 || true)
  csp=$(grep -ci '^content-security-policy:' "$work/live.head" || true)
  out "- Live \`$path\`: HTTP \`$live\`, \`${ctype:-no content type}\`, our CSP header present: \`$([ "$csp" -gt 0 ] && echo yes || echo no)\`, body starts \`$(head -c 120 "$work/live.body" | tr -d '\n\r`' | tr -s ' ')\`"
done
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
