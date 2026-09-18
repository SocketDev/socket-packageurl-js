import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

export * from '../fleet/paths.mts'
import { REPO_ROOT } from '../fleet/paths.mts'

export const PURL_SPEC_FIXTURE_DIR = path.join(
  REPO_ROOT,
  'test',
  'repo',
  'common',
  'fixture',
  'purl-spec',
)
export const PURL_SPEC_FIXTURE_GLOB = `${normalizePath(PURL_SPEC_FIXTURE_DIR)}/**/*.json`
export const PURL_TEST_DATA_GLOB = `${normalizePath(path.join(REPO_ROOT, 'test', 'data'))}/*.json`

export const GITMODULES_PATH = path.join(REPO_ROOT, '.gitmodules')
export const PURL_SPEC_UPSTREAM_RELATIVE_PATH = 'upstream/purl-spec'
export const PURL_SPEC_UPSTREAM_DIR = path.join(
  REPO_ROOT,
  PURL_SPEC_UPSTREAM_RELATIVE_PATH,
)

export const PURL_SPEC_RULES_PATH = path.join(
  PURL_SPEC_FIXTURE_DIR,
  '..',
  'purl-spec-rules.golden.json',
)
export const PURL_SPEC_DRAFT_RELATIVE_PATH = 'upstream/purl-spec-draft'
export const PURL_SPEC_DRAFT_DIR = path.join(
  REPO_ROOT,
  PURL_SPEC_DRAFT_RELATIVE_PATH,
)
export const PURL_DIST_ENTRY = path.join(REPO_ROOT, 'dist', 'index.js')
