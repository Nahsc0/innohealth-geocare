#!/bin/sh
set -eu

python -m backend.core
exec uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-8000}" --no-access-log
