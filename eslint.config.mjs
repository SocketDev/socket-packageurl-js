import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile,
} from '@eslint/compat'
import js from '@eslint/js'
import importXPlugin from 'eslint-plugin-import-x'
import nodePlugin from 'eslint-plugin-n'
import sortDestructureKeysPlugin from 'eslint-plugin-sort-destructure-keys'
import unicornPlugin from 'eslint-plugin-unicorn'
import globals from 'globals'

import constants from '@socketsecurity/registry/lib/constants'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

const rootPath = __dirname

const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly']),
)

const biomeConfigPath = path.join(rootPath, 'biome.json')
const biomeConfig = require(biomeConfigPath)
const biomeIgnores = {
  name: `Imported biome.json ignore patterns`,
  ignores: biomeConfig.files.includes
    .filter(p => p.startsWith('!'))
    .map(p => convertIgnorePatternToMinimatch(p.slice(1))),
}

const gitignorePath = path.join(rootPath, '.gitignore')
const gitIgnores = {
  ...includeIgnoreFile(gitignorePath),
  name: `Imported .gitignore ignore patterns`,
}

export default [
  includeIgnoreFile(gitignorePath),
  biomeIgnores,
  gitIgnores,
  {
    ...js.configs.recommended,
    ...importXPlugin.flatConfigs.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ...importXPlugin.flatConfigs.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-script'].languageOptions,
      ecmaVersion: 'latest',
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        ...importXPlugin.flatConfigs.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-script'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig,
      },
      sourceType: 'script',
    },
    linterOptions: {
      ...js.configs.recommended.linterOptions,
      ...importXPlugin.flatConfigs.recommended.linterOptions,
      ...nodePlugin.configs['flat/recommended-script'].linterOptions,
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      ...js.configs.recommended.plugins,
      ...importXPlugin.flatConfigs.recommended.plugins,
      ...nodePlugin.configs['flat/recommended-script'].plugins,
      'sort-destructure-keys': sortDestructureKeysPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...importXPlugin.flatConfigs.recommended.rules,
      ...nodePlugin.configs['flat/recommended-script'].rules,
      'import-x/extensions': [
        'error',
        'never',
        {
          cjs: 'ignorePackages',
          js: 'ignorePackages',
          json: 'always',
          mjs: 'ignorePackages',
        },
      ],
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-unresolved': ['error', { commonjs: true }],
      'import-x/order': [
        'warn',
        {
          groups: [
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'type',
          ],
          pathGroups: [
            {
              pattern: '@socket{registry,security}/**',
              group: 'internal',
            },
          ],
          pathGroupsExcludedImportTypes: ['type'],
          'newlines-between': 'always',
          alphabetize: {
            order: 'asc',
          },
        },
      ],
      'n/exports-style': ['error', 'module.exports'],
      // The n/no-unpublished-bin rule does does not support non-trivial glob
      // patterns used in package.json "files" fields. In those cases we simplify
      // the glob patterns used.
      'n/no-unpublished-bin': 'error',
      'n/no-unsupported-features/es-builtins': 'error',
      'n/no-unsupported-features/es-syntax': 'error',
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          ignores: ['test', 'test.describe'],
          // Lazily access constants.maintainedNodeVersions.
          version: constants.maintainedNodeVersions.current,
        },
      ],
      'n/prefer-node-protocol': 'error',
      'unicorn/consistent-function-scoping': 'error',
      curly: 'error',
      'no-await-in-loop': 'error',
      'no-control-regex': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-new': 'error',
      'no-proto': 'error',
      'no-undef': 'error',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_|^this$',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'no-var': 'error',
      'no-warning-comments': ['warn', { terms: ['fixme'] }],
      'prefer-const': 'error',
      'sort-destructure-keys/sort-destructure-keys': 'error',
      'sort-imports': ['error', { ignoreDeclarationSort: true }],
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
]