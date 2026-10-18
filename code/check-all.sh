#!/usr/bin/env bash
# Track Me Live: the one quality gate. Runs every codebase's checks and prints one line per step:
# PASS, FAIL (with its error lines and log path) or SKIP (with the reason). Works from any folder.
#
#   code/check-all.sh                     everything
#   code/check-all.sh --fast              no e2e, no prototype suite, nothing that starts an emulator
#                                         (Firebase, Android) or a simulator
#   code/check-all.sh --only backend      one codebase; repeat it or use commas: --only viewer,shared
#   code/check-all.sh --list              print the steps that would run, and exit
#   code/check-all.sh --verbose           stream each step's output (always on in GitHub Actions)
#
# Codebases and their steps:
#   repo       secrets scan, unicode scan (invisible and bidi characters), generated files,
#              style (.editorconfig), shell lint, workflow lint
#   shared     shared check (tokens and schema are current)
#   viewer     lint, typecheck, unit tests, build, e2e (each when package.json has the script); live e2e
#              (real sessions on the backend's test emulators; SKIP without JDK 21)
#   backend    lint, typecheck, test.sh (rules and functions tests on the Firebase emulators)
#   ios        typecheck, Firebase typecheck, core tests (Command Line Tools); Xcode build and
#              simulator tests;
#              locally all on a private snapshot (code/qa/ios-snapshot.sh), as the iOS agents edit
#   android    lint, unit tests, assembleDebug; instrumented tests on a running emulator
#   qa         the QA harness (code/qa: routes, fake sharer, sharing e2e): routes current, typecheck,
#              unit tests; the Gate G2 sharing e2e (Chrome follows a fake sharer) on the Firebase
#              test emulators; the Android share scenario only with TML_ANDROID_E2E=1, never in CI
#   prototype  the click-through prototype's browser suite, when something it loads changed
#              (prototype/, design-system tokens and assets, brand/logo, mascots/model), or when
#              named with --only prototype
# A step a codebase doesn't have yet, or that this machine can't run, is SKIP and says why.
# Exit status: 0 when no step failed (SKIP isn't a failure), 1 when one did, 2 on bad usage.
#
# Other agents build on this machine at the same time, so Gradle, Firebase emulator, Android
# emulator and Xcode steps run under code/scripts/with-lock.sh (locks taken in alphabetical order).
# Those and the iOS builds refuse to start with less than TML_MIN_FREE_GB GB free (default 7;
# 2 in CI), so the machine never drops below its 6 GB floor.
# A lock held longer than TML_LOCK_WAIT_MIN minutes (default 20) fails the step and names the
# holder. TML_NO_LOCKS=1 skips the locks; GitHub Actions never takes them.
# Network: none of its own. `npm ci` runs from a committed lockfile when node_modules is missing
# (in CI). Locally Gradle runs --offline. The backend's test.sh fetches its pinned firebase-tools
# with npx the first time, and the Xcode steps fetch the pinned XcodeGen the first time.
# Logs: one file per step in TML_CHECK_LOG_DIR (default: $TMPDIR/tml-check-all/<date-time>).
# shellcheck disable=SC2329 # Step functions are called by name, from the STEPS table.
set -uo pipefail # No -e here: each step runs in a subshell with -euo pipefail, and the loop collects results.

CODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_DIR="$(cd "${CODE_DIR}/.." && pwd -P)"
QA_DIR="${CODE_DIR}/qa"
LOCK="${CODE_DIR}/scripts/with-lock.sh"
CODEBASES="repo shared viewer backend ios android qa prototype"
IN_CI=0
[[ "${GITHUB_ACTIONS:-}" == true ]] && IN_CI=1

usage() { awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"; }
usage_error() { echo "check-all: $*" >&2; echo "Run code/check-all.sh --help for usage." >&2; exit 2; }

# ---------------------------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------------------------
only=""
fast=0
verbose="${IN_CI}"
list_only=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast) fast=1 ;;
    --only)
      [[ $# -ge 2 && -n "$2" ]] || usage_error "--only needs a codebase: ${CODEBASES}"
      only="${only} ${2//,/ }"
      shift
      ;;
    --only=*) only="${only} ${1#--only=}" && only="${only//,/ }" ;;
    --list) list_only=1 ;;
    -v | --verbose) verbose=1 ;;
    -h | --help) usage; exit 0 ;;
    *) usage_error "unknown option: $1" ;;
  esac
  shift
done
for name in ${only}; do
  [[ " ${CODEBASES} " == *" ${name} "* ]] || usage_error "unknown codebase '${name}' (choose from: ${CODEBASES})"
done
selected() { [[ -z "${only// /}" || " ${only} " == *" $1 "* ]]; }

