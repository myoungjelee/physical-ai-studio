#!/usr/bin/env bash
set -euo pipefail

# Isolated CUDA test of the fork; never changes the existing Studio container.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/application/docker"

export PORT="${PORT:-7861}"
export COMPOSE_PROFILES=cuda
export GIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
export GIT_COMMIT_DATE="$(git -C "$ROOT" show -s --format=%cI HEAD)"

compose=(docker compose -p pai-bimanual-test -f docker-compose.yaml -f docker-compose.bimanual-test.yaml)

case "${1:-}" in
  config) "${compose[@]}" config ;;
  build) "${compose[@]}" build physical-ai-studio-cuda ;;
  up) "${compose[@]}" up -d --no-build physical-ai-studio-cuda ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --tail=100 -f physical-ai-studio-cuda ;;
  *) echo "Usage: $0 {config|build|up|down|logs}" >&2; exit 2 ;;
esac
