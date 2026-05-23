#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
exec uvicorn server:app --host 0.0.0.0 --port "${PORT:-8080}"
