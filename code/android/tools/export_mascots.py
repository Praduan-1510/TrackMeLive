#!/usr/bin/env python3
"""Export the mascot art from design-system/assets/Mascots into the Android app.

    python3 code/android/tools/export_mascots.py           # write the resources and the Kotlin table
    python3 code/android/tools/export_mascots.py --check   # exit 1 if anything is missing or stale

What it writes (all generated; never edit by hand):
  app/src/main/res/drawable-nodpi/mascot_<id>.webp              the Original render (512 px)
  app/src/main/res/drawable-nodpi/mascot_<id>_<color>.webp      each other color's render
  app/src/main/res/drawable-nodpi/mascot_<id>_acc_<acc>.webp    accessory layers, same camera and box
  app/src/main/res/drawable/mascot_flat_<id>.xml                the flat SVG head as a vector drawable
  app/src/main/java/live/trackme/app/ui/mascot/MascotArtTable.kt  MascotId x MascotColor -> R.drawable

The renders are lossy WebP at quality 90 with lossless alpha (Android decodes WebP with alpha from
API 18; minSdk is 29). At 512 px that is visually identical to the PNG masters and about a tenth of
their size. The app decodes each one at the size it is drawn (ui/mascot/MascotArt.kt), so the same
512 px file serves the picker (160dp stage), avatars (32dp) and markers (40dp) without wasting memory.

Needs Pillow with WebP support (python3 -m pip install --user Pillow).
"""
from __future__ import annotations

import io
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SRC = os.path.join(ROOT, 'design-system', 'assets', 'Mascots')
APP = os.path.join(ROOT, 'code', 'android', 'app', 'src', 'main')
NODPI = os.path.join(APP, 'res', 'drawable-nodpi')
DRAWABLE = os.path.join(APP, 'res', 'drawable')
TABLE = os.path.join(APP, 'java', 'live', 'trackme', 'app', 'ui', 'mascot', 'MascotArtTable.kt')

# The same order as MascotId, MascotColor and MascotAccessory in code/shared/schema.
MASCOTS = ['fox', 'ghost', 'robot', 'astronaut', 'hero', 'star', 'ninja', 'neko',
           'ace', 'detective', 'cowboy', 'agent']
COLORS = ['original', 'moss', 'lagoon', 'dusk', 'rose']
ACCESSORIES = ['headphones', 'glasses', 'headlamp']
# mascots/model/accessories.mjs ACCESSORY_SUPPORT, checked against the file below.
SUPPORT = {
    'fox': ['headphones', 'glasses', 'headlamp'], 'ghost': ['headphones', 'glasses', 'headlamp'],
    'robot': ['headlamp'], 'astronaut': [], 'hero': ['glasses'],
    'star': ['headphones', 'glasses', 'headlamp'], 'ninja': ['headphones'], 'neko': ['glasses', 'headlamp'],
    'ace': ['headphones', 'headlamp'], 'detective': ['glasses'], 'cowboy': ['glasses'],
    'agent': ['headphones', 'glasses', 'headlamp'],
}
WEBP = dict(format='WEBP', quality=90, alpha_quality=100, method=6, exact=False)


def check_support_table() -> None:
    js = open(os.path.join(ROOT, 'mascots', 'model', 'accessories.mjs'), encoding='utf-8').read()
    block = re.search(r'ACCESSORY_SUPPORT\s*=\s*\{(.*?)\};', js, re.S).group(1)
    found = {m: re.findall(r"'(\w+)'", accs) for m, accs in re.findall(r'(\w+):\s*\[([^\]]*)\]', block)}
    if found != SUPPORT:
        sys.exit(f'export_mascots: SUPPORT differs from mascots/model/accessories.mjs: {found}')


def webp_bytes(png_path: str) -> bytes:
    from PIL import Image  # imported here so --help works without Pillow
    with Image.open(png_path) as im:
        if im.size != (512, 512):
            sys.exit(f'export_mascots: {png_path} is {im.size}, expected 512 by 512')
        buf = io.BytesIO()
        im.convert('RGBA').save(buf, **WEBP)
        return buf.getvalue()


# ---------- Flat SVG -> VectorDrawable ----------

def _num(v: str) -> str:
    f = float(v)
    return str(int(f)) if f.is_integer() else repr(round(f, 3))


