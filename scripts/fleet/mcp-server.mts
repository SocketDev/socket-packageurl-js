#!/usr/bin/env node
/*
 * @file Fleet MCP Server — exposes fleet operations as MCP tools.
 *   This server implements the Model Context Protocol to provide agents with
 *   sanctioned fleet operations. Agents should use these tools instead of
 *   improvising with raw shell commands.
 *   Tools exposed:
 *
 *   - fleet_check: Run a specific check script
 *   - fleet_preflight: Run the preflight gate
 *   - fleet_prime_roster: Prime the private repo roster
 *   - fleet_coverage: Get coverage report
 *   - fleet_lint: Run linting
 *   - fleet_test: Run tests Usage: node scripts/fleet/mcp-server.mts Or via MCP
 *     config: { "command": "node", "args": ["scripts/fleet/mcp-server.mts"] }
 *   Protocol: JSON-RPC 2.0 over newline-delimited stdio (`initialize` →
 *   `notifications/initialized` → `tools/list` / `tools/call`), implemented
 *   directly like janus-multi-mcp.mts — a fleet script that ships to every
 *   member cannot depend on an SDK the root manifest does not declare.
 */

import process from 'node:process'
import { createInterface } from 'node:readline'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isSpawnError } from '@socketsecurity/lib-stable/process/spawn/errors'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'
import { REPO_ROOT } from './paths.mts'

import type { ScriptMeta } from './_shared/run-main.mts'

const logger = getDefaultLogger()

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_NAME = 'fleet-mcp-server'
const SERVER_VERSION = '1.0.0'

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean | undefined
}

async function runSpawned(cmd: string, args: string[]): Promise<ToolResult> {
  try {
    const { code, stderr, stdout } = await spawn(cmd, args, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
    })
    const output = stdout + (stderr ? `\n${stderr}` : '')
    return {
      content: [{ type: 'text', text: output || '(no output)' }],
      isError: code !== 0,
    }
  } catch (e) {
    if (isSpawnError(e)) {
      const output = String(e.stdout) + (e.stderr ? `\n${e.stderr}` : '')
      return {
        content: [{ type: 'text', text: output || '(no output)' }],
        isError: true,
      }
    }
    return {
      content: [{ type: 'text', text: `Error: ${errorMessage(e)}` }],
      isError: true,
    }
  }
}

async function runScript(
  script: string,
  args: string[] = [],
): Promise<ToolResult> {
  return runSpawned('node', [script, ...args])
}

async function runPnpm(
  command: string,
  args: string[] = [],
): Promise<ToolResult> {
  return runSpawned('pnpm', ['run', command, ...args])
}

