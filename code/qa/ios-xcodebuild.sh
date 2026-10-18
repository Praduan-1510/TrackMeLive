#!/usr/bin/env bash
# Builds or tests the iOS app with Xcode for the iOS Simulator, the way code/ios/run.sh builds it.
# XcodeGen generates TrackMeLive.xcodeproj from code/ios/project.yml; then xcodebuild builds the
# TrackMeLive scheme (the app and its widget extension), or runs the scheme's tests on a simulator.
#
#   code/qa/ios-xcodebuild.sh build     build for any iOS Simulator (generic destination)
#   code/qa/ios-xcodebuild.sh test      build and run the scheme's tests on an iPhone simulator
#
# Xcode: $DEVELOPER_DIR, else the selected Xcode, else the newest /Applications/Xcode*.app (26 or
# later, for the iOS 26 SDK). Simulator: $TML_SIM_DEVICE if set, else an iPhone 17 Pro, else the
# first iPhone on the newest iOS runtime. Builds are signed "to run locally"; if that is refused,
# unsigned, like run.sh. XcodeGen comes from code/ios/scripts/bootstrap-xcodegen.sh (pinned and
# checksum-verified; it downloads only when code/ios/tools/ doesn't have it yet).
# When code/ios/Package.resolved exists, packages resolve to exactly its versions.
# TML_IOS_SCHEME picks another scheme (default TrackMeLive). Swift packages are fetched once into
# $TML_IOS_PACKAGES_DIR (default: <build dir>/SourcePackages), which CI caches.
# Logs, DerivedData and the .xcresult go to $TML_IOS_BUILD_DIR (default: $TMPDIR/tml-qa-ios).
# $TML_IOS_DIR checks another copy of code/ios (code/qa/ios-snapshot.sh sets it).
# code/check-all.sh runs this under the xcode lock; CI runs it on GitHub's Xcode 27 runner.
set -euo pipefail

action="${1:-}"
case "${action}" in
  build | test) ;;
  *) echo "usage: $0 build|test" >&2; exit 2 ;;
esac

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
IOS_DIR="$(cd "${TML_IOS_DIR:-${QA_DIR}/../ios}" && pwd -P)"
OUT="${TML_IOS_BUILD_DIR:-${TMPDIR:-/tmp}/tml-qa-ios}"
DERIVED="${OUT}/DerivedData"
SCHEME="${TML_IOS_SCHEME:-TrackMeLive}"
PACKAGES="${TML_IOS_PACKAGES_DIR:-${OUT}/SourcePackages}"
LOG="${OUT}/xcodebuild-${SCHEME}-${action}.log"
PROJECT="${IOS_DIR}/TrackMeLive.xcodeproj"
mkdir -p "${OUT}"

# Xcode.
if [[ -z "${DEVELOPER_DIR:-}" ]]; then
  selected="$(xcode-select -p 2>/dev/null || true)"
  if [[ "${selected}" != *.app/Contents/Developer ]]; then
    newest="$(find /Applications -maxdepth 1 -name 'Xcode*.app' -type d 2>/dev/null | sort -V | tail -n 1)"
    if [[ -z "${newest}" ]]; then
      echo "error: Xcode isn't installed (only the Command Line Tools at ${selected:-?})." >&2
      exit 1
    fi
    export DEVELOPER_DIR="${newest}/Contents/Developer"
  fi
fi
version="$(xcodebuild -version)"
printf '%s\n' "${version}" | head -n 2
major="$(printf '%s\n' "${version}" | awk '/^Xcode/ { split($2, v, "."); print v[1] }')"
if (( ${major:-0} < 26 )); then
  echo "error: Xcode ${major} is too old; Track Me Live needs the iOS 26 SDK (Xcode 26 or later)." >&2
  exit 1
fi
if ! xcodebuild -showsdks 2>/dev/null | grep -q iphonesimulator; then
  echo "error: this Xcode has no iOS Simulator SDK. Install it: xcodebuild -downloadPlatform iOS" >&2
  exit 1
fi

# The project, as run.sh makes it.
"${IOS_DIR}/scripts/bootstrap-xcodegen.sh"
if [[ ! -f "${IOS_DIR}/TrackMeLive/Resources/Assets.xcassets/AppIcon.appiconset/icon-1024.png" ]]; then
  "${IOS_DIR}/scripts/export-assets.sh"
