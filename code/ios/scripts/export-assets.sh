#!/bin/bash
# Exports the design system's assets into the iOS asset catalogs. The design system stays the
# source of truth: re-run this after a mascot render, a flat SVG or an app icon changes.
#
#   design-system/assets/Mascots/<id>.png  (512px renders)  -> app + widget catalogs, "mascot-<id>"
#   design-system/assets/Mascots/<id>.svg  (flat, 96pt box)  -> widget catalog, "mascot-<id>-flat"
#   brand/logo/mark.svg                                       -> app catalog, "brand-mark" (vector)
#   brand/logo/app-icon-{default,dark,tinted}.svg             -> AppIcon (1024px PNGs, via Chrome)
#
# The design system README: ship 512px renders only for onboarding and the picker; use the flat
# SVGs at 20pt and below (the compact Live Activity). Marker and avatar exports at 40/32pt come
# later with the map.
#
# Usage: scripts/export-assets.sh [--skip-icons]
set -euo pipefail

IOS_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$IOS_DIR/../.." && pwd)"
MASCOTS="$REPO/design-system/assets/Mascots"
LOGO="$REPO/brand/logo"
APP_CAT="$IOS_DIR/TrackMeLive/Resources/Assets.xcassets"
WID_CAT="$IOS_DIR/TrackMeLiveWidgets/Assets.xcassets"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
IDS=(fox ghost robot astronaut hero star ninja neko ace detective cowboy agent)

INFO='"info" : { "author" : "xcode", "version" : 1 }'

catalog_root() { # <catalog>
  mkdir -p "$1"
  printf '{\n  %s\n}\n' "$INFO" > "$1/Contents.json"
}

png_set() { # <catalog> <name> <src.png>
  local dir="$1/$2.imageset"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$3" "$dir/$2.png"
  cat > "$dir/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "$2.png", "idiom" : "universal", "scale" : "2x" }
  ],
  $INFO
}
JSON
}

svg_set() { # <catalog> <name> <src.svg>
  local dir="$1/$2.imageset"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$3" "$dir/$2.svg"
  cat > "$dir/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "$2.svg", "idiom" : "universal" }
  ],
  $INFO,
  "properties" : { "preserves-vector-representation" : true }
}
JSON
}

catalog_root "$APP_CAT"
catalog_root "$WID_CAT"

for id in "${IDS[@]}"; do
  png_set "$APP_CAT" "mascot-$id" "$MASCOTS/$id.png"
  png_set "$WID_CAT" "mascot-$id" "$MASCOTS/$id.png"
  svg_set "$WID_CAT" "mascot-$id-flat" "$MASCOTS/$id.svg"
done
# The Callout mark, with mark-on-dark.svg for dark appearance (onboarding's "Private by default").
dir="$APP_CAT/brand-mark.imageset"
rm -rf "$dir"; mkdir -p "$dir"
cp "$LOGO/mark.svg" "$dir/brand-mark.svg"
cp "$LOGO/mark-on-dark.svg" "$dir/brand-mark-dark.svg"
cat > "$dir/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "brand-mark.svg", "idiom" : "universal" },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "filename" : "brand-mark-dark.svg", "idiom" : "universal"
    }
  ],
  $INFO,
  "properties" : { "preserves-vector-representation" : true }
}
JSON

# The launch screen's background (Info.plist UILaunchScreen → UIColorName) is the `ground` token,
# light and dark, read from tokens.json so it never drifts.
python3 -I - "$REPO/design-system/tokens.json" "$APP_CAT/LaunchBackground.colorset" <<'PY'
import json, os, sys
tokens, out = sys.argv[1], sys.argv[2]
ground = next(t for t in json.load(open(tokens))["color"]["tokens"] if t["name"] == "ground")["value"]
def comp(hexv):
    h = hexv.lstrip("#")
    return {"red": f"0x{h[0:2]}", "green": f"0x{h[2:4]}", "blue": f"0x{h[4:6]}", "alpha": "1.000"}
def entry(hexv, dark=False):
    e = {"color": {"color-space": "srgb", "components": comp(hexv)}, "idiom": "universal"}
    if dark:
        e["appearances"] = [{"appearance": "luminosity", "value": "dark"}]
    return e
os.makedirs(out, exist_ok=True)
with open(os.path.join(out, "Contents.json"), "w") as f:
    json.dump({"colors": [entry(ground["light"]), entry(ground["dark"], True)],
               "info": {"author": "xcode", "version": 1}}, f, indent=2)
    f.write("\n")
PY
echo "Exported ${#IDS[@]} mascot renders, ${#IDS[@]} flat mascots, the brand mark and the launch color."

if [[ "${1:-}" == "--skip-icons" ]]; then exit 0; fi

# App icon: Chrome draws each 1024px SVG, full bleed. The asset catalog takes one 1024px image per
# appearance (any, dark, tinted); Xcode makes the smaller sizes.
ICON="$APP_CAT/AppIcon.appiconset"
if [[ ! -x "$CHROME" ]]; then
  if [[ -f "$ICON/icon-1024.png" ]]; then
    echo "Google Chrome not found; keeping the existing app icon PNGs."
    exit 0
  fi
  echo "error: Google Chrome is needed once to rasterize the app icon SVGs." >&2
  exit 1
fi
mkdir -p "$ICON"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for v in default dark tinted; do
  out="icon-1024.png"; [[ $v != default ]] && out="icon-1024-$v.png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=1024,1024 --user-data-dir="$tmp/profile" \
    --screenshot="$ICON/$out" "file://$LOGO/app-icon-$v.svg" >/dev/null 2>&1
  w=$(sips -g pixelWidth "$ICON/$out" | awk '/pixelWidth/ {print $2}')
  [[ "$w" == 1024 ]] || { echo "error: $out is ${w}px wide, expected 1024" >&2; exit 1; }
done
cat > "$ICON/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "icon-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "dark" } ],
      "filename" : "icon-1024-dark.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024"
    },
    {
      "appearances" : [ { "appearance" : "luminosity", "value" : "tinted" } ],
      "filename" : "icon-1024-tinted.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024"
    }
  ],
  $INFO
}
JSON
echo "Rasterized the app icon (default, dark, tinted)."