stamp="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${TML_CHECK_LOG_DIR:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tml-check-all/${stamp}-$$}"
LOG_DIR="${LOG_DIR%/}"
if (( ! list_only )); then
  mkdir -p "${LOG_DIR}" || usage_error "can't create the log folder ${LOG_DIR}"
fi

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  C_PASS=$'\033[32m' C_FAIL=$'\033[1;31m' C_SKIP=$'\033[33m' C_DIM=$'\033[2m' C_OFF=$'\033[0m'
else
  C_PASS="" C_FAIL="" C_SKIP="" C_DIM="" C_OFF=""
fi

# ---------------------------------------------------------------------------------------------
# Helpers, for use inside steps (each step runs in its own subshell under set -euo pipefail)
# ---------------------------------------------------------------------------------------------

# skip <reason>: end the current step as SKIP.
skip() { printf '%s\n' "$*" > "${STEP_SKIP_FILE}"; exit 0; }

# lock_wait <name>: wait while another live process holds a with-lock.sh lock, for at most
# TML_LOCK_WAIT_MIN minutes (default 20). Past that, fail and name the holder, so a lock kept
# for an interactive session shows up as a clear FAIL instead of a gate that never ends.
lock_wait() {
  local dir="${TMPDIR:-/tmp}/tml-lock-$1" holder="" what waited=0
  local limit=$(( ${TML_LOCK_WAIT_MIN:-20} * 60 ))
  while [[ -d "${dir}" ]]; do
    holder="$(cat "${dir}/pid" 2>/dev/null || true)"
    if [[ -n "${holder}" ]] && ! kill -0 "${holder}" 2>/dev/null; then
      return 0 # Left by a dead process; with-lock.sh takes it over.
    fi
    what="$(ps -o command= -p "${holder:-0}" 2>/dev/null | cut -c1-140 || true)"
    if (( waited >= limit )); then
      echo "not run: the '$1' lock has been held for over $(( limit / 60 )) minutes by pid ${holder:-?}: ${what:-?}" >&2
      return 1
    fi
    if (( waited % 60 == 0 )); then
      echo "check-all: waiting for the '$1' lock, held by pid ${holder:-?}: ${what:-?}"
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
}

# locked <lock[,lock...]> <command> [args...]: run a command holding machine-wide locks. Pass the
# names in alphabetical order (emulator, firebase, gradle, qa-ios, xcode) so two holders never
# deadlock. qa-ios is the gate's own: it guards the iOS snapshot.
locked() {
  local names="$1" name
  shift
  if (( IN_CI )) || [[ "${TML_NO_LOCKS:-0}" == 1 ]]; then
    "$@"
    return
  fi
  if [[ ! -x "${LOCK}" ]] || ! command -v zsh > /dev/null; then
    echo "check-all: can't take the '${names}' lock (${LOCK} needs zsh); not running unlocked." >&2
    return 1
  fi
  local cmd=()
  for name in ${names//,/ }; do
    lock_wait "${name}" || return 1
    cmd+=("${LOCK}" "${name}")
  done
  "${cmd[@]}" "$@"
}

# require_disk: fail unless TML_MIN_FREE_GB GB are free. The default is 7 here (this Mac's rule is
# never below 6 GB) and 2 in CI, where the runner is thrown away after the job.
require_disk() {
  local need_gb="${TML_MIN_FREE_GB:-$(( IN_CI ? 2 : 7 ))}" free_kb
  free_kb="$(df -Pk "${REPO_DIR}" | awk 'NR == 2 { print $4 }')"
  if (( free_kb < need_gb * 1024 * 1024 )); then
    echo "not run: $((free_kb / 1024 / 1024)) GB free, and heavy steps need ${need_gb} GB." >&2
    return 1
  fi
}

# has_script <package dir> <script>: whether package.json defines that npm script.
has_script() {
  [[ -f "$1/package.json" ]] || return 1
  node -e 'const s = require(process.argv[1]).scripts || {}; process.exit(s[process.argv[2]] ? 0 : 1)' \
    "$1/package.json" "$2"
}

# first_script <package dir> <script...>: print the first of those npm scripts that exists.
first_script() {
  local dir="$1" name
  shift
  for name in "$@"; do
    if has_script "${dir}" "${name}"; then
      printf '%s\n' "${name}"
      return 0
    fi
  done
  return 1
}

# node_deps <package dir>: install from the lockfile when node_modules is missing (CI). A local
# node_modules that is older than the lockfile is left alone, since another agent may be using it.
node_deps() {
  local dir="$1"
  if [[ ! -d "${dir}/node_modules" ]]; then
    if [[ ! -f "${dir}/package-lock.json" ]]; then
      echo "no package-lock.json in ${dir}; refusing an unlocked install" >&2
      return 1
    fi
    echo "==> npm ci in ${dir#"${REPO_DIR}/"}"
    npm ci --prefix "${dir}" --no-audit --no-fund
  elif [[ -f "${dir}/package-lock.json" && "${dir}/package-lock.json" -nt "${dir}/node_modules/.package-lock.json" ]]; then
    local rel="${dir#"${REPO_DIR}/"}"
    echo "note: ${rel}/node_modules is older than its package-lock.json; if this step fails, run npm ci --prefix ${rel}"
  fi
}

# ---------------------------------------------------------------------------------------------
# Steps: repo
# ---------------------------------------------------------------------------------------------
step_secrets() { "${QA_DIR}/scan-secrets.sh"; }
step_unicode() { python3 -I "${QA_DIR}/scan-unicode.py"; }
step_generated() { "${QA_DIR}/check-generated.sh"; }
step_style() { python3 -I "${QA_DIR}/check-style.py"; }

step_shell_lint() {
  local shellcheck file
  shellcheck="$("${QA_DIR}/install-tools.sh" --path shellcheck)" \
    || skip "ShellCheck isn't installed; run code/qa/install-tools.sh (pinned, checksum-verified)"
  cd "${REPO_DIR}"
  # The gate's own scripts, at every severity.
  "${shellcheck}" -x -S style code/check-all.sh code/qa/*.sh
  echo "ok: code/check-all.sh and code/qa/*.sh"
  # Every other bash script in code/ (tracked or new), at error severity. zsh scripts are skipped
  # (ShellCheck can't read zsh), and so are the throwaway spikes. Sourced files without a shebang
  # are bash (they use BASH_SOURCE).
  local others=()
  while IFS= read -r file; do
    case "${file}" in code/qa/* | code/check-all.sh | code/spikes/*) continue ;; esac
    [[ -f "${file}" ]] || continue
    head -n 1 "${file}" | grep -q 'zsh' && continue
    others+=("${file}")
  done < <(git ls-files --cached --others --exclude-standard -- 'code/*.sh' | sort -u)
  if [[ ${#others[@]} -gt 0 ]]; then
    "${shellcheck}" -x -s bash -S error "${others[@]}"
    echo "ok: ${#others[@]} other scripts in code/ have no ShellCheck errors"
  fi
}

step_workflow_lint() {
  local actionlint shellcheck
  compgen -G "${REPO_DIR}/.github/workflows/*.y*ml" > /dev/null || skip "no workflows in .github/workflows"
  actionlint="$("${QA_DIR}/install-tools.sh" --path actionlint)" \
    || skip "actionlint isn't installed; run code/qa/install-tools.sh (pinned, checksum-verified)"
  local args=(-config-file "${QA_DIR}/actionlint.yaml")
  if shellcheck="$("${QA_DIR}/install-tools.sh" --path shellcheck)"; then
    args+=(-shellcheck "${shellcheck}")
  fi
  cd "${REPO_DIR}"
  "${actionlint}" "${args[@]}"
  echo "ok: .github/workflows pass actionlint${shellcheck:+, with ShellCheck on each run: script}"
}

# ---------------------------------------------------------------------------------------------
# Steps: shared, viewer
# ---------------------------------------------------------------------------------------------
step_shared() { npm --prefix "${CODE_DIR}/shared" run --silent check; }

VIEWER="${CODE_DIR}/viewer"
viewer_script() { # <step label> <script names...>
  local label="$1" script
  shift
  [[ -f "${VIEWER}/package.json" ]] || skip "no code/viewer/package.json"
  script="$(first_script "${VIEWER}" "$@")" || skip "code/viewer/package.json has no ${label} script ($*) yet"
  node_deps "${VIEWER}"
  echo "==> npm run ${script}"
  npm --prefix "${VIEWER}" run --silent "${script}"
}
step_viewer_lint() { viewer_script lint lint; }
step_viewer_typecheck() { viewer_script typecheck typecheck; }
step_viewer_unit() { viewer_script "unit test" test:unit test; }
step_viewer_build() { viewer_script build build; }
step_viewer_e2e() {
  (( fast )) && skip "--fast"
  viewer_script e2e test:e2e e2e
}
# A JDK 21 or newer, found the way code/backend/scripts/env.sh finds one (the emulators need it).
jdk21() {
  local home="${EMULATOR_JAVA_HOME:-}" java major
  if [[ -z "${home}" && -x /usr/libexec/java_home ]]; then home="$(/usr/libexec/java_home -v 21+ 2>/dev/null || true)"; fi
  [[ -z "${home}" ]] && home="${JAVA_HOME:-}"
  java="${home:+${home}/bin/java}"
  [[ -n "${java}" && -x "${java}" ]] || java="$(command -v java || true)"
  [[ -n "${java}" ]] || return 1
  major="$("${java}" -version 2>&1 | sed -nE '1s/.*version "([0-9]+).*/\1/p')"
  [[ -n "${major}" && "${major}" -ge 21 ]]
}
# Real sessions on the backend's test emulator set, through its wrapper (which reuses this gate's
# firebase lock). Each test makes its own sharer and session there.
step_viewer_live_e2e() {
  (( fast )) && skip "--fast (the live e2e needs the Firebase emulators)"
  [[ -f "${VIEWER}/package.json" ]] || skip "no code/viewer/package.json"
  has_script "${VIEWER}" test:e2e:live || skip "code/viewer/package.json has no test:e2e:live script"
  local wrapper="${CODE_DIR}/backend/scripts/with-test-emulators.sh"
  [[ -x "${wrapper}" ]] || skip "no code/backend/scripts/with-test-emulators.sh"
  jdk21 || skip "JDK 21 not found (the Firebase emulators need it; see code/backend/README.md)"
  # No disk floor here: it writes only a temporary build and screenshots (a few MB).
  node_deps "${VIEWER}"
  echo "==> with-test-emulators.sh npm run test:e2e:live"
  locked firebase "${wrapper}" npm --prefix "${VIEWER}" run --silent test:e2e:live
}

# ---------------------------------------------------------------------------------------------
# Steps: backend
# ---------------------------------------------------------------------------------------------
BACKEND="${CODE_DIR}/backend"
step_backend_lint() {
  [[ -f "${BACKEND}/functions/package.json" ]] || skip "no code/backend/functions"
  node_deps "${BACKEND}/functions"
  echo "==> functions: eslint + tsc --noEmit"
  npm --prefix "${BACKEND}/functions" run --silent lint
}
step_backend_typecheck() {
  [[ -f "${BACKEND}/tests/package.json" ]] || skip "no code/backend/tests"
  has_script "${BACKEND}/tests" typecheck || skip "code/backend/tests has no typecheck script"
  node_deps "${BACKEND}/tests"
  # The tests import the compiled functions (functions/lib), which is gitignored, so build first.
  node_deps "${BACKEND}/functions"
  echo "==> functions: build"
  npm --prefix "${BACKEND}/functions" run --silent build
  echo "==> tests: tsc"
  npm --prefix "${BACKEND}/tests" run --silent typecheck
}
# The gate always starts its own emulators under the firebase lock. It never borrows a running
# run.sh session: test runs wipe the emulators' data, and that session is someone's.
step_backend_test() {
  (( fast )) && skip "--fast (test.sh needs the Firebase emulators)"
  [[ -x "${BACKEND}/test.sh" ]] || skip "no code/backend/test.sh"
  require_disk
  locked firebase "${BACKEND}/test.sh"
}

# ---------------------------------------------------------------------------------------------
# Steps: iOS
# ---------------------------------------------------------------------------------------------
IOS="${CODE_DIR}/ios"
# Prints the developer folder of a full Xcode (not just the Command Line Tools), if there is one.
xcode_dir() {
  local selected newest
  if [[ -n "${DEVELOPER_DIR:-}" && "${DEVELOPER_DIR}" == *.app/Contents/Developer ]]; then
    printf '%s\n' "${DEVELOPER_DIR}"
    return 0
  fi
  selected="$(xcode-select -p 2>/dev/null || true)"
  if [[ "${selected}" == *.app/Contents/Developer ]]; then
    printf '%s\n' "${selected}"
    return 0
  fi
  newest="$(find /Applications -maxdepth 1 -name 'Xcode*.app' -type d 2>/dev/null | sort -V | tail -n 1)"
  [[ -n "${newest}" ]] || return 1
  printf '%s\n' "${newest}/Contents/Developer"
}
need_macos() { [[ "$(uname -s)" == Darwin ]] || skip "needs macOS"; }
# The iOS steps run on a private snapshot (code/qa/ios-snapshot.sh), because the iOS agents edit and
# build the same files while the gate compiles. The qa-ios lock keeps two gate runs off one snapshot.
step_ios_typecheck() {
  need_macos
  [[ -x "${IOS}/scripts/typecheck.sh" ]] || skip "no code/ios/scripts/typecheck.sh"
  require_disk
  locked qa-ios "${QA_DIR}/ios-snapshot.sh" ./scripts/typecheck.sh
}
step_ios_firebase_typecheck() {
  need_macos
  [[ -x "${IOS}/scripts/typecheck-firebase.sh" ]] || skip "no code/ios/scripts/typecheck-firebase.sh"
  require_disk
  locked qa-ios "${QA_DIR}/ios-snapshot.sh" ./scripts/typecheck-firebase.sh
}
step_ios_core() {
  need_macos
  [[ -x "${IOS}/scripts/test-core.sh" ]] || skip "no code/ios/scripts/test-core.sh"
  require_disk
  locked qa-ios "${QA_DIR}/ios-snapshot.sh" ./scripts/test-core.sh
}
ios_xcodebuild() { # build|test
  local dev
  need_macos
  dev="$(xcode_dir)" || skip "Xcode isn't installed (only the Command Line Tools); CI builds it on the Xcode 27 runner"
  [[ -f "${IOS}/project.yml" ]] || skip "no code/ios/project.yml"
  require_disk
  export DEVELOPER_DIR="${dev}"
  locked qa-ios,xcode "${QA_DIR}/ios-snapshot.sh" "${QA_DIR}/ios-xcodebuild.sh" "$1"
}
step_ios_build() { ios_xcodebuild build; }
step_ios_simulator() {
  (( fast )) && skip "--fast (starts a simulator)"
  ios_xcodebuild test
}

# ---------------------------------------------------------------------------------------------
# Steps: Android
# ---------------------------------------------------------------------------------------------
ANDROID="${CODE_DIR}/android"
# Sets up JDK 17 and the SDK as code/android/run.sh does, and the Gradle flags.
android_env() {
  [[ -x "${ANDROID}/gradlew" ]] || skip "no code/android/gradlew"
  if [[ -z "${JAVA_HOME:-}" ]] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -q '"17\.'; then
    if [[ -x /usr/libexec/java_home ]] && JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null)"; then
      export JAVA_HOME
    else
      echo "JDK 17 not found (code/android/README.md)" >&2
      return 1
    fi
  fi
  export ANDROID_HOME="${ANDROID_HOME:-${HOME}/Library/Android/sdk}"
  export GRADLE_OPTS="${GRADLE_OPTS:--Djava.net.preferIPv4Stack=true}"
  GRADLE_FLAGS=(--console=plain --warning-mode=summary)
  # Locally, only what's already in the Gradle cache: no downloads behind anyone's back.
  (( IN_CI )) || GRADLE_FLAGS+=(--offline)
  cd "${ANDROID}"
}
# Prints the source folders of one kind (test, androidTest) in any module, if any exist.
android_sources() {
  find "${ANDROID}" \( -path '*/build' -o -path '*/.gradle' -o -path '*/.kotlin' \) -prune -o \
    -type d -path "*/src/$1" -print 2>/dev/null
}
# run_gradle <tasks...>: ./gradlew under the gradle lock (GRADLE_LOCKS overrides it), explaining
# an --offline miss.
run_gradle() {
  local out status=0 missing
  require_disk
  echo "==> ./gradlew ${GRADLE_FLAGS[*]} $*"
  out="$(mktemp)"
  locked "${GRADLE_LOCKS:-gradle}" ./gradlew "${GRADLE_FLAGS[@]}" "$@" 2>&1 | tee "${out}" || status=$?
  if (( status != 0 )) && grep -q "available for offline mode" "${out}"; then
    missing="$(grep -o 'No cached version of [^ ]* available' "${out}" | awk '{ print $5 }' | sort -u | tr '\n' ' ')"
    echo "check-all: Gradle runs --offline here, and these dependencies aren't in ~/.gradle yet: ${missing}"
    echo "check-all: whoever added them should run the same tasks once online (cd code/android && ./gradlew $*) so they're cached."
  fi
  rm -f "${out}"
  return "${status}"
}
step_android_lint() { android_env; run_gradle lintDebug; }
step_android_unit() {
  android_env
  [[ -n "$(android_sources test)" ]] || skip "no unit tests yet (src/test)"
  run_gradle testDebugUnitTest
}
step_android_assemble() { android_env; run_gradle assembleDebug; }
step_android_device() {
  (( fast )) && skip "--fast (needs the Android emulator)"
  android_env
  [[ -n "$(android_sources androidTest)" ]] || skip "no instrumented tests yet (src/androidTest)"
  local adb="${ANDROID_HOME}/platform-tools/adb" serial
  [[ -x "${adb}" ]] || skip "no adb in ${ANDROID_HOME}/platform-tools"
  serial="${ANDROID_SERIAL:-$("${adb}" devices | awk '$2 == "device" && $1 ~ /^emulator-/ { print $1; exit }')}"
  [[ -n "${serial}" ]] || skip "no emulator online (code/android/run.sh boots Pixel_9)"
  echo "==> on ${serial}"
  export ANDROID_SERIAL="${serial}"
  # Leave the app installed afterwards: the emulator is the one people watch, and the sharing e2e
  # (qa android e2e) starts from the installed app. AGP uninstalls it after the run by default.
  GRADLE_LOCKS="emulator,gradle" run_gradle connectedDebugAndroidTest \
    -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true
}

# ---------------------------------------------------------------------------------------------
# Steps: qa (code/qa: simulated routes, the fake sharer, the Gate G2 sharing e2e)
# ---------------------------------------------------------------------------------------------
QA_SHARER="${QA_DIR}/fake-sharer"
QA_E2E="${QA_DIR}/e2e-sharing"
step_qa_typecheck() {
  [[ -f "${QA_SHARER}/package.json" && -f "${QA_E2E}/package.json" ]] || skip "no code/qa/fake-sharer or code/qa/e2e-sharing"
  node_deps "${QA_SHARER}"
  node_deps "${QA_E2E}"
  echo "==> the route files are what build-routes.ts makes"
  node "${QA_DIR}/routes/build-routes.ts" --check
  echo "==> tsc: routes and fake sharer"
  npm --prefix "${QA_SHARER}" run --silent typecheck
  echo "==> tsc: sharing e2e"
  npm --prefix "${QA_E2E}" run --silent typecheck
}
step_qa_unit() {
  [[ -f "${QA_SHARER}/package.json" ]] || skip "no code/qa/fake-sharer"
  node_deps "${QA_SHARER}"
  npm --prefix "${QA_SHARER}" run --silent test
}
# The Gate G2 browser scenarios and the ping-rule checks, on the test emulator set (its own project
# and ports, wiped per run), with the page served by their own Vite server. Never the dev set.
step_qa_e2e() {
  (( fast )) && skip "--fast (starts the Firebase test emulators and Chrome)"
  [[ -f "${QA_E2E}/package.json" ]] || skip "no code/qa/e2e-sharing"
  [[ -x "${BACKEND}/scripts/with-test-emulators.sh" ]] || skip "no code/backend/scripts/with-test-emulators.sh"
  [[ -d "/Applications/Google Chrome.app" ]] || command -v google-chrome > /dev/null || skip "needs Google Chrome"
  require_disk
  node_deps "${QA_SHARER}"
  node_deps "${QA_E2E}"
  node_deps "${VIEWER}"
  locked firebase "${BACKEND}/scripts/with-test-emulators.sh" npm --prefix "${QA_E2E}" run --silent test
}
# Drives the app on the emulator (it clears the app's data) against the dev emulator set, so it runs
# only when asked for. It holds the emulator lock for the whole scenario (about 2 minutes), so nothing
# else can install or drive the emulator between its steps; TML_EMULATOR_LOCK_HELD tells its own adb
# calls not to take the lock again.
step_qa_android() {
  (( fast )) && skip "--fast (needs the Android emulator)"
  (( IN_CI )) && skip "needs the Android emulator; local only"
  [[ "${TML_ANDROID_E2E:-0}" == 1 ]] || skip "set TML_ANDROID_E2E=1 to run it (it clears the app's data, so it needs the emulator to itself)"
  [[ -f "${QA_E2E}/package.json" ]] || skip "no code/qa/e2e-sharing"
  node_deps "${QA_SHARER}"
  node_deps "${QA_E2E}"
  node_deps "${VIEWER}"
  locked emulator env TML_EMULATOR_LOCK_HELD=1 npm --prefix "${QA_E2E}" run --silent test:android:held
}

