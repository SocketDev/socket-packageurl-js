/* PURL / inline-code classifiers.
 *
 * Inline <code> spans in prose come in three flavors we handle
 * specially (all "identifier-ish" content that hljs auto-detect
 * mis-tints, or fixed-grammar strings hljs doesn't understand):
 *
 *   1. Bare PURL type tokens  — `npm`, `pypi`, `maven`, `hex`, …
 *   2. PURL-shaped strings     — `pkg:npm/lodash@4.17.21`, sketch
 *                                forms like `pkg:type/ns/name@v`
 *   3. URL / protocol scheme   — `https://…`, `git+https://…`
 *   4. Bare identifier tokens  — `arch`, `classifier`, `subpath`
 *
 * Exposes its classifiers on the shared namespace so the
 * tokenizer module can hand each code span to the right path:
 * PURL → hand-tokenize; bare ident / URL → .wt-purl (no
 * syntax pass); everything else → hljs as TypeScript. */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const PURL_TYPES = new Set([
    'alpm',
    'apk',
    'bitbucket',
    'bitnami',
    'cargo',
    'cocoapods',
    'composer',
    'conan',
    'conda',
    'cpan',
    'cran',
    'deb',
    'docker',
    'gem',
    'generic',
    'github',
    'gitlab',
    'golang',
    'hackage',
    'hex',
    'huggingface',
    'luarocks',
    'maven',
    'mlflow',
    'npm',
    'nuget',
    'oci',
    'pub',
    'pypi',
    'qpkg',
    'rpm',
    'swid',
    'swift',
    'vscode-extension',
    'yocto',
  ])

  /* True for a `pkg:…` identifier OR a bare known PURL type
   * word (`npm`, `hex`, …) OR a sketched form using a scheme
   * other than pkg: that still follows type/ns/name grammar. */
  ns.looksLikePurl = text => {
    const trimmed = text.trim()
    if (PURL_TYPES.has(trimmed.toLowerCase())) {
      return true
    }
    if (/^pkg:[a-z][a-z0-9.+-]*\//i.test(trimmed)) {
      return true
    }
    return /^[A-Za-z][A-Za-z0-9.+-]*:\s+[^\s]+\/[^\s]+(?:@[^\s]+)?(?:\?[^\s]+)?(?:#[^\s]+)?$/.test(
      trimmed,
    )
  }

  /* Single short lowercase/identifier word, no operators or
   * calls. These are field/option names referenced in prose
   * (`arch`, `os`, `classifier`), not code expressions — hljs
   * tints them as keywords/variables which reads as over-styled.
   * Threshold: ≤24 chars + [A-Za-z_][A-Za-z0-9_-]* only. */
  ns.looksLikeBareIdent = text => {
    const trimmed = text.trim()
    return (
      trimmed.length > 0 &&
      trimmed.length <= 24 &&
      /^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed)
    )
  }

  /* URL fragments / scheme prefixes. hljs with forced JavaScript
   * parses `//` as a line-comment opener and italicizes the rest
   * of the span; the URL then renders as slanted garbage. */
  ns.looksLikeUrlish = text => {
    const trimmed = text.trim()
    if (trimmed.length === 0) {
      return false
    }
    return (
      /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ||
      /^[a-z][a-z0-9+.-]*:\/?$/i.test(trimmed) ||
      trimmed.startsWith('//')
    )
  }
})()
