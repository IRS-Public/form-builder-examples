#!/bin/bash
# See how your changes affect the built static site.
#
# Builds this app twice — once from a clean worktree of `main`, once from your working copy — and
# diffs the two `out/` trees. Useful for any change that is meant to be output-neutral (a refactor,
# a template extraction, a dependency bump), where the review question is "which hunks did I mean?"
#
# Nothing here names an app: the script locates itself, works out where it sits inside its own
# repository, and builds the `site` target of that directory's Makefile. The copy in
# every Form Builder app is byte-identical, which is the point.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$APP_DIR" rev-parse --show-toplevel)"
# "." when the app *is* the repo. A generated app is its own repo, while in a multi-app repo
# such as form-builder-examples it is a subdirectory. `make -C dir/.` and `dir/./out` both
# behave, so one form covers both.
APP_SUBDIR="${APP_DIR#"$REPO_ROOT"}"
APP_SUBDIR="${APP_SUBDIR#/}"
APP_SUBDIR="${APP_SUBDIR:-.}"

BASE_BRANCH="${BASE_BRANCH:-main}"
CURRENT_BRANCH="$(git -C "$APP_DIR" branch --show-current)"
WORKTREE_DIR="${WORKTREE_DIR:-/tmp/diff-out-$BASE_BRANCH-$(basename "$APP_DIR")}"
LOGS_PREFIX="[$(basename "${BASH_SOURCE[0]}")]:"

cleanup() {
  echo "$LOGS_PREFIX Cleaning up..."
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE_DIR" 2>/dev/null || true
  echo "$LOGS_PREFIX Done."
}

if [ "$CURRENT_BRANCH" = "$BASE_BRANCH" ]; then
  echo "$LOGS_PREFIX Already on \`$BASE_BRANCH\`, nothing to compare."
  exit 0
fi
echo "$LOGS_PREFIX Diffing \`$CURRENT_BRANCH\` against \`$BASE_BRANCH\` for \`$APP_SUBDIR\`."

echo "$LOGS_PREFIX Checking out clean \`$BASE_BRANCH\` worktree at $WORKTREE_DIR..."
git -C "$REPO_ROOT" worktree add "$WORKTREE_DIR" "$BASE_BRANCH"
trap cleanup EXIT

# The worktree is a fresh checkout: its node_modules (and so the vendored taxpert mirror the
# build copies from) does not exist yet.
echo "$LOGS_PREFIX Installing the baseline's JS dependencies..."
make -C "$WORKTREE_DIR/$APP_SUBDIR" ci-setup

echo "$LOGS_PREFIX Building on \`$BASE_BRANCH\`..."
make -C "$WORKTREE_DIR/$APP_SUBDIR" site

echo "$LOGS_PREFIX Building on working copy..."
make -C "$APP_DIR" site

echo "$LOGS_PREFIX Diffing build outputs..."
# --no-index so this works on two directories neither of which git tracks. The vendored bundles are
# generated mirrors of another package and are checked by `make check-shared-ui`, not here.
git diff --no-index --color=always \
  -- "$WORKTREE_DIR/$APP_SUBDIR/out" "$APP_DIR/out" | cat
if [ "${PIPESTATUS[0]}" -eq 0 ]; then
  echo "$LOGS_PREFIX No diff found. Build output on \`$CURRENT_BRANCH\` matches \`$BASE_BRANCH\`."
fi