# ---------------------------------------------------------------------------------------------
# Steps: prototype
# ---------------------------------------------------------------------------------------------
# kill_tree <pid>: stop a process and everything it started.
kill_tree() {
  local child
  for child in $(pgrep -P "$1" 2>/dev/null); do
    kill_tree "${child}"
  done
  kill "$1" 2>/dev/null || true
}
# The suite takes long and nobody edits the prototype in Sprint 1, so it runs when what the
# prototype loads changed (prototype/, design-system/tokens.css and assets/, brand/logo/,
# mascots/model/: uncommitted, or since TML_BASE_REF), or when asked for by name (--only
# prototype). It's stopped after TML_PROTOTYPE_TIMEOUT_MIN minutes (default 45). It passes only if
# run-suite.sh exits 0, its TOTAL has 0 FAIL, and every test log ends with "no errors": its TOTAL
# counts FAIL lines only, not page errors or a test that died.
step_prototype() {
  (( fast )) && skip "--fast (the browser suite takes minutes)"
  local tests="${REPO_DIR}/prototype/tests" out="${LOG_DIR}/prototype-suite"
  local inputs="prototype design-system/tokens.css design-system/assets brand/logo mascots/model"
  local changed limit pid waited=0 total log bad=0
  [[ -x "${tests}/run-suite.sh" ]] || skip "no prototype/tests/run-suite.sh"
  if [[ " ${only} " != *" prototype "* ]]; then
    # shellcheck disable=SC2086 # the input folders are a fixed word list
    changed="$(git -C "${REPO_DIR}" status --porcelain -- ${inputs})"
    if [[ -n "${TML_BASE_REF:-}" ]] && git -C "${REPO_DIR}" rev-parse --verify --quiet "${TML_BASE_REF}^{commit}" > /dev/null; then
      # shellcheck disable=SC2086
      changed="${changed}$(git -C "${REPO_DIR}" diff --name-only "${TML_BASE_REF}...HEAD" -- ${inputs})"
    fi
    [[ -n "${changed}" ]] || skip "nothing the prototype loads has changed (--only prototype runs it anyway)"
  fi
  command -v zsh > /dev/null || skip "run-suite.sh needs zsh"
  [[ -d "/Applications/Google Chrome.app" ]] || command -v google-chrome > /dev/null || skip "needs Google Chrome"
  # Its lockfile isn't committed, so never install here.
  [[ -d "${tests}/node_modules" ]] || skip "prototype/tests/node_modules is missing (cd prototype/tests && npm i)"
  limit=$(( ${TML_PROTOTYPE_TIMEOUT_MIN:-45} * 60 ))
  "${tests}/run-suite.sh" "${out}" > "${out}.summary" 2>&1 &
  pid=$!
  while kill -0 "${pid}" 2>/dev/null; do
    if (( waited >= limit )); then
      kill_tree "${pid}"
      cat "${out}.summary"
      echo "prototype suite: still running after $(( limit / 60 )) minutes, so it was stopped. Logs: ${out}" >&2
      return 1
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
  if ! wait "${pid}"; then
    cat "${out}.summary"
    echo "run-suite.sh exited non-zero" >&2
    return 1
  fi
  cat "${out}.summary"
  total="$(grep -E '^TOTAL [0-9]+ PASS, [0-9]+ FAIL' "${out}.summary" | tail -n 1 || true)"
  [[ -n "${total}" ]] || { echo "run-suite.sh printed no TOTAL line" >&2; return 1; }
  for log in "${out}"/*.log; do
    [[ "${log}" == *.try1.log ]] && continue
    grep -qx 'no errors' "${log}" || { echo "not clean: ${log}" >&2; bad=$(( bad + 1 )); }
  done
  if (( bad > 0 )); then
    echo "${bad} test log(s) don't end with 'no errors' (page errors, or a test that died)" >&2
    return 1
  fi
  [[ "${total}" == *", 0 FAIL" ]] || { echo "${total} (screenshots and logs: ${out})" >&2; return 1; }
}

# ---------------------------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------------------------
STEPS=(
  "repo|secrets scan|step_secrets"
  "repo|unicode scan|step_unicode"
  "repo|generated files|step_generated"
  "repo|style|step_style"
  "repo|shell lint|step_shell_lint"
  "repo|workflow lint|step_workflow_lint"
  "shared|shared check|step_shared"
  "viewer|viewer lint|step_viewer_lint"
  "viewer|viewer typecheck|step_viewer_typecheck"
  "viewer|viewer unit tests|step_viewer_unit"
  "viewer|viewer build|step_viewer_build"
  "viewer|viewer e2e|step_viewer_e2e"
  "viewer|viewer live e2e|step_viewer_live_e2e"
  "backend|backend lint|step_backend_lint"
  "backend|backend typecheck|step_backend_typecheck"
  "backend|backend test|step_backend_test"
  "ios|ios typecheck|step_ios_typecheck"
  "ios|ios firebase typecheck|step_ios_firebase_typecheck"
  "ios|ios core tests|step_ios_core"
  "ios|ios build|step_ios_build"
  "ios|ios simulator tests|step_ios_simulator"
  "android|android lint|step_android_lint"
  "android|android unit tests|step_android_unit"
  "android|android assemble|step_android_assemble"
  "android|android device tests|step_android_device"
  "qa|qa typecheck|step_qa_typecheck"
  "qa|qa unit tests|step_qa_unit"
  "qa|qa sharing e2e|step_qa_e2e"
  "qa|qa android e2e|step_qa_android"
  "prototype|prototype suite|step_prototype"
)

R_LINES=()
n_pass=0 n_fail=0 n_skip=0
started=${SECONDS}

print_result() { # <status> <name> <seconds> <note>
  local color
  case "$1" in PASS) color="${C_PASS}" ;; FAIL) color="${C_FAIL}" ;; *) color="${C_SKIP}" ;; esac
  printf '%s%-4s%s  %-22s %5ss  %s%s%s\n' "${color}" "$1" "${C_OFF}" "$2" "$3" "${C_DIM}" "$4" "${C_OFF}"
}

summary() {
  local line
  echo
  echo "check-all summary ($(( SECONDS - started ))s, logs in ${LOG_DIR}):"
  for line in "${R_LINES[@]+"${R_LINES[@]}"}"; do
    printf '%s\n' "${line}"
  done
  echo "${n_pass} passed, ${n_fail} failed, ${n_skip} skipped"
}

on_interrupt() {
  echo
  echo "check-all: interrupted"
  summary
  exit 130
}
trap on_interrupt INT TERM

# excerpt <log>: the lines of a failed step's log worth reading: the first lines that look like
# errors, then the last lines, without terminal colors and cut to 200 characters.
excerpt() {
  local esc=$'\033'
  sed -E "s/${esc}\[[0-9;]*[A-Za-z]//g" "$1" > "$1.plain"
  if grep -n -i -E '(^|[^a-z])(error|fail(ed|ure)?|exception)([^a-z]|$)|✖|✘' "$1.plain" > "$1.errors"; then
    echo "      | first error lines:"
    head -n 12 "$1.errors" | cut -c1-200 | sed 's/^/      |   /'
  fi
  echo "      | last lines:"
  tail -n 12 "$1.plain" | cut -c1-200 | sed 's/^/      |   /'
  rm -f "$1.plain" "$1.errors"
}

# execute <function> <log>: run one step function in a subshell under set -euo pipefail, with no
# terminal on stdin, so nothing can stop to wait for input (and tools like vitest don't go into
# watch mode). Call it as a plain command (never after || or in an if), or bash would switch -e
# off inside the step.
execute() {
  local fn="$1" log="$2" status
  if (( verbose )); then
    (
      set -euo pipefail
      "${fn}"
    ) < /dev/null 2>&1 | tee "${log}"
    status=${PIPESTATUS[0]}
  else
    (
      set -euo pipefail
      "${fn}"
    ) < /dev/null > "${log}" 2>&1
    status=$?
  fi
  return "${status}"
}

run_step() { # <name> <function>
  local name="$1" fn="$2" slug status start seconds note="" line
  slug="$(printf '%s' "${name}" | tr -c 'A-Za-z0-9' '-')"
  STEP_LOG="${LOG_DIR}/${slug}.log"
  STEP_SKIP_FILE="${LOG_DIR}/${slug}.skip"
  rm -f "${STEP_SKIP_FILE}"
  start=${SECONDS}
  (( IN_CI )) && echo "::group::${name}"
  execute "${fn}" "${STEP_LOG}"
  status=$?
  # Other agents edit while the gate runs. A source saved while the compiler was reading it says
  # nothing about the code, so that one failure, and only that one, gets a second run.
  if (( status != 0 )) && grep -q "was modified during the build" "${STEP_LOG}"; then
    mv "${STEP_LOG}" "${STEP_LOG%.log}.try1.log"
    rm -f "${STEP_SKIP_FILE}"
    (( verbose )) && echo "check-all: a source file changed during the build; running '${name}' once more"
    execute "${fn}" "${STEP_LOG}"
    status=$?
    note="retried once: a source changed mid-build; "
  fi
  (( IN_CI )) && echo "::endgroup::"
  seconds=$(( SECONDS - start ))
  if (( status != 0 )); then
    line="$(print_result FAIL "${name}" "${seconds}" "${note}exit ${status}; log: ${STEP_LOG}")"
    n_fail=$((n_fail + 1))
    printf '%s\n' "${line}"
    (( verbose )) || excerpt "${STEP_LOG}"
    # The annotation carries the log's last lines: annotations show without a GitHub login, logs don't.
    (( IN_CI )) && echo "::error title=check-all: ${name} failed::exit ${status}; last lines of the '${name}' group:%0A$(
      tail -n 25 "${STEP_LOG}" | cut -c1-240 | tr -d '\r' | sed 's/%/%25/g' | awk 'BEGIN { ORS = "%0A" } 1')"
  elif [[ -s "${STEP_SKIP_FILE}" ]]; then
    line="$(print_result SKIP "${name}" "${seconds}" "${note}$(head -n 1 "${STEP_SKIP_FILE}")")"
    n_skip=$((n_skip + 1))
    printf '%s\n' "${line}"
  else
    line="$(print_result PASS "${name}" "${seconds}" "${note%; }")"
    n_pass=$((n_pass + 1))
    printf '%s\n' "${line}"
  fi
  R_LINES+=("${line}")
}

# Everything below runs inside main, which bash reads in full before it starts, so editing this
# file during a run can't change that run.
main() {
  local entry codebase rest name fn head_ref dirty mode codebases
  if (( ! list_only )); then
    head_ref="$(git -C "${REPO_DIR}" rev-parse --short HEAD 2>/dev/null || echo "no git")"
    dirty="$(git -C "${REPO_DIR}" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
    mode="full"
    (( fast )) && mode="fast"
    codebases="$(printf '%s' "${only}" | xargs)"
    printf 'check-all: %s run at %s (%s uncommitted paths), %s, codebases: %s\n' \
      "${mode}" "${head_ref}" "${dirty}" "$(date '+%Y-%m-%d %H:%M')" "${codebases:-all}"
  fi
  for entry in "${STEPS[@]}"; do
    codebase="${entry%%|*}"
    rest="${entry#*|}"
    name="${rest%%|*}"
    fn="${rest#*|}"
    selected "${codebase}" || continue
    if (( list_only )); then
      printf '%-10s %s\n' "${codebase}" "${name}"
      continue
    fi
    run_step "${name}" "${fn}"
  done
  (( list_only )) && return 0
  summary
  (( n_fail == 0 ))
}

main; exit $?
