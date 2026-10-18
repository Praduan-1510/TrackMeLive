#!/bin/zsh
# Run a heavy command while holding a named machine-wide lock, so agents take turns.
#   code/scripts/with-lock.sh <name> <command> [args...]
# Names in use: gradle (any Gradle build), emulator (installing or driving the Pixel_9
# emulator), firebase (Firebase emulators started by a test run), xcode (xcodebuild).
# The lock is a directory under $TMPDIR; a lock left by a dead process is taken over.
set -u
name=${1:?lock name}; shift
lock="${TMPDIR:-/tmp}/tml-lock-$name"
waited=0
while ! mkdir "$lock" 2>/dev/null; do
  holder=$(cat "$lock/pid" 2>/dev/null || echo "")
  if [[ -n "$holder" ]] && ! kill -0 "$holder" 2>/dev/null; then
    rm -rf "$lock"; continue
  fi
  (( waited % 30 == 0 )) && echo "with-lock: waiting for '$name' (held by pid ${holder:-?})" >&2
  sleep 2; waited=$((waited + 2))
done
echo $$ > "$lock/pid"
trap 'rm -rf "$lock"' EXIT INT TERM
"$@"