const TOOLS = [
  {
    name: 'fleet_check',
    description:
      'Run a specific fleet check script. Use this to verify configuration and wiring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        check: {
          type: 'string',
          description:
            'Name of the check script (without path or extension), e.g. "training-models-respect-visibility"',
        },
        quiet: {
          type: 'boolean',
          description: 'Run in quiet mode (less output)',
          default: false,
        },
      },
      required: ['check'],
    },
  },
  {
    name: 'fleet_preflight',
    description:
      'Run the full preflight gate. Use this before pushing to verify all checks pass.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        withTests: {
          type: 'boolean',
          description: 'Include test suite in preflight',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_prime_roster',
    description:
      'Prime the private repo roster for training model gating. Run this to refresh visibility data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        force: {
          type: 'boolean',
          description: 'Force refresh all owners (ignore TTL)',
          default: false,
        },
        stats: {
          type: 'boolean',
          description: 'Show roster stats without refreshing',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_coverage',
    description:
      'Get coverage report. Use this to check current coverage levels.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'boolean',
          description: 'Show summary only',
          default: true,
        },
      },
    },
  },
  {
    name: 'fleet_lint',
    description: 'Run linting. Use this to check code style and formatting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        all: {
          type: 'boolean',
          description: 'Lint all files (not just modified)',
          default: false,
        },
        fix: {
          type: 'boolean',
          description: 'Auto-fix issues',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_test',
    description: 'Run tests. Use this to verify code works correctly.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Specific test file to run (optional)',
        },
        all: {
          type: 'boolean',
          description: 'Run all tests',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_type',
    description: 'Run TypeScript type checking.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'fleet_fmt',
    description:
      'Run code formatting (oxfmt). Use this to format code before committing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Specific file to format (optional)',
        },
        all: {
          type: 'boolean',
          description: 'Format all files',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_svg_optimize',
    description:
      'Optimize SVG files. Removes unnecessary attributes, minifies paths.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'SVG file to optimize',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'fleet_brand_check',
    description: 'Validate brand assets are canonically named and placed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        quiet: {
          type: 'boolean',
          description: 'Run in quiet mode',
          default: false,
        },
      },
    },
  },
  {
    name: 'fleet_logo',
    description: 'Generate logo variants from source SVG.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description: 'Source SVG file',
        },
        sizes: {
          type: 'string',
          description: 'Comma-separated sizes (e.g. "16,32,64,128")',
        },
      },
    },
  },
  {
    name: 'fleet_favicon',
    description: 'Generate favicon from source image.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source: {
          type: 'string',
          description: 'Source image file',
        },
      },
    },
  },
  {
    name: 'fleet_mermaid',
    description: 'Make mermaid diagrams GitHub-safe (fixes rendering issues).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        file: {
          type: 'string',
          description: 'Markdown file with mermaid diagrams',
        },
      },
      required: ['file'],
    },
  },
  {
    name: 'fleet_icon',
    description: 'Render Socket icon variants.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        variant: {
          type: 'string',
          description: 'Icon variant (e.g. "default", "mono", "inverse")',
        },
        size: {
          type: 'number',
          description: 'Icon size in pixels',
        },
      },
    },
  },
]

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  switch (name) {
    case 'fleet_check': {
      const check = args['check'] as string
      const quiet = args['quiet'] ? ['--quiet'] : []
      return runScript(`scripts/fleet/check/${check}.mts`, quiet)
    }

    case 'fleet_preflight': {
      const withTests = args['withTests'] ? ['--tests'] : []
      return runScript('scripts/fleet/preflight.mts', withTests)
    }

    case 'fleet_prime_roster': {
      const rosterArgs: string[] = []
      if (args['force']) {
        rosterArgs.push('--force')
      }
      if (args['stats']) {
        rosterArgs.push('--stats')
      }
      return runScript('scripts/fleet/setup/roster-db.mts', rosterArgs)
    }

    case 'fleet_coverage': {
      return runPnpm('cover')
    }

    case 'fleet_lint': {
      const lintArgs: string[] = []
      if (args['all']) {
        lintArgs.push('--all')
      }
      if (args['fix']) {
        return runPnpm('fix', lintArgs)
      }
      return runPnpm('lint', lintArgs)
    }

    case 'fleet_test': {
      const testArgs: string[] = []
      if (args['file']) {
        testArgs.push(args['file'] as string)
      }
      if (args['all']) {
        testArgs.push('--all')
      }
      return runPnpm('test', testArgs)
    }

    case 'fleet_type': {
      return runPnpm('type')
    }

    case 'fleet_fmt': {
      const fmtArgs: string[] = []
      if (args['file']) {
        fmtArgs.push(args['file'] as string)
      }
      if (args['all']) {
        fmtArgs.push('--all')
      }
      return runPnpm('format', fmtArgs)
    }

    case 'fleet_svg_optimize': {
      const file = args['file'] as string
      return runScript('scripts/repo/gen/svg-optimize.mts', [file])
    }

    case 'fleet_brand_check': {
      const quiet = args['quiet'] ? ['--quiet'] : []
      return runScript(
        'scripts/fleet/check/brand-assets-are-canonically-named.mts',
        quiet,
      )
    }

    case 'fleet_logo': {
      const logoArgs: string[] = []
      if (args['source']) {
        logoArgs.push('--source', args['source'] as string)
      }
      if (args['sizes']) {
        logoArgs.push('--sizes', args['sizes'] as string)
      }
      return runScript('scripts/repo/gen/logo.mts', logoArgs)
    }

    case 'fleet_favicon': {
      const faviconArgs: string[] = []
      if (args['source']) {
        faviconArgs.push(args['source'] as string)
      }
      return runScript('scripts/repo/gen/favicon-core.mts', faviconArgs)
    }

    case 'fleet_mermaid': {
      const file = args['file'] as string
      return runScript('scripts/repo/gen/mermaid-github-safe.mts', [file])
    }

    case 'fleet_icon': {
      const iconArgs: string[] = []
      if (args['variant']) {
        iconArgs.push('--variant', args['variant'] as string)
      }
      if (args['size']) {
        iconArgs.push('--size', String(args['size']))
      }
      return runScript('scripts/repo/gen/socket-icon-render.mts', iconArgs)
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      }
  }
}

export interface JsonRpcRequest {
  id?: number | string | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

/**
 * The JSON-RPC response for one request. A notification (no `id`) resolves to
 * undefined, so nothing is written. Every dependency is injected through the
 * tool table, so this unit-tests without stdio.
 */
export async function handleRequest(
  req: JsonRpcRequest,
): Promise<Record<string, unknown> | undefined> {
  const { id, method } = req
  if (method === 'initialize') {
    return {
      id,
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    }
  }
  if (method === 'notifications/initialized' || id === undefined) {
    // Notification — no response.
    return undefined
  }
  if (method === 'tools/list') {
    return { id, jsonrpc: '2.0', result: { tools: TOOLS } }
  }
  if (method === 'tools/call') {
    const params = req.params ?? {}
    const toolName = String(params['name'] ?? '')
    const toolArgs = (params['arguments'] as Record<string, unknown>) ?? {}
    try {
      const result = await handleToolCall(toolName, toolArgs)
      return { id, jsonrpc: '2.0', result }
    } catch (e) {
      // A tool-level failure comes back as isError content rather than a
      // JSON-RPC error, so the agent reads the message and can correct.
      return {
        id,
        jsonrpc: '2.0',
        result: {
          content: [{ text: errorMessage(e), type: 'text' }],
          isError: true,
        },
      }
    }
  }
  return {
    error: { code: -32_601, message: `method not found: ${method}` },
    id,
    jsonrpc: '2.0',
  }
}

export async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }
    let req: JsonRpcRequest
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      return
    }
    void handleRequest(req).then(res => {
      if (res !== undefined) {
        process.stdout.write(`${JSON.stringify(res)}\n`)
      }
    })
  })
  rl.on('close', () => {
    process.exit(0)
  })
  logger.info('[fleet-mcp-server] ready (stdio)')
}

export const SCRIPT_META: ScriptMeta = {
  describe:
    'serves the fleet operations (check, preflight, lint, test) as MCP tools over stdio',
  help: 'Usage: node scripts/fleet/mcp-server.mts',
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