fi
"${IOS_DIR}/tools/xcodegen/bin/xcodegen" generate --spec "${IOS_DIR}/project.yml" --quiet
echo "Generated ${PROJECT#"${IOS_DIR}/"} from project.yml"
# Swift package versions: once code/ios/Package.resolved is committed, build exactly those versions.
# The generated project is gitignored, so the file is copied in, and xcodebuild may not change it.
packages_flags=()
if [[ -f "${IOS_DIR}/Package.resolved" ]]; then
  resolved_dir="${PROJECT}/project.xcworkspace/xcshareddata/swiftpm"
  mkdir -p "${resolved_dir}"
  cp "${IOS_DIR}/Package.resolved" "${resolved_dir}/Package.resolved"
  packages_flags=(-onlyUsePackageVersionsFromResolvedFile)
  echo "Swift packages: the versions in code/ios/Package.resolved"
fi

# Destination.
if [[ "${action}" == build ]]; then
  destination="generic/platform=iOS Simulator"
else
  udid="$(xcrun simctl list devices available --json | python3 -I -c '
import json, sys
wanted = sys.argv[1]
def version(runtime):
    tail = runtime.rsplit(".", 1)[-1]          # com.apple.CoreSimulator.SimRuntime.iOS-27-0
    return [int(p) for p in tail.split("-")[1:] if p.isdigit()]
runtimes = sorted((r for r in json.load(sys.stdin)["devices"].items() if ".iOS-" in r[0]),
                  key=lambda r: version(r[0]), reverse=True)
for names in ([wanted] if wanted else []) + ["iPhone 17 Pro", None]:
    for _, devices in runtimes:
        for d in devices:
            if d.get("isAvailable") and d["name"].startswith("iPhone") and (names is None or d["name"] == names):
                print(d["udid"], d["name"], sep="\t")
                sys.exit(0)
' "${TML_SIM_DEVICE:-}")"
  if [[ -z "${udid}" ]]; then
    echo "error: no iPhone simulator is available. Install a runtime: xcodebuild -downloadPlatform iOS" >&2
    exit 1
  fi
  echo "Simulator: ${udid#*$'\t'} (${udid%%$'\t'*})"
  destination="platform=iOS Simulator,id=${udid%%$'\t'*}"
fi

xcb() { # <log> <build settings and actions...>
  local log="$1"
  shift
  # xcodebuild refuses an existing -resultBundlePath, so each attempt (signed, then unsigned) starts clean.
  rm -rf "${OUT}/${SCHEME}-tests.xcresult"
  xcodebuild -project "${PROJECT}" -scheme "${SCHEME}" -configuration Debug \
    -destination "${destination}" -derivedDataPath "${DERIVED}" \
    -clonedSourcePackagesDirPath "${PACKAGES}" "${packages_flags[@]+"${packages_flags[@]}"}" "$@" > "${log}" 2>&1
}
extra=()
if [[ "${action}" == test ]]; then
  extra=(-resultBundlePath "${OUT}/${SCHEME}-tests.xcresult")
fi

show_errors() { # <log>
  grep -E "error:|\*\* (BUILD|TEST) FAILED|Test Case .* failed|✘|failed \(" "$1" | head -n 60 || true
  echo "--- last 30 lines of $1"
  tail -n 30 "$1"
  # On GitHub, also post the first errors as annotations: they show on the run page without a
  # login, while job logs and artifacts need one. GitHub shows at most 10 per step.
  if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
    grep -E "error:|Test Case .* failed|✘" "$1" | awk '!seen[$0]++' | head -n 10 | tr -d '\r' |
      sed -e 's/%/%25/g' -e 's/^/::error title=xcodebuild '"${action}"'::/' || true
  fi
}

echo "xcodebuild ${action}, scheme ${SCHEME} (${destination}); full log: ${LOG}"
if xcb "${LOG}" CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= \
  "${extra[@]+"${extra[@]}"}" "${action}"; then
  echo "${action} succeeded (signed to run locally)"
elif grep -qiE "code ?sign|provisioning|entitlement" "${LOG}" && ! grep -qE "\.swift:[0-9]+:[0-9]+: error:" "${LOG}"; then
  cp "${LOG}" "${LOG%.log}-signed.log"
  echo "Signing to run locally was refused (see ${LOG%.log}-signed.log); trying unsigned"
  if ! xcb "${LOG}" CODE_SIGNING_ALLOWED=NO "${extra[@]+"${extra[@]}"}" "${action}"; then
    show_errors "${LOG}"
    exit 1
  fi
  echo "${action} succeeded (unsigned: the App Group and Push entitlements weren't applied)"
else
  show_errors "${LOG}"
  exit 1
fi
warnings="$(grep -c "warning:" "${LOG}" || true)"
echo "${warnings} warning lines in ${LOG}"
if [[ "${action}" == test ]]; then
  grep -E "Test (Suite|run) .* (passed|failed)|Executed [0-9]+ tests?|✔ Test run|✘ Test run" "${LOG}" | tail -n 5 || true
fi
