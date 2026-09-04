# Mocking a vendor's screen

## Contents

- Why a mockup rather than the real site
- Build the pages
- Adding another vendor
- Rules

Use this when our guide has to show someone else's UI - npm's token page, a
registry's settings, a provider's console - because the customer has to go there
before our product works.

Do not film or screenshot the real thing. Doing that means signing in to a live
account and, for anything credential-shaped, minting a real one to photograph.
Every frame then carries that account's identity: the account name sits in the
URL, and a sidebar usually lists every organization it belongs to. A mockup has
none of that, works offline, and can be regenerated when the vendor moves a
control.

## Why a mockup rather than the real site

## Build the pages

```sh
node .claude/skills/fleet/recording-ui-walkthroughs/npm-mockup.mts \
  [--out-dir <dir>] [--check]
```

npm is the worked example. One renderer carries the chrome - the browser frame
with the account placeholder in the URL, the rainbow rule, their wordmark, their
wombat avatar, the settings sidebar - and each page is composed from field
helpers (`npmSection`, `npmTextField`, `npmSelectMenu`, `npmActions`, …). Add a
screen by adding a page to `NPM_MOCKUP_PAGES`; the shell comes with it.

Commit the generated HTML so recording needs no build step, and wire `--check`
into lint so the committed copy cannot drift from the generator.

## Adding another vendor

Copy the shape, not the markup: one chrome renderer, one function per screen,
helpers named after that vendor's controls. What makes a mockup useful is that
the controls a customer must touch are recognizable - the right control type, so
a select menu is never stood in for by a radio group, the vendor's own labels and
hints, and a summary that restates the choices if theirs does.

## Rules

- **Draw their marks inline.** A hotlinked logo breaks offline recording and puts
  someone else's binary in our repo. An SVG path from their published logo is
  fine: we are pointing customers at them and telling them how to use it.
- **Say it is an illustration.** Keep a visible marker in the chrome so nobody
  mistakes it for their own account.
- **Never bake in a real identity.** Leave the account name a placeholder with an
  id, so a recorder can rewrite it before the first frame
  ([SKILL.md](SKILL.md) does this with a `setText` step).
- **Fidelity is about which controls matter**, not pixels. State plainly in the
  page comment what has to stay faithful, so the next person keeping it in step
  with the vendor knows what not to "improve".
- **Keep vendor copy accurate.** Paraphrasing their hints into our voice makes
  the mockup stop matching what the customer sees.
