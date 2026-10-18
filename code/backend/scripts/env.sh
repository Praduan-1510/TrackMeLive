# shellcheck shell=bash
# Shared setup for run.sh and test.sh. Source it; don't run it.
# Sets: BACKEND_DIR, PROJECT_ID, FIREBASE (array), JAVA_HOME, PATH, JAVA_TOOL_OPTIONS.

BACKEND_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_ID="${PROJECT_ID:-demo-trackmelive}"
FIREBASE_TOOLS_VERSION="15.32.1"
FIREBASE=(npx -y "firebase-tools@${FIREBASE_TOOLS_VERSION}")

# Emulator ports; keep these in sync with firebase.json.
AUTH_PORT=9099
FIRESTORE_PORT=8080
FUNCTIONS_PORT=5001
HOSTING_PORT=5050
HUB_PORT=4400
UI_PORT=4000

# The emulators are Java programs, and firebase-tools 15 refuses Java older
# than 21. The Android build on this machine pins JDK 17 in JAVA_HOME, so don't
# trust an inherited JAVA_HOME: use EMULATOR_JAVA_HOME if set, else a JDK 21+
# that macOS knows about, else JAVA_HOME if it is 21+.
java_major() { "$1/bin/java" -version 2>&1 | sed -nE '1s/.*version "([0-9]+).*/\1/p'; }
if [[ -n "${EMULATOR_JAVA_HOME:-}" ]]; then
  JAVA_HOME="${EMULATOR_JAVA_HOME}"
elif [[ -x /usr/libexec/java_home ]] && found="$(/usr/libexec/java_home -v 21+ 2>/dev/null)"; then
  JAVA_HOME="${found}"
fi
if [[ -z "${JAVA_HOME:-}" || ! -x "${JAVA_HOME}/bin/java" || "$(java_major "${JAVA_HOME}")" -lt 21 ]]; then
  echo "error: the Firebase emulators need JDK 21 or newer. Install Temurin 21, or set EMULATOR_JAVA_HOME." >&2
  return 1 2>/dev/null || exit 1
fi
export JAVA_HOME
export PATH="${JAVA_HOME}/bin:${PATH}"

# Java's dual-stack sockets fail HTTPS handshakes in some sandboxed shells on
# this machine; IPv4 avoids that and is harmless elsewhere.
case " ${JAVA_TOOL_OPTIONS:-} " in
  *preferIPv4Stack*) ;;
  *) export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:+${JAVA_TOOL_OPTIONS} }-Djava.net.preferIPv4Stack=true" ;;
esac

# Install a package's dependencies from its lockfile when node_modules is missing
# or older than the lockfile.
ensure_deps() {
  local dir="$1"
  if [[ ! -d "${dir}/node_modules" || "${dir}/package-lock.json" -nt "${dir}/node_modules/.package-lock.json" ]]; then
    echo "==> npm ci in ${dir#"${BACKEND_DIR}/"}"
    npm ci --prefix "${dir}" --no-audit --no-fund
  fi
}

build_functions() {
  ensure_deps "${BACKEND_DIR}/functions"
  echo "==> building functions"
  npm --prefix "${BACKEND_DIR}/functions" run --silent build
}
