# Failure modes

- **Tests pass but the stubbed dep is dynamically required at runtime via `await import()`**: the static analyzer flags it as unreachable but the runtime path needs it. Add the dep back to the entry's static imports OR remove the dynamic import.
- **The `stubPattern` matches more paths than intended**: too-broad regex. Tighten to a specific basename or a unique path segment. The plugin matches against the absolute resolved path, so `node_modules/.pnpm/@socketsecurity+lib@.../dist/globs.js` is what you're matching.
- **Bundle size grows after a stub**: the empty-CJS replacement is heavier than the dependency's tree-shaken form. Check the rolldown output: usually means the dep was already mostly tree-shaken and the stub overhead exceeds what's saved.
