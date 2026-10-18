#!/bin/bash
# Exports the design system's assets into the iOS asset catalogs. The design system stays the
# source of truth: re-run this after a mascot render, a flat SVG or an app icon changes.
#
#   design-system/assets/Mascots/<id>.png  (512px renders)  -> app + widget catalogs, "mascot-<id>"
#   design-system/assets/Mascots/<id>.svg  (flat, 96pt box)  -> app + widget catalogs, "mascot-<id>-flat"
#   Mascots/colors/<id>-<color>.png                           -> app catalog, "mascot-<id>-<color>"
#   Mascots/accessories/<id>-<accessory>.png                  -> app catalog, "accessory-<id>-<accessory>"
#   every render and accessory layer, again at avatar size    -> app catalog, "avatar-<id>[-<color>]",
#                                                                "avatar-accessory-<id>-<accessory>"
#   brand/logo/mark.svg                                       -> app catalog, "brand-mark" (vector)
#   brand/logo/app-icon-{default,dark,tinted}.svg             -> AppIcon (1024px PNGs, via Chrome)
#
# Sizes (design-system README, "Asset pipeline"). The Original renders stay the 512px masters,
# since onboarding draws the fox up to 250pt. Color renders and accessory layers are exported for
# the largest place they're drawn, the picker's 152pt stage, at 2x and 3x (304 and 456px). The
# avatar set is 40pt at 2x and 3x (80 and 120px) for markers, rows and the glass bar. iPhones on
# iOS 26 are all 2x or 3x, so there's no 1x, and app thinning installs one scale per device.
# Every image is downscaled from its master with sips, never upscaled. The flat SVGs are the last
# fallback in the app (TMLCore MascotAssets) and the 20pt-and-below art in the widget.
# The names and sizes live in TMLCore's MascotAssets; TMLCore's tests check this script's output
# against them.
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
COLORS=(moss lagoon dusk rose)
ACCESSORIES=(headphones glasses headlamp)
STAGE_PT=152
AVATAR_PT=40

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

folder() { # <dir>: an asset catalog folder (no namespace), emptied first
  rm -rf "$1"; mkdir -p "$1"
  printf '{\n  %s\n}\n' "$INFO" > "$1/Contents.json"
}

scaled_set() { # <dir> <name> <src.png> <points>: the 2x and 3x images for a point size
  local dir="$1/$2.imageset" px want
  mkdir -p "$dir"
  for scale in 2 3; do
    want=$(( $4 * scale ))
    px=$(sips -g pixelWidth "$3" | awk '/pixelWidth/ {print $2}')
    (( px >= want )) || { echo "error: $3 is ${px}px, too small for ${4}pt at ${scale}x" >&2; exit 1; }
    sips -Z "$want" "$3" --out "$dir/$2@${scale}x.png" >/dev/null
    px=$(sips -g pixelWidth "$dir/$2@${scale}x.png" | awk '/pixelWidth/ {print $2}')
    [[ "$px" == "$want" ]] || { echo "error: $2@${scale}x.png is ${px}px, expected $want" >&2; exit 1; }
  done
  cat > "$dir/Contents.json" <<JSON
{
  "images" : [
    { "filename" : "$2@2x.png", "idiom" : "universal", "scale" : "2x" },
    { "filename" : "$2@3x.png", "idiom" : "universal", "scale" : "3x" }
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
  svg_set "$APP_CAT" "mascot-$id-flat" "$MASCOTS/$id.svg"
  svg_set "$WID_CAT" "mascot-$id-flat" "$MASCOTS/$id.svg"
done

# Colors, accessories and avatars, each in a folder named for its design-system asset group.
COLOR_DIR="$APP_CAT/Mascot colors"
ACC_DIR="$APP_CAT/Mascot accessories"
AVATAR_DIR="$APP_CAT/Mascot avatars"
folder "$COLOR_DIR"; folder "$ACC_DIR"; folder "$AVATAR_DIR"
layers=0
for id in "${IDS[@]}"; do
  scaled_set "$AVATAR_DIR" "avatar-$id" "$MASCOTS/$id.png" "$AVATAR_PT"
  for color in "${COLORS[@]}"; do
    src="$MASCOTS/colors/$id-$color.png"
    [[ -f "$src" ]] || { echo "error: missing $src" >&2; exit 1; }
    scaled_set "$COLOR_DIR" "mascot-$id-$color" "$src" "$STAGE_PT"
    scaled_set "$AVATAR_DIR" "avatar-$id-$color" "$src" "$AVATAR_PT"
  done
  # Each character ships layers only for the accessories it takes (mascots/model/accessories.mjs).
  for acc in "${ACCESSORIES[@]}"; do
    src="$MASCOTS/accessories/$id-$acc.png"
    [[ -f "$src" ]] || continue
    scaled_set "$ACC_DIR" "accessory-$id-$acc" "$src" "$STAGE_PT"
    scaled_set "$AVATAR_DIR" "avatar-accessory-$id-$acc" "$src" "$AVATAR_PT"
    layers=$((layers + 1))
  done
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
echo "Exported ${#IDS[@]} mascot renders, $(( ${#IDS[@]} * ${#COLORS[@]} )) color renders, $layers accessory layers," \
  "their avatars, ${#IDS[@]} flat mascots, the brand mark and the launch color."

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
