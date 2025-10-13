
/**
 * @fileoverview Sync unified scripts to other Socket repositories
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import colors from 'yoctocolors-cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

const SOCKET_PROJECTS = [
  '../socket-cli',
  '../socket-sdk-js',
  '../socket-registry',
]

const FILES_TO_SYNC = [
  'scripts/test.mjs',
  'scripts/lint.mjs',
  'scripts/build.mjs',
  'scripts/clean.mjs',
  'scripts/utils/common.mjs',
  'scripts/utils/changed-test-mapper.mjs',
]

async function fileExists(filepath) {
  try {
    await fs.access(filepath)
    return true
  } catch {
    return false
  }
}

async function syncFile(sourceFile, targetProject) {
  const sourcePath = path.join(rootPath, sourceFile)
  const targetPath = path.join(rootPath, targetProject, sourceFile)

  // Ensure target directory exists
  const targetDir = path.dirname(targetPath)
  await fs.mkdir(targetDir, { recursive: true })

  // Read source file
  const content = await fs.readFile(sourcePath, 'utf8')

  // Write to target
  await fs.writeFile(targetPath, content, 'utf8')
  console.log(`  ${colors.green('✓')} ${sourceFile}`)
}

async function updatePackageJson(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json')
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'))

  // Update scripts
  const updates = {
    'build': 'node scripts/build.mjs',
    'clean': 'node scripts/clean.mjs',
    'lint': 'node scripts/lint.mjs',
    'fix': 'node scripts/lint.mjs --fix',
    'test': 'node scripts/test.mjs',
  }

  // Remove old scripts
  const toRemove = [
    'test:quick',
    'test:coverage',
    'test:unit',
    'test:unit:coverage',
    'test:unit:update',
    'test-pre-commit',
    'pretest:unit',
    'test:old',
    'build:src',
    'build:types',
    'build:src-only',
    'build:types-only',
    'build:dist',
    'build:dist:src',
    'build:dist:types',
    'clean:dist',
    'clean:dist:types',
    'clean:cache',
    'clean:coverage',
    'clean:node_modules',
  ]

  for (const script of toRemove) {
    delete pkg.scripts[script]
  }

  // Add new scripts
  for (const [name, command] of Object.entries(updates)) {
    pkg.scripts[name] = command
  }

  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`  ${colors.green('✓')} package.json updated`)
}

async function updateHuskyPreCommit(projectPath) {
  const preCommitPath = path.join(projectPath, '.husky/pre-commit')

  if (!(await fileExists(preCommitPath))) {
    console.log(`  ${colors.yellow('⚠')} .husky/pre-commit not found, skipping`)
    return
  }

  const newContent = `if [ -z "\${DISABLE_PRECOMMIT_LINT}" ]; then
  pnpm lint --staged
else
  echo "Skipping lint due to DISABLE_PRECOMMIT_LINT env var"
fi

if [ -z "\${DISABLE_PRECOMMIT_TEST}" ]; then
  dotenvx -q run -f .env.precommit -- pnpm test --staged
else
  echo "Skipping testing due to DISABLE_PRECOMMIT_TEST env var"
fi
`

  await fs.writeFile(preCommitPath, newContent, 'utf8')
  console.log(`  ${colors.green('✓')} .husky/pre-commit updated`)
}

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Syncing unified scripts to Socket repositories')
  console.log('═══════════════════════════════════════════════════════')

  for (const project of SOCKET_PROJECTS) {
    const projectPath = path.join(rootPath, project)
    const projectName = path.basename(project)

    // Check if project exists
    if (!(await fileExists(projectPath))) {
      console.log(`\n${colors.yellow('⚠')} ${projectName} not found, skipping`)
      continue
    }

    console.log(`\n${colors.bold(projectName)}:`)

    try {
      // Sync script files
      for (const file of FILES_TO_SYNC) {
        await syncFile(file, project)
      }

      // Update package.json
      await updatePackageJson(projectPath)

      // Update .husky/pre-commit
      await updateHuskyPreCommit(projectPath)

      console.log(`${colors.green('✓')} ${projectName} updated successfully`)
    } catch (error) {
      console.error(`${colors.red('✗')} Error updating ${projectName}:`, error.message)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════')
  console.log(`${colors.green('✓')} Script sync complete!`)
  console.log('\nNext steps for each repository:')
  console.log('1. Review the changes')
  console.log('2. Test the new scripts')
  console.log('3. Commit the changes')
  console.log('═══════════════════════════════════════════════════════')
}

main().catch(console.error)