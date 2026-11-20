#!/usr/bin/env bash
# Idempotent installer for the tracked pre-commit hook (MP-31D).
# Sets core.hooksPath to .githooks (relative to repo root) when possible.
# Does not overwrite .git/hooks/pre-commit automatically; backs it up first if needed.
# Safe: no secrets, no destructive operations.

set -u

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not a git repository." >&2
  exit 1
}

HOOKS_DIR="$REPO_ROOT/.githooks"
HOOK_FILE="$HOOKS_DIR/pre-commit"

if [ ! -f "$HOOK_FILE" ]; then
  echo "ERROR: tracked hook template not found: $HOOK_FILE" >&2
  exit 1
fi

chmod +x "$HOOK_FILE" 2>/dev/null || true

# Prefer core.hooksPath (shared, tracked) approach.
git config core.hooksPath .githooks
echo "Configured core.hooksPath=.githooks"

# If a legacy .git/hooks/pre-commit exists and is not already our template,
# back it up (do not overwrite) for safety.
LEGACY="$REPO_ROOT/.git/hooks/pre-commit"
if [ -f "$LEGACY" ]; then
  # Compare to template; if different, back up once.
  if ! cmp -s "$LEGACY" "$HOOK_FILE"; then
    BACKUP="$REPO_ROOT/.git/hooks/pre-commit.mp31-backup"
    if [ ! -f "$BACKUP" ]; then
      cp "$LEGACY" "$BACKUP"
      echo "Backed up legacy hook to $BACKUP"
    else
      echo "Backup already exists: $BACKUP"
    fi
  fi
fi

echo "Hook installation complete."
exit 0
