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
