#!/usr/bin/env bash
# Builds the Wukong npm packages as tarballs, the same way the publish workflow does, without
# publishing anything. Works from a throwaway copy of the last commit, so the working tree is
# left alone (commit first: uncommitted changes are not included).
#
# Usage: wukong/scripts/pack-local.sh <out-dir> [scope]
#   scope defaults to `wukong`, giving @wukong/cli, @wukong/server, ...
set -euo pipefail

out="${1:?usage: pack-local.sh <out-dir> [scope]}"
scope="${2:-wukong}"
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/wukong-pack-XXXXXX")"
trap 'git -C "$repo" worktree remove --force "$work" >/dev/null 2>&1 || true; git -C "$repo" worktree prune' EXIT

git -C "$repo" worktree add --detach "$work" HEAD >/dev/null
cd "$work"

export EXPO_PUBLIC_WUKONG=1 ONNXRUNTIME_NODE_INSTALL=skip

node wukong/scripts/rename-npm-scope.mjs --scope "$scope"
node wukong/scripts/brand.mjs >/dev/null

node scripts/npm-retry.mjs ci --ignore-scripts --no-audit --no-fund
npm run postinstall

# Upstream version without its prerelease, plus a build stamp that sorts in time order.
core="$(node -p "require('./package.json').version.split('-')[0]")"
version="${core}-wukong.$(date -u +%Y%m%d%H%M)"
npm pkg set version="$version"
node scripts/sync-workspace-versions.mjs >/dev/null
# The app is not published and its Expo config only accepts x.y.z or x.y.z-beta.N.
npm pkg set version="$core" --workspace="@${scope}/app"

mkdir -p dist-npm
for package in highlight relay protocol client plugin server cli; do
  npm pack --workspace="@${scope}/${package}" --pack-destination dist-npm >/dev/null
done

mkdir -p "$out"
cp dist-npm/*.tgz "$out"/
echo "Packed $version into $out"
ls -l "$out"
