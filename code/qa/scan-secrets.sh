#!/usr/bin/env bash
# Scans the tracked files and the new files git doesn't ignore for secrets: credential files by
# name (GoogleService-Info.plist, google-services.json, .env files, keystores, signing keys,
# service-account JSON) and key material by content (private key blocks, Google, AWS, GitHub,
# Slack, Stripe, npm, Anthropic and OpenAI tokens, JWTs, signing passwords).
#
#   code/qa/scan-secrets.sh
#
# A finding that is known to be safe goes in code/qa/secrets-allowlist.txt: one extended regex per
# line, matched against the finding as printed ("path: reason" or "path:line: text").
# Works without a network and from any folder. Exit status: 0 clean, 1 with findings.
set -euo pipefail

QA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO="$(cd "${QA_DIR}/../.." && pwd -P)"
ALLOWLIST="${QA_DIR}/secrets-allowlist.txt"
cd "${REPO}"

# Files that hold credentials whatever their content. Matched against the path, case-insensitively.
# The one .env file allowed is the Functions params file for the offline demo project.
NAME_RULES=(
  'GoogleService-Info[^/]*\.plist$|google-services\.json$::Firebase app config (keep it out of git; see .gitignore)'
  '(^|/)\.env(\.[^/]*)?$::.env file'
  '\.(keystore|jks|p8|p12|pfx|pem|key|mobileprovision|provisionprofile)$::key, certificate or signing file'
  '(^|/)id_(rsa|dsa|ecdsa|ed25519)$::SSH private key'
  '(service[-_]?account|firebase-adminsdk)[^/]*\.json$::service account key'
)
NAME_ALLOWED='^code/backend/functions/\.env\.demo-trackmelive$'

# Content patterns (POSIX extended regexes). Each is written so it can't match its own source text.
CONTENT_RULES=(
  '-----BEGIN[A-Z0-9 ]*PRIVATE KEY( BLOCK)?-----::private key'
  'AIza[0-9A-Za-z_-]{35}::Google API key'
  'GOCSPX-[0-9A-Za-z_-]{28}::Google OAuth client secret'
  '1//0[0-9A-Za-z_-]{40,}::Google OAuth refresh token'
  '"private_key(_id)?"[[:space:]]*:[[:space:]]*"[^"]{16,}::service account key field'
  '(AKIA|ASIA)[0-9A-Z]{16}::AWS access key id'
  'gh[pousr]_[0-9A-Za-z]{36,}::GitHub token'
  'github_pat_[0-9A-Za-z_]{60,}::GitHub fine-grained token'
  'xox[abposr]-[0-9A-Za-z-]{10,}::Slack token'
  'hooks\.slack\.com/services/T[0-9A-Z]+/B[0-9A-Z]+/[0-9A-Za-z]+::Slack webhook'
  '(sk|rk)_live_[0-9A-Za-z]{20,}::Stripe live key'
  'npm_[0-9A-Za-z]{36}::npm token'
  '(^|:)_auth(Token)?[[:space:]]*=[[:space:]]*[^[:space:]$]{8,}::npm registry credential'
  'sk-ant-[0-9A-Za-z_-]{20,}::Anthropic API key'
  'sk-(proj|svcacct|admin)-[0-9A-Za-z_-]{20,}::OpenAI API key'
  'AAAA[0-9A-Za-z_-]{7}:[0-9A-Za-z_-]{140}::FCM server key'
  'eyJ[0-9A-Za-z_-]{10,}\.eyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}::JSON Web Token'
  '(store|key)Password[[:space:]]*=[[:space:]]*"[^"$]+"::Android signing password'
)

allowed() { # <finding>
  [[ -f "${ALLOWLIST}" ]] || return 1
  local pattern
  while IFS= read -r pattern || [[ -n "${pattern}" ]]; do
    [[ -z "${pattern}" || "${pattern}" == \#* ]] && continue
    if printf '%s\n' "$1" | grep -Eq -- "${pattern}"; then
      return 0
    fi
  done < "${ALLOWLIST}"
  return 1
}

findings=0
report() { # <finding>
  if allowed "$1"; then
    return 0
  fi
  printf '%s\n' "$1"
  findings=$((findings + 1))
}

# 1. Credential files by name: tracked (even if force-added past .gitignore) or new and not ignored.
listing="$(mktemp)"
trap 'rm -f "${listing}"' EXIT
git ls-files --cached --others --exclude-standard | sort -u > "${listing}"
files="$(wc -l < "${listing}" | tr -d ' ')"
for rule in "${NAME_RULES[@]}"; do
  while IFS= read -r path; do
    [[ -n "${path}" ]] || continue
    report "${path}: ${rule##*::}"
  done < <(grep -Ei -- "${rule%%::*}" "${listing}" | grep -Ev -- "${NAME_ALLOWED}" || true)
done

# 2. Key material by content, in the same files (git grep --untracked skips ignored files; -I skips binaries).
for rule in "${CONTENT_RULES[@]}"; do
  pattern="${rule%%::*}"
  label="${rule##*::}"
  while IFS= read -r hit; do
    [[ -n "${hit}" ]] || continue
    # path:line:match. Only the match's first 8 characters are printed, so a real secret never is.
    location="${hit%%:*}"
    rest="${hit#*:}"
    line="${rest%%:*}"
    match="${rest#*:}"
    report "${location}:${line}: ${label}: ${match:0:8}..."
  done < <(git grep --untracked -I -n -o -E -e "${pattern}" -- . || true)
done

if (( findings > 0 )); then
  echo "scan-secrets: ${findings} finding(s) in ${files} files. Remove the secret (and rotate it if it was ever pushed), or, if it's safe, add a pattern to code/qa/secrets-allowlist.txt."
  exit 1
fi
echo "scan-secrets: ${files} files (tracked and new), no secrets found"