def _rect_path(x, y, w, h, rx, ry) -> str:
    if rx == 0 and ry == 0:
        return f'M{_num(x)},{_num(y)}h{_num(w)}v{_num(h)}h{_num(-w)}Z'
    rx, ry = min(rx, w / 2), min(ry, h / 2)
    return (f'M{_num(x + rx)},{_num(y)}H{_num(x + w - rx)}A{_num(rx)},{_num(ry)} 0 0 1 {_num(x + w)},{_num(y + ry)}'
            f'V{_num(y + h - ry)}A{_num(rx)},{_num(ry)} 0 0 1 {_num(x + w - rx)},{_num(y + h)}'
            f'H{_num(x + rx)}A{_num(rx)},{_num(ry)} 0 0 1 {_num(x)},{_num(y + h - ry)}'
            f'V{_num(y + ry)}A{_num(rx)},{_num(ry)} 0 0 1 {_num(x + rx)},{_num(y)}Z')


def _ellipse_path(cx, cy, rx, ry) -> str:
    return (f'M{_num(cx - rx)},{_num(cy)}A{_num(rx)},{_num(ry)} 0 1 0 {_num(cx + rx)},{_num(cy)}'
            f'A{_num(rx)},{_num(ry)} 0 1 0 {_num(cx - rx)},{_num(cy)}Z')


def _color(value: str | None) -> str | None:
    if value is None or value == 'none':
        return None
    if not re.fullmatch(r'#[0-9A-Fa-f]{6}', value):
        sys.exit(f'export_mascots: unsupported color {value!r}')
    return value.upper()


def svg_to_vector(svg_path: str, mascot: str) -> str:
    ns = {'s': 'http://www.w3.org/2000/svg'}
    tree = ET.parse(svg_path).getroot()
    if tree.get('viewBox') != '0 0 96 96':
        sys.exit(f'export_mascots: {svg_path} must have viewBox 0 0 96 96')
    out = []
    for el in tree:
        tag = el.tag.split('}')[-1]
        if tag == 'title':
            continue
        f = lambda k, d='0': float(el.get(k, d))  # noqa: E731
        if tag == 'path':
            d = el.get('d')
        elif tag == 'circle':
            d = _ellipse_path(f('cx'), f('cy'), f('r'), f('r'))
        elif tag == 'ellipse':
            d = _ellipse_path(f('cx'), f('cy'), f('rx'), f('ry'))
        elif tag == 'rect':
            rx = f('rx', el.get('ry', '0'))
            ry = f('ry', el.get('rx', '0'))
            d = _rect_path(f('x'), f('y'), f('width'), f('height'), rx, ry)
        else:
            sys.exit(f'export_mascots: unsupported SVG element <{tag}> in {svg_path}')
        attrs = [f'android:pathData="{d}"']
        fill = _color(el.get('fill', '#000000'))
        if fill:
            attrs.append(f'android:fillColor="{fill}"')
            if el.get('fill-opacity'):
                attrs.append(f'android:fillAlpha="{_num(el.get("fill-opacity"))}"')
        stroke = _color(el.get('stroke'))
        if stroke:
            attrs.append(f'android:strokeColor="{stroke}"')
            attrs.append(f'android:strokeWidth="{_num(el.get("stroke-width", "1"))}"')
            if el.get('stroke-opacity'):
                attrs.append(f'android:strokeAlpha="{_num(el.get("stroke-opacity"))}"')
            cap = el.get('stroke-linecap')
            if cap:
                attrs.append(f'android:strokeLineCap="{cap}"')
        path = '<path ' + ' '.join(attrs) + ' />'
        transform = el.get('transform')
        if transform:
            m = re.fullmatch(r'rotate\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)', transform)
            if not m:
                sys.exit(f'export_mascots: unsupported transform {transform!r} in {svg_path}')
            angle, px, py = m.groups()
            path = (f'<group android:rotation="{_num(angle)}" android:pivotX="{_num(px)}" '
                    f'android:pivotY="{_num(py)}">\n        {path}\n    </group>')
        out.append('    ' + path)
    body = '\n'.join(out)
    return ('<?xml version="1.0" encoding="utf-8"?>\n'
            f'<!-- Generated by code/android/tools/export_mascots.py from design-system/assets/Mascots/{mascot}.svg.\n'
            '     The flat head, for 20dp and below and as the fallback when a render can\'t load. -->\n'
            '<vector xmlns:android="http://schemas.android.com/apk/res/android"\n'
            '    android:width="96dp"\n    android:height="96dp"\n'
            '    android:viewportWidth="96"\n    android:viewportHeight="96">\n'
            f'{body}\n</vector>\n')


# ---------- Kotlin table ----------

