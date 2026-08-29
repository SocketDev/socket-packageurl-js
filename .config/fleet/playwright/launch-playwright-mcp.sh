#!/bin/sh
# Launch the Playwright MCP server on the ONE shared browser profile
# (~/.socket/_wheelhouse/mcp-browser-profile) instead of an ephemeral
# --isolated one, with the fleet agent-banner init script and the
# 1Password-enabled launch shape from mcp-config.json (extensions stay on,
# the automation bot signal stays off — see
# scripts/fleet/_shared/browser-control/launch-shape.mts). The profile dir
# lives outside any repo so fleet members and non-fleet checkouts share one
# 1Password graft and one set of logins; it needs $HOME expansion, which
# .mcp.json argv does not do, hence this wrapper. Run the graft with
# scripts/fleet/browser-control-graft.mts once per machine.
set -eu

DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# --output-dir keeps snapshots, traces and session dumps OUT of the checkout.
# The server writes some artifacts to its output dir and others relative to the
# CWD, and the CWD is a repo: a snapshot landed at the repo ROOT, outside the
# gitignored .playwright-mcp/, and had to be deleted by hand. Pointing the
# output dir outside any repo removes the class rather than ignoring one name.
# Same $HOME expansion reason as --user-data-dir above.
exec node_modules/.bin/playwright-mcp \
  --config "$DIR/mcp-config.json" \
  --user-data-dir "$HOME/.socket/_wheelhouse/mcp-browser-profile" \
  --output-dir "$HOME/.socket/_wheelhouse/mcp-browser-output" \
  --init-script "$DIR/agent-banner.js" \
  "$@"
