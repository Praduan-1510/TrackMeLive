#!/usr/bin/env python3
"""Checks files against the whitespace rules in the repo's root .editorconfig.

    python3 -I code/qa/check-style.py [path ...]      (default: code/ .github/ and the root config files)

It reads .editorconfig itself, so the rules live in one place, and checks the tracked files plus
the new ones git doesn't ignore. The properties it enforces: charset (utf-8: valid UTF-8 without a
BOM), end_of_line (lf or crlf), insert_final_newline (true), trim_trailing_whitespace (true) and
indent_style (space: no tab in a line's indent; tab: no line indented with spaces). Indent width
and line length are left to each codebase's formatter. Binary files and symlinks are skipped.
One rule isn't from .editorconfig: in .sh files, no bare $NAME directly before a non-ASCII byte.
Exit status: 0 clean, 1 with findings, 2 on a usage or setup error.
"""
import os
import re
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_SCOPE = ["code/", ".github/", ".editorconfig", ".gitignore"]
MAX_BYTES = 4 * 1024 * 1024
MAX_PER_FILE = 3
# In shell scripts, "$NAME…" breaks under macOS's bash 3.2 in a UTF-8 locale (as on CI): bash reads
# the character's first byte as part of the name, and under set -u dies on an unbound variable.
BARE_VAR_BEFORE_NON_ASCII = re.compile(rb"\$[A-Za-z_][A-Za-z0-9_]*[\x80-\xff]")
BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".icns", ".pdf", ".ttf", ".otf", ".woff",
    ".woff2", ".jar", ".zip", ".gz", ".xz", ".apk", ".aab", ".keystore", ".jks", ".mp4", ".mov",
}


def translate(glob):
    """An EditorConfig glob as a regular expression: *, **, ?, [seq], [!seq] and {a,b}."""
    out, i, depth = [], 0, 0
    while i < len(glob):
        c = glob[i]
        if c == "*":
            if glob.startswith("**", i):
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        elif c == "[":
            end = glob.find("]", i + 1)
            if end == -1:
                out.append(re.escape(c))
            else:
                body = glob[i + 1:end]
                if body.startswith("!"):
                    body = "^" + body[1:]
                out.append("[" + body.replace("\\", "\\\\") + "]")
                i = end + 1
                continue
        elif c == "{":
            out.append("(?:")
            depth += 1
        elif c == "}" and depth:
            out.append(")")
            depth -= 1
        elif c == "," and depth:
            out.append("|")
        else:
            out.append(re.escape(c))
        i += 1
    return "".join(out)


def section_matcher(glob):
    # A glob with no slash matches a file name in any folder; one with a slash is relative to
    # the folder of .editorconfig.
    if "/" in glob:
        pattern = translate(glob.lstrip("/"))
    else:
        pattern = "(?:.*/)?" + translate(glob)
    return re.compile(pattern + r"\Z")


def read_editorconfig(path):
    sections, current = [], None
    with open(path, encoding="utf-8") as f:
        for number, raw in enumerate(f, 1):
            line = raw.strip()
            if not line or line[0] in "#;":
                continue
            if line.startswith("[") and line.endswith("]"):
                current = (section_matcher(line[1:-1]), {})
                sections.append(current)
            elif "=" in line:
                key, value = (part.strip() for part in line.split("=", 1))
                if current is not None:
                    current[1][key.lower()] = value.lower()
            else:
                raise SystemExit(f"{path}:{number}: can't parse {line!r}")
    return sections


def properties(sections, rel):
    props = {}
    for matcher, values in sections:
        if matcher.match(rel):
            props.update(values)
    return {k: v for k, v in props.items() if v != "unset"}


def candidate_files(scope):
    out = subprocess.run(
        ["git", "-C", REPO, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", *scope],
        check=True, capture_output=True,
    ).stdout.decode("utf-8", "surrogateescape")
    return sorted({p for p in out.split("\0") if p})


def check(rel, props):
    path = os.path.join(REPO, rel)
    if os.path.islink(path) or not os.path.isfile(path):
        return []
    if os.path.splitext(rel)[1].lower() in BINARY_EXT or os.path.getsize(path) > MAX_BYTES:
        return []
    data = open(path, "rb").read()
    if b"\0" in data[:8192]:
        return []
    problems = []
    if props.get("charset") == "utf-8":
        if data.startswith(b"\xef\xbb\xbf"):
            problems.append((1, "starts with a byte-order mark (charset = utf-8)"))
        try:
            data.decode("utf-8")
        except UnicodeDecodeError as e:
            problems.append((data.count(b"\n", 0, e.start) + 1, "isn't valid UTF-8"))
    eol = props.get("end_of_line")
    if eol == "lf" and b"\r" in data:
        problems.append((data.count(b"\n", 0, data.index(b"\r")) + 1, "has CR line endings (end_of_line = lf)"))
    if eol == "crlf" and re.search(rb"(?<!\r)\n", data):
        problems.append((1, "has LF line endings (end_of_line = crlf)"))
    if props.get("insert_final_newline") == "true" and data and not data.endswith(b"\n"):
        problems.append((data.count(b"\n") + 1, "has no newline at the end (insert_final_newline = true)"))
    lines = data.split(b"\n")
    trim = props.get("trim_trailing_whitespace") == "true"
    style = props.get("indent_style")
    for number, line in enumerate(lines, 1):
        line = line.rstrip(b"\r")
        if trim and line != line.rstrip(b" \t"):
            problems.append((number, "trailing whitespace (trim_trailing_whitespace = true)"))
        indent = line[: len(line) - len(line.lstrip(b" \t"))]
        if indent and indent != line:
            if style == "space" and b"\t" in indent:
                problems.append((number, "indented with a tab (indent_style = space)"))
            elif style == "tab" and indent.startswith(b" "):
                problems.append((number, "indented with spaces (indent_style = tab)"))
        if rel.endswith(".sh") and BARE_VAR_BEFORE_NON_ASCII.search(line):
            problems.append((number, "a bare $NAME right before a non-ASCII character: write ${NAME}"))
    return problems


def main(argv):
    config = os.path.join(REPO, ".editorconfig")
    if not os.path.isfile(config):
        print(f"check-style: {config} not found", file=sys.stderr)
        return 2
    sections = read_editorconfig(config)
    scope = argv or DEFAULT_SCOPE
    files = candidate_files(scope)
    bad = 0
    for rel in files:
        problems = check(rel, properties(sections, rel))
        if not problems:
            continue
        bad += 1
        for number, message in problems[:MAX_PER_FILE]:
            print(f"{rel}:{number}: {message}")
        if len(problems) > MAX_PER_FILE:
            print(f"{rel}: ...and {len(problems) - MAX_PER_FILE} more")
    print(f"check-style: {len(files)} files checked against .editorconfig, {bad} with problems")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
