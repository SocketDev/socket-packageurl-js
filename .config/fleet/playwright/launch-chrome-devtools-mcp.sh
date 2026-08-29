#!/bin/sh
# Launch the Chrome DevTools MCP server on the ONE shared browser profile
# (~/.socket/_wheelhouse/mcp-browser-profile) instead of an ephemeral
# --isolated one, with extensions kept on (--category-extensions: puppeteer
# skips --disable-extensions, so the grafted 1Password loads and the
# chrome-extension tools exist) and the automation bot signal dropped
# (--ignore-default-chrome-arg=--enable-automation, matching the fleet
# launch shape). The profile dir lives outside any repo so fleet members
# and non-fleet checkouts share one 1Password graft and one set of logins;
# it needs $HOME expansion, which .mcp.json argv does not do, hence this
# wrapper. Run the graft with scripts/fleet/browser-control-graft.mts once
# per machine.
set -eu

exec node_modules/.bin/chrome-devtools-mcp \
  --user-data-dir "$HOME/.socket/_wheelhouse/mcp-browser-profile" \
  --category-extensions \
  --no-category-performance \
  --no-category-emulation \
  --ignore-default-chrome-arg=--enable-automation \
  "$@"
