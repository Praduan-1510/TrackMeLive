#!/usr/bin/env bash
# Starts the Track Me Live emulators for the offline demo project:
# Auth, Firestore, Functions, the Emulator UI, and Hosting when code/viewer/dist
# exists. Extra arguments go to `firebase emulators:start`, for example
#   ./run.sh --import .emulator-data --export-on-exit
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/scripts/env.sh"
cd "${BACKEND_DIR}"

build_functions

only="auth,firestore,functions"
viewer_dist="${BACKEND_DIR}/../viewer/dist"
if [[ -f "${viewer_dist}/index.html" ]]; then
  only="${only},hosting"
else
  echo "==> code/viewer/dist/index.html not found; starting without Hosting (build the viewer to serve it)"
fi

echo "==> Java: $(java -version 2>&1 | grep -v "^Picked up" | head -n 1)"
echo "==> Emulator UI http://127.0.0.1:${UI_PORT}  (Ctrl-C to stop)"
echo "    Rebuild functions on change in another terminal: npm --prefix functions run build:watch"
exec "${FIREBASE[@]}" emulators:start --project "${PROJECT_ID}" --only "${only}" "$@"
