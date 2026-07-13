#!/usr/bin/env bash
set -euo pipefail

# Vercel does not run the Railway/Nixpacks Python install step, so the
# serverless function cannot spawn `hermes` unless we bundle a small Python
# virtualenv into the deployment.
#
# Keep this opt-in: set HERMES_PREVIEW_USE_CLI=1 in Vercel if the preview should
# use Hermes Agent. If unset/0, the app still deploys and uses the local dynamic
# preview fallback.
if [[ "${HERMES_PREVIEW_USE_CLI:-0}" != "1" ]]; then
  echo "HERMES_PREVIEW_USE_CLI is not 1; skipping bundled Hermes Agent install."
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
