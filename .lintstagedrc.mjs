export default {
  '*.{cjs,cts,js,json,md,mjs,mts,ts}': [
    'pnpm run lint -- --fix',
    'biome format --write'
  ]
}