def kotlin_table() -> str:
    E = lambda s: s.upper()  # noqa: E731
    lines = [
        '// Generated by code/android/tools/export_mascots.py from design-system/assets/Mascots. Do not edit by hand.',
        'package live.trackme.app.ui.mascot',
        '',
        'import androidx.annotation.DrawableRes',
        'import live.trackme.app.R',
        'import live.trackme.schema.MascotAccessory',
        'import live.trackme.schema.MascotColor',
        'import live.trackme.schema.MascotId',
        '',
        '/** Where each mascot\'s art lives in the app\'s resources. */',
        'internal object MascotArtTable {',
        '    /** The 512 px render of [id] in [color] (Original is the base render). */',
        '    @DrawableRes',
        '    fun render(id: MascotId, color: MascotColor): Int = when (id) {',
    ]
    for m in MASCOTS:
        lines.append(f'        MascotId.{E(m)} -> when (color) {{')
        for c in COLORS:
            res = f'mascot_{m}' if c == 'original' else f'mascot_{m}_{c}'
            lines.append(f'            MascotColor.{E(c)} -> R.drawable.{res}')
        lines.append('        }')
    lines += [
        '    }',
        '',
        '    /** The accessory layer for [id], or null when [id] doesn\'t take [accessory]. */',
        '    @DrawableRes',
        '    fun accessory(id: MascotId, accessory: MascotAccessory): Int? = when (id) {',
    ]
    for m in MASCOTS:
        accs = SUPPORT[m]
        if not accs:
            lines.append(f'        MascotId.{E(m)} -> null')
            continue
        lines.append(f'        MascotId.{E(m)} -> when (accessory) {{')
        for a in ACCESSORIES:
            lines.append(f'            MascotAccessory.{E(a)} -> ' + (f'R.drawable.mascot_{m}_acc_{a}' if a in accs else 'null'))
        lines.append('        }')
    lines += [
        '    }',
        '',
        '    /** The flat head, a vector drawable. */',
        '    @DrawableRes',
        '    fun flat(id: MascotId): Int = when (id) {',
    ]
    for m in MASCOTS:
        lines.append(f'        MascotId.{E(m)} -> R.drawable.mascot_flat_{m}')
    lines += ['    }', '}', '']
    return '\n'.join(lines)


def outputs(encode: bool) -> dict[str, bytes | None]:
    """Every generated file and its bytes. Without [encode], renders map to None (only checked to exist)."""
    files: dict[str, bytes | None] = {}
    render = (lambda png: webp_bytes(png)) if encode else (lambda png: None)  # noqa: E731
    for m in MASCOTS:
        files[os.path.join(NODPI, f'mascot_{m}.webp')] = render(os.path.join(SRC, f'{m}.png'))
        for c in COLORS[1:]:
            files[os.path.join(NODPI, f'mascot_{m}_{c}.webp')] = render(os.path.join(SRC, 'colors', f'{m}-{c}.png'))
        for a in SUPPORT[m]:
            files[os.path.join(NODPI, f'mascot_{m}_acc_{a}.webp')] = render(os.path.join(SRC, 'accessories', f'{m}-{a}.png'))
        files[os.path.join(DRAWABLE, f'mascot_flat_{m}.xml')] = svg_to_vector(os.path.join(SRC, f'{m}.svg'), m).encode()
    files[TABLE] = kotlin_table().encode()
    return files


def main() -> None:
    check = '--check' in sys.argv[1:]
    check_support_table()
    # libwebp versions can differ in the exact bytes they write, so --check only asks that every render
    # exists; the vectors and the Kotlin table must match exactly.
    files = outputs(encode=not check)
    stale = []
    for path, data in files.items():
        current = open(path, 'rb').read() if os.path.exists(path) else None
        if current == data or (data is None and current is not None):
            continue
        if check:
            stale.append(os.path.relpath(path, ROOT))
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as fh:
                fh.write(data)
    # Anything named like our output but not produced (a removed mascot or color) is stale too.
    produced = {os.path.basename(p) for p in files}
    for folder, pattern in ((NODPI, r'mascot_.*\.(webp|png)$'), (DRAWABLE, r'mascot_flat_.*\.xml$')):
        for name in sorted(os.listdir(folder)):
            if re.match(pattern, name) and name not in produced:
                stale.append(os.path.relpath(os.path.join(folder, name), ROOT))
    if stale:
        print('export_mascots: stale or unexpected files:\n  ' + '\n  '.join(stale))
        sys.exit(1 if check else 2)
    total = sum(os.path.getsize(p) for p in files if p.endswith('.webp'))
    print(f'export_mascots: {len(files)} files {"checked" if check else "written"}; renders {total / 1024:.0f} KiB')


if __name__ == '__main__':
    main()
