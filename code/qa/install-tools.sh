#!/usr/bin/env bash
# Installs the linters the gate uses, pinned and checksum-verified, into a user cache (never into
# the repo): actionlint 1.7.12 (published 2026-03-30), which lints .github/workflows, and
# ShellCheck 0.11.0 (2025-08-04), which actionlint also runs on each workflow `run:` script.
#
#   code/qa/install-tools.sh              install both; does nothing when they're already there
#   code/qa/install-tools.sh --path NAME  print the installed path of NAME (actionlint or shellcheck),
#                                         or exit 1 if it isn't installed; never downloads
#
# Cache folder: $TML_QA_TOOLS, else ${XDG_CACHE_HOME:-$HOME/.cache}/tml-qa. The SHA-256 of each
# release asset is the digest GitHub publishes for it. Builds: macOS arm64 and x86_64, Linux x86_64.
set -euo pipefail

TOOLS="${TML_QA_TOOLS:-${XDG_CACHE_HOME:-${HOME}/.cache}/tml-qa}"
ACTIONLINT_VERSION="1.7.12"
SHELLCHECK_VERSION="0.11.0"

platform="$(uname -s)-$(uname -m)"
case "${platform}" in
  Darwin-arm64)
    actionlint_asset="actionlint_${ACTIONLINT_VERSION}_darwin_arm64.tar.gz"
    actionlint_sha="aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f"
    shellcheck_asset="shellcheck-v${SHELLCHECK_VERSION}.darwin.aarch64.tar.gz"
    shellcheck_sha="339b930feb1ea764467013cc1f72d09cd6b869ebf1013296ba9055ab2ffbd26f"
    ;;
  Darwin-x86_64)
    actionlint_asset="actionlint_${ACTIONLINT_VERSION}_darwin_amd64.tar.gz"
    actionlint_sha="5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644"
    shellcheck_asset="shellcheck-v${SHELLCHECK_VERSION}.darwin.x86_64.tar.gz"
    shellcheck_sha="c2c15e08df0e8fbc374c335b230a7ee958c313fa5714817a59aa59f1aa594f51"
    ;;
  Linux-x86_64)
    actionlint_asset="actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz"
    actionlint_sha="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    shellcheck_asset="shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.gz"
    shellcheck_sha="b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6"
    ;;
  *)
    echo "install-tools: no pinned actionlint/ShellCheck build for ${platform}" >&2
    exit 1
    ;;
esac
actionlint_bin="${TOOLS}/actionlint-${ACTIONLINT_VERSION}/actionlint"
shellcheck_bin="${TOOLS}/shellcheck-${SHELLCHECK_VERSION}/shellcheck"

if [[ "${1:-}" == --path ]]; then
  case "${2:-}" in
    actionlint) bin="${actionlint_bin}" ;;
    shellcheck) bin="${shellcheck_bin}" ;;
    *) echo "usage: $0 --path actionlint|shellcheck" >&2; exit 2 ;;
  esac
  [[ -x "${bin}" ]] || exit 1
  printf '%s\n' "${bin}"
  exit 0
elif [[ $# -gt 0 ]]; then
  echo "usage: $0 [--path actionlint|shellcheck]" >&2
  exit 2
fi

sha256() { if command -v sha256sum > /dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | awk '{ print $1 }'; }

# fetch_tool <url> <sha256> <member path in the archive> <destination binary>
fetch_tool() {
  local url="$1" sha="$2" member="$3" dest="$4" tmp free_kb
  if [[ -x "${dest}" ]]; then
    echo "install-tools: ${dest} is already installed"
    return 0
  fi
  # Never let a download take the disk below 6 GB free.
  free_kb="$(df -Pk "${HOME}" | awk 'NR == 2 { print $4 }')"
  if (( free_kb < 6 * 1024 * 1024 + 50 * 1024 )); then
    echo "install-tools: less than 6 GB would be left free; not downloading ${url##*/}" >&2
    return 1
  fi
  tmp="$(mktemp -d)"
  # The archive is untrusted until its checksum matches: download and unpack it in a fresh folder.
  curl -fsSL --retry 3 -o "${tmp}/archive.tar.gz" "${url}"
  if [[ "$(sha256 "${tmp}/archive.tar.gz")" != "${sha}" ]]; then
    echo "install-tools: checksum mismatch for ${url}; not installing it" >&2
    rm -rf "${tmp}"
    return 1
  fi
  mkdir "${tmp}/unpacked"
  tar -xzf "${tmp}/archive.tar.gz" -C "${tmp}/unpacked" "${member}"
  mkdir -p "$(dirname "${dest}")"
  mv "${tmp}/unpacked/${member}" "${dest}"
  chmod 755 "${dest}"
  rm -rf "${tmp}"
  echo "install-tools: installed ${dest} (SHA-256 verified)"
}

fetch_tool "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/${actionlint_asset}" \
  "${actionlint_sha}" "actionlint" "${actionlint_bin}"
fetch_tool "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/${shellcheck_asset}" \
  "${shellcheck_sha}" "shellcheck-v${SHELLCHECK_VERSION}/shellcheck" "${shellcheck_bin}"
