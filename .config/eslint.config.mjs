import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  convertIgnorePatternToMinimatch,
  includeIgnoreFile,
} from '@eslint/compat'
import js from '@eslint/js'
import { flatConfigs as importXFlatConfigs } from 'eslint-plugin-import-x'
import nodePlugin from 'eslint-plugin-n'
import sortDestructureKeysPlugin from 'eslint-plugin-sort-destructure-keys'
import unicornPlugin from 'eslint-plugin-unicorn'
import globals from 'globals'
import { parser as typescriptParser } from 'typescript-eslint'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// Get maintained Node versions - inline to avoid registry dependency
const getMaintainedNodeVersions = () => ['18', '20', '22', '24']

const rootPath = path.dirname(__dirname)

const nodeGlobalsConfig = Object.fromEntries(
  Object.entries(globals.node).map(([k]) => [k, 'readonly']),
)

const biomeConfigPath = path.join(rootPath, 'biome.json')
const biomeConfig = require(biomeConfigPath)
const biomeIgnores = {
  name: 'Imported biome.json ignore patterns',
  ignores: biomeConfig.files.includes
    .filter(p => p.startsWith('!'))
    .map(p => convertIgnorePatternToMinimatch(p.slice(1))),
}

const gitignorePath = path.join(rootPath, '.gitignore')
const gitIgnores = {
  ...includeIgnoreFile(gitignorePath),
  name: 'Imported .gitignore ignore patterns',
}

export default [
  includeIgnoreFile(gitignorePath),
  biomeIgnores,
  gitIgnores,
  {
    ignores: [
      // Dot folders.
      '.*/**',
      // Nested directories.
      '**/coverage/**',
      '**/dist/**',
      '**/external/**',
      '**/node_modules/**',
      // Generated TypeScript files.
      '**/*.d.ts',
      '**/*.d.ts.map',
      '**/*.tsbuildinfo',
    ],
  },
  {
    ...js.configs.recommended,
    ...importXFlatConfigs.recommended,
    ...nodePlugin.configs['flat/recommended-script'],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ...importXFlatConfigs.recommended.languageOptions,
      ...nodePlugin.configs['flat/recommended-script'].languageOptions,
      ecmaVersion: 'latest',
      globals: {
        ...js.configs.recommended.languageOptions?.globals,
        ...importXFlatConfigs.recommended.languageOptions?.globals,
        ...nodePlugin.configs['flat/recommended-script'].languageOptions
          ?.globals,
        ...nodeGlobalsConfig,
      },
      sourceType: 'script',
    },
    linterOptions: {
      ...js.configs.recommended.linterOptions,
      ...importXFlatConfigs.recommended.linterOptions,
      ...nodePlugin.configs['flat/recommended-script'].linterOptions,
      reportUnusedDisableDirectives: 'off',
    },
    plugins: {
      ...js.configs.recommended.plugins,
      ...importXFlatConfigs.recommended.plugins,
      ...nodePlugin.configs['flat/recommended-script'].plugins,
      'sort-destructure-keys': sortDestructureKeysPlugin,
      unicorn: unicornPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...importXFlatConfigs.recommended.rules,
      ...nodePlugin.configs['flat/recommended-script'].rules,
      'import-x/extensions': [
        'error',
        'never',
        {
          cjs: 'ignorePackages',
          js: 'ignorePackages',
          json: 'always',
          mjs: 'ignorePackages',
          mts: 'ignorePackages',
          ts: 'ignorePackages',
        },
      ],
      'import-x/no-named-as-default-member': 'off',
      'import-x/no-unresolved': [
        'error',
        {
          commonjs: true,
          // Ignore @socketsecurity/registry and @socketsecurity/lib subpaths - resolved by runtime loader
          ignore: ['^@socketsecurity/registry/', '^@socketsecurity/lib/'],
        },
      ],
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
      // Ignore @socketsecurity/registry and @socketsecurity/lib subpaths - resolved by runtime loader
      'n/no-missing-import': [
        'error',
        {
          allowModules: ['@socketsecurity/registry', '@socketsecurity/lib'],
        },
      ],
      // The n/no-unpublished-bin rule does does not support non-trivial glob
      // patterns used in package.json "files" fields. In those cases we simplify
      // the glob patterns used.
      'n/no-unpublished-bin': 'error',
      'n/no-unsupported-features/es-builtins': 'error',
      'n/no-unsupported-features/es-syntax': 'error',
      'n/no-unsupported-features/node-builtins': [
        'error',
        {
          ignores: [
            'test',
            'test.describe',
            'ReadableStream',
            'events.getMaxListeners',
          ],
          // Lazily access constants.maintainedNodeVersions.
          version: getMaintainedNodeVersions().current,
        },
      ],
      'n/prefer-node-protocol': 'error',
      'unicorn/consistent-function-scoping': 'error',
      curly: 'error',
      'line-comment-position': ['error', { position: 'above' }],
      'no-await-in-loop': 'error',
      'no-control-regex': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-new': 'error',
      'no-proto': 'error',
      'no-undef': 'error',
      'no-unexpected-multiline': 'off',
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
      'sort-imports': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.mts'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    // Relax rules for script files
    files: ['scripts/**/*.mjs', 'scripts/**/*.cjs'],
    rules: {
      'n/no-process-exit': 'off',
      'no-await-in-loop': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.mts'],
    languageOptions: {
      parser: typescriptParser,
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // Disable the following rules because they don't play well with TypeScript.
      'dot-notation': 'off',
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/extensions': [
        'error',
        'ignorePackages',
        {
          json: 'always',
        },
      ],
    },
  },
  {
    files: ['test/**/*.test.mts'],
    languageOptions: {
      parser: typescriptParser,
      sourceType: 'module',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'n/no-unsupported-features/es-syntax': 'off',
      'n/no-missing-import': 'off',
      'n/no-missing-require': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/extensions': 'off',
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_|^this$|^context$',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      'unicorn/consistent-function-scoping': 'off',
      'no-proto': 'off',
      'no-new': 'off',
    },
  },
]
