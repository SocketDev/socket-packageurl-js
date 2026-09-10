import { parseArgs } from 'node:util'

export function parseBuildFlags() {
  // Parse arguments
  const { values: parsed } = parseArgs({
    options: {
      help: {
        type: 'boolean',
        default: false,
      },
      src: {
        type: 'boolean',
        default: false,
      },
      types: {
        type: 'boolean',
        default: false,
      },
      watch: {
        type: 'boolean',
        default: false,
      },
      needed: {
        type: 'boolean',
        default: false,
      },
      analyze: {
        type: 'boolean',
        default: false,
      },
      silent: {
        type: 'boolean',
        default: false,
      },
      quiet: {
        type: 'boolean',
        default: false,
      },
      verbose: {
        type: 'boolean',
        default: false,
      },
    },
    allowPositionals: false,
    strict: false,
  })
  return {
    __proto__: null,
    help: Boolean(parsed.help),
    src: Boolean(parsed.src),
    types: Boolean(parsed.types),
    watch: Boolean(parsed.watch),
    needed: Boolean(parsed.needed),
    analyze: Boolean(parsed.analyze),
    silent: Boolean(parsed.silent),
    quiet: Boolean(parsed.quiet),
    verbose: Boolean(parsed.verbose),
  }
}
