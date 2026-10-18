import type { CallRecord, Category, TurnRecord } from '../types'

const READ_TOOLS = new Set(['Read', 'Grep', 'Glob'])
const EDIT_TOOLS = new Set(['Edit', 'Write'])
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const AGENT_TOOLS = new Set(['Agent', 'Task'])
const TEST_COMMAND = /test|pytest|jest|vitest|go test|cargo test/

// Characters of a label's target kept before the ellipsis.
const TARGET_WIDTH = 45

const field = (input: unknown, name: string): string | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const value = (input as Record<string, unknown>)[name]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path

const clip = (text: string, width: number) => {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length > width ? `${chars.slice(0, width).join('')}…` : chars.join('')
}

export const classifyTool = (tool: string, input: unknown): Category => {
  if (READ_TOOLS.has(tool)) return 'read'
  if (EDIT_TOOLS.has(tool)) return 'edit'
  if (AGENT_TOOLS.has(tool)) return 'agent'
  if (SHELL_TOOLS.has(tool)) return TEST_COMMAND.test(field(input, 'command') ?? '') ? 'test' : 'command'
  return 'other'
}

/** The file a call reads or edits, when it names one. */
export const callFile = (input: unknown): string | undefined => field(input, 'file_path') ?? field(input, 'notebook_path')

export const callLabel = (tool: string, input: unknown): string => {
  const file = callFile(input)
  // A shell call's description reads better than its raw command line.
  const shell = SHELL_TOOLS.has(tool) ? field(input, 'description') : undefined
  const target =
    file !== undefined
      ? baseName(file)
      : (shell ?? field(input, 'command') ?? field(input, 'pattern') ?? field(input, 'description') ?? field(input, 'url'))

  return target === undefined ? tool : `${tool} ${clip(target, TARGET_WIDTH)}`
}

export const tally = (calls: readonly CallRecord[]) => {
  const counts = { steps: calls.length, read: 0, editFiles: 0, test: 0, command: 0, agent: 0, failed: 0 }
  const edited = new Set<string>()
  for (const call of calls) {
    if (call.isErrored) counts.failed += 1
    if (call.category === 'edit') edited.add(call.file ?? call.id)
    else if (call.category !== 'other') counts[call.category] += 1
  }
  counts.editFiles = edited.size

  return counts
}

export const formatDuration = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`

  return `${seconds}s`
}

/** `8 步：讀 7、改 1 檔（1 失敗）`, shared by the summary row and the activity line. */
export const formatTally = (calls: readonly CallRecord[]): string => {
  const t = tally(calls)
  const parts = [
    t.read > 0 ? `讀 ${t.read}` : '',
    t.editFiles > 0 ? `改 ${t.editFiles} 檔` : '',
    t.test > 0 ? `測 ${t.test}` : '',
    t.command > 0 ? `指令 ${t.command}` : '',
    t.agent > 0 ? `子代理 ${t.agent}` : '',
  ].filter(Boolean)
  const detail = parts.length > 0 ? `：${parts.join('、')}` : ''
  const failed = t.failed > 0 ? `（${t.failed} 失敗）` : ''

  return `${t.steps} 步${detail}${failed}`
}

/** Joins with ` · `; a full-width parenthesis already spaces the dot. */
export const joinDots = (parts: readonly string[]): string =>
  parts.reduce((line, part) => (line === '' ? part : `${line}${line.endsWith('）') ? '· ' : ' · '}${part}`), '')

export const formatSummary = (turn: TurnRecord, now: number, isExpanded: boolean): string => {
  const body = joinDots([formatTally(turn.calls), formatDuration((turn.endedAt ?? now) - turn.startedAt)])

  return isExpanded ? `▾ 收合 · ${body}` : `▸ ${body}`
}
