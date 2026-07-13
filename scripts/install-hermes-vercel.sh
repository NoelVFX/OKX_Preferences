#!/usr/bin/env bash
set -euo pipefail

# Vercel does not run the Railway/Nixpacks Python install step, so the
# serverless function cannot spawn `hermes` unless we bundle a small Python
# virtualenv into the deployment.
#
# Run only in Vercel. Local npm install should stay fast and should not create a
# Python virtualenv unless the developer explicitly runs this script with VERCEL=1.
if [[ "${VERCEL:-0}" != "1" && -z "${VERCEL_URL:-}" ]]; then
  echo "Not running in Vercel; skipping bundled Hermes Agent install."
  exit 0
fi

# Runtime defaults HERMES_PREVIEW_USE_CLI to enabled, so build-time should do the
# same. If this default is 0, Vercel skips the install, then server.js later tries
# to spawn Hermes and falls back because the binary is missing.
if [[ "${HERMES_PREVIEW_USE_CLI:-1}" != "1" ]]; then
  echo "HERMES_PREVIEW_USE_CLI is disabled; skipping bundled Hermes Agent install."
  exit 0
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not available in the Vercel build image; Hermes CLI preview will fall back at runtime."
  exit 0
fi

python3 -m venv .vercel-hermes
.vercel-hermes/bin/python -m pip install --upgrade pip
.vercel-hermes/bin/python -m pip install "hermes-agent==0.15.2"
.vercel-hermes/bin/hermes --version || true
