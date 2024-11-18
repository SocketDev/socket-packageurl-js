# @socketregistry/packageurl-js

[![Socket Badge](https://socket.dev/api/badge/npm/package/@socketregistry/packageurl-js)](https://socket.dev/npm/package/@socketregistry/packageurl-js)
[![CI - @socketregistry/packageurl-js](https://github.com/SocketDev/packageurl-js/actions/workflows/test.yml/badge.svg)](https://github.com/SocketDev/packageurl-js/actions/workflows/test.yml)
[![Follow @SocketSecurity](https://img.shields.io/twitter/follow/SocketSecurity?style=social)](https://twitter.com/SocketSecurity)

> An enhanced and tested zero dependency drop-in replacement of
> [`packageurl-js`](https://socket.dev/npm/package/packageurl-js) complete with
> TypeScript types.

## Installation

### Install as a package override

[`socket`](https://socket.dev/npm/package/socket) CLI will automagically ✨
populate
[overrides](https://docs.npmjs.com/cli/v9/configuring-npm/package-json#overrides)
and [resolutions](https://yarnpkg.com/configuration/manifest#resolutions) of
your `package.json`.

```sh
npx socket optimize
```

Prefer to do it yourself? Add `@socketregistry/packageurl-js` to your
`package.json`.

```json
{
  "overrides": {
    "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
  },
  "resolutions": {
    "packageurl-js": "npm:@socketregistry/packageurl-js@^1"
  }
}
```

### Install as a plain dependency

Install with your favorite package manager.

```sh
npm install @socketregistry/packageurl-js
```

## Requirements

Node >= `18.20.4`
