#!/usr/bin/env bash
# Lints GitHub workflow files with actionlint and zizmor from digest-pinned
# images, identically on a workstation and in CI (imported from projekt2406).
#
# Usage: scripts/lint-workflows.sh [--only actionlint|zizmor] [paths…]
# Default path: .github/workflows
set -euo pipefail

ACTIONLINT_IMAGE='rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667'
ZIZMOR_IMAGE='ghcr.io/zizmorcore/zizmor:1.31.1@sha256:42d409dbb851d4c5d35a058cf042b828bea1e3f2884378c526eb0974780e18d9'

only=''
if [ "${1:-}" = '--only' ]; then
  only="${2:?--only needs actionlint or zizmor}"
  case "$only" in
    actionlint | zizmor) ;;
    *)
      echo "unknown linter: $only" >&2
      exit 2
      ;;
  esac
  shift 2
fi
if [ "$#" -eq 0 ]; then
  set -- .github/workflows
fi

cd "$(git rev-parse --show-toplevel)"

run_actionlint() {
  local files=() path
  shopt -s nullglob
  for path in "$@"; do
    if [ -d "$path" ]; then
      files+=("$path"/*.yml "$path"/*.yaml)
    else
      files+=("$path")
    fi
  done
  shopt -u nullglob
  docker run --rm --network none -v "$PWD:/repo:ro" -w /repo \
    "$ACTIONLINT_IMAGE" "${files[@]}"
}

run_zizmor() {
  local args=(--rm -v "$PWD:/repo:ro" -w /repo)
  local mode=()
  if [ -n "${GH_TOKEN:-}" ]; then
    # Passed by name only, so the value never reaches argv or the log.
    args+=(-e GH_TOKEN)
  else
    mode=(--offline)
  fi
  docker run "${args[@]}" "$ZIZMOR_IMAGE" "${mode[@]}" "$@"
}

status=0
if [ "$only" != 'zizmor' ]; then
  run_actionlint "$@" || status=1
fi
if [ "$only" != 'actionlint' ]; then
  run_zizmor "$@" || status=1
fi
exit "$status"
