#!/bin/zsh
# Runs every prototype test, two browsers at a time, retrying a failed test once.
#   cd prototype/tests && npm i && ./run-suite.sh [out-dir]      (default: out/suite)
# SNAP=1 tests a copy of the prototype taken at the start, so editing can go on while it runs.
# PROTO_URL=<url> tests another copy (it must sit next to design-system/ and brand/).
cd "$(dirname $0)"
HERE=$(pwd -P)
O=${1:-out/suite}
rm -rf $O; mkdir -p $O/shots/{walk,narrow,picker,rules,android,fixes,a11y,icons,r3}
if [ "$SNAP" = 1 ]; then
  R=$(cd $HERE/../.. && pwd -P)
  mkdir -p $O/snap && rsync -a --exclude tests $R/prototype/ $O/snap/prototype/ && ln -s $R/design-system $O/snap/design-system && ln -s $R/brand $O/snap/brand
  export PROTO_URL="file://$(cd $O/snap/prototype && pwd -P)/index.html"
  echo "testing a snapshot: $PROTO_URL"
fi
# Each test gets at most TEST_TIMEOUT_S seconds (default 600); a stuck one is killed and counts as failed.
TEST_TIMEOUT_S=${TEST_TIMEOUT_S:-600}
# limited <log> <script> [args...]: run one test with the time limit; returns its exit code (143 if killed)
limited() {
  local log=$1; shift
  node "$@" > "$log" 2>&1 &
  local pid=$!
  ( sleep $TEST_TIMEOUT_S && kill $pid 2>/dev/null && echo "Timeout: killed after ${TEST_TIMEOUT_S}s" >> "$log" ) &
  local watchdog=$!
  wait $pid
  local rc=$?
  kill $watchdog 2>/dev/null; wait $watchdog 2>/dev/null
  return $rc
}
# run <log-name> <script> [args...]: one test, retried once if it fails or times out
run() {
  local name=$1; shift
  limited "$O/$name.log" "$@"
  if [ $? -ne 0 ] || grep -qE '^FAIL |Timeout|pageerror|^console:' "$O/$name.log"; then
    mv "$O/$name.log" "$O/$name.try1.log"
    limited "$O/$name.log" "$@"
    echo "(retried; first try in $name.try1.log)" >> "$O/$name.log"
  fi
}
lane1() {
  run accessories accessories.mjs
  for t in light dark; do run walk-$t walk.mjs $O/shots/walk $t; done
  run narrow narrow.mjs $O/shots/narrow
  for t in light dark; do run picker-$t picker.mjs $O/shots/picker $t; done
  for p in ios android; do for t in light dark; do run rules-$p-$t walk-sharing-rules.mjs $O/shots/rules $t $p; done; done
  run reduced-motion reduced-motion.mjs
  for t in light dark; do run a11y-ios-$t walk-a11y.mjs $O/shots/a11y $t ios; done
  for t in light dark; do run r3-ios-$t walk-r3.mjs $O/shots/r3 $t ios; done
}
lane2() {
  run icons icons.mjs $O/shots/icons
  run android-light walk-android.mjs $O/shots/android light 1440
  run android-dark walk-android.mjs $O/shots/android dark 1440
  run android-820 walk-android.mjs $O/shots/android light 820
  for p in ios android; do for t in light dark; do run fixes-$p-$t walk-fixes.mjs $O/shots/fixes $t $p; done; done
  for t in light dark; do run a11y-android-$t walk-a11y.mjs $O/shots/a11y $t android; done
  for t in light dark; do run r3-android-$t walk-r3.mjs $O/shots/r3 $t android; done
}
lane1 &
lane2 &
wait
total_p=0; total_f=0
for f in $O/*.log; do
  case $f in *.try1.log) continue;; esac
  n=$(basename $f .log)
  p=$(grep -c '^PASS' $f); fl=$(grep -c '^FAIL ' $f)
  total_p=$((total_p + p)); total_f=$((total_f + fl))
  err=$(grep -E 'pageerror|^console:|requestfailed|Error|Timeout' $f | head -2 | tr '\n' ' ')
  last=$(grep -E '^no errors|retried' $f | tr '\n' ' ')
  printf "%-22s %3s PASS %2s FAIL  %s%s\n" $n $p $fl "$last" "$err"
  grep '^FAIL ' $f | sed 's/^/    /'
  grep -E '^(ios|android) home bob|^stage src|^missing or wrong|^accessory chips|^chosen tile' $f | sed 's/^/    /'
done
echo "TOTAL $total_p PASS, $total_f FAIL"
