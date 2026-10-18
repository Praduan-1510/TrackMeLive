#!/usr/bin/env python3
"""Fails on invisible and bidirectional control characters in source files ("Trojan Source").

    python3 -I code/qa/scan-unicode.py

Scans the tracked files plus the new ones git doesn't ignore, by extension (see SOURCE_EXT), and
reports every hit as path:line:column, with the code point and its name. Characters caught:
  bidi controls  U+202A-U+202E, U+2066-U+2069, U+200E, U+200F, U+061C
  zero width     U+200B-U+200D, U+2060, and U+FEFF anywhere but as a leading byte-order mark
Write them as escapes instead (\\u200D in JS/TS/Kotlin/JSON, \\u{200D} in Swift). A file that
really needs a literal one goes in code/qa/unicode-allowlist.txt: "path U+XXXX  # why", one per
line, and the reason is required. Binary files, symlinks and font files are skipped.
Exit status: 0 clean, 1 with hits, 2 on a setup error.
"""
import os
import re
import subprocess
import sys
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ALLOWLIST = os.path.join(REPO, "code", "qa", "unicode-allowlist.txt")
SOURCE_EXT = {
    ".ts", ".tsx", ".mjs", ".cjs", ".js", ".jsx", ".swift", ".kt", ".kts", ".rules", ".sh",
    ".yml", ".yaml", ".json", ".css", ".html", ".py",
}
FONT_EXT = {".ttf", ".otf", ".woff", ".woff2", ".eot"}
BIDI = set(range(0x202A, 0x202F)) | set(range(0x2066, 0x206A)) | {0x200E, 0x200F, 0x061C}
ZERO_WIDTH = set(range(0x200B, 0x200E)) | {0x2060, 0xFEFF}
SUSPECT = re.compile("[" + "".join(re.escape(chr(c)) for c in sorted(BIDI | ZERO_WIDTH)) + "]")
MAX_PER_FILE = 5


def read_allowlist():
    allowed = set()
    if not os.path.isfile(ALLOWLIST):
        return allowed
    with open(ALLOWLIST, encoding="utf-8") as f:
        for number, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            entry, _, reason = line.partition("#")
            parts = entry.split()
            if len(parts) != 2 or not re.fullmatch(r"U\+[0-9A-Fa-f]{4,6}", parts[1]) or not reason.strip():
                raise SystemExit(f"{ALLOWLIST}:{number}: expected 'path U+XXXX  # reason', got {line!r}")
            allowed.add((parts[0], int(parts[1][2:], 16)))
    return allowed


def candidate_files():
    out = subprocess.run(
        ["git", "-C", REPO, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        check=True, capture_output=True,
    ).stdout.decode("utf-8", "surrogateescape")
    for rel in sorted({p for p in out.split("\0") if p}):
        ext = os.path.splitext(rel)[1].lower()
        if ext in SOURCE_EXT and ext not in FONT_EXT:
            yield rel


def main():
    allowed = read_allowlist()
    files = hits = bad_files = 0
    for rel in candidate_files():
        path = os.path.join(REPO, rel)
        if os.path.islink(path) or not os.path.isfile(path):
            continue
        data = open(path, "rb").read()
        if b"\0" in data[:8192]:
            continue
        files += 1
        text = data.decode("utf-8", "replace")
        found = []
        for number, line in enumerate(text.split("\n"), 1):
            for match in SUSPECT.finditer(line):
                code = ord(match.group())
                if code == 0xFEFF and number == 1 and match.start() == 0:
                    continue  # A leading byte-order mark; the style check rules on those.
                if (rel, code) in allowed:
                    continue
                kind = "bidi control" if code in BIDI else "zero-width character"
                name = unicodedata.name(chr(code), "?")
                found.append(f"{rel}:{number}:{match.start() + 1}: {kind} U+{code:04X} {name}")
        if found:
            bad_files += 1
            hits += len(found)
            for line in found[:MAX_PER_FILE]:
                print(line)
            if len(found) > MAX_PER_FILE:
                print(f"{rel}: ...and {len(found) - MAX_PER_FILE} more")
    if hits:
        print(f"scan-unicode: {hits} invisible or bidi character(s) in {bad_files} of {files} source files. "
              "Write them as escapes (\\u200D, or \\u{200D} in Swift), or allow-list with a reason in "
              "code/qa/unicode-allowlist.txt.")
        return 1
    print(f"scan-unicode: {files} source files, no invisible or bidi control characters")
    return 0


if __name__ == "__main__":
    sys.exit(main())
