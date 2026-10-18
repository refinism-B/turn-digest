import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, RenderElement, RenderInput } from 'claude-code'
import { textKey } from './keys'
import { IDLE, NEVER_FOLD, row } from './state'
import { formatSummary } from './tally'

const turnFamily = atom({ plugin: 'turn-digest', key: 'turn' } as const, null)
const rowTurnFamily = atom({ plugin: 'turn-digest', key: 'rowTurn' } as const, null)
const anchorFamily = atom({ plugin: 'turn-digest', key: 'anchor' } as const, null)
const expandedFamily = atom({ plugin: 'turn-digest', key: 'expanded' } as const, false)
const activityAtom = atom({ plugin: 'turn-digest', key: 'activity' } as const, IDLE)

const UNTOUCHED = 'AskUserQuestion'

type Folded = RenderInput<'AssistantMessage' | 'ToolUse' | 'ToolResult' | 'ToolGroup', 'terminal'>

/** The rows a transcript row stands for, the anchors it may carry, and whether its owners are in doubt. */
type RowIds = { rows: string[]; anchors: string[]; isDoubtful: boolean }

const idsOf = (e: Folded): RowIds | null => {
  if (e.component === 'AssistantMessage') {
    const id = `text:${textKey(e.props.text)}`
    return { rows: [id], anchors: [id], isDoubtful: false }
  }
  if (e.component === 'ToolGroup') {
    const calls = e.props.calls
    const rows = calls.flatMap(call => (call.tool_use_id === undefined ? [] : [call.tool_use_id]))
    if (rows.length === 0) return null
    const isDoubtful = rows.length !== calls.length || calls.some(call => call.tool === UNTOUCHED)
    return { rows, anchors: rows.map(id => `tool:${id}`), isDoubtful }
  }
  if (e.props.tool === UNTOUCHED) return null
  const id = e.props.tool_use_id
  // A call's result row never carries the summary: its use row does.
  return { rows: [id], anchors: e.component === 'ToolUse' ? [`tool:${id}`] : [], isDoubtful: false }
}

/** The summary row; expanded, or drawn over a row in doubt, the original follows it. */
const summary = async ($: EngineInterface, e: Folded, next: (e: Folded) => Promise<RenderElement>, turnId: string, withOriginal: boolean) => {
  const turn = await read($, memberOf(turnFamily, row(turnId)))
  if (turn === null) return next(e)
  const isExpanded = await read($, memberOf(expandedFamily, row(turnId)))
  // A running turn's anchor follows the band's clock tick; a finished one never reads it.
  const now = turn.endedAt ?? (await read($, activityAtom)).now
  const { Box, Button } = $.ui.resolve(e)
  const toggle = () => update($, memberOf(expandedFamily, row(turnId)), value => !value)
  const button = (
    <Button key={`digest-${turnId}`} plain onPress={toggle}>
      {formatSummary(turn, now, isExpanded)}
    </Button>
  )
  if (!isExpanded && !withOriginal) return button

  return (
    <Box flexDirection="column">
      {button}
      {await next(e)}
    </Box>
  )
}

export const registerFolding = (on: On) => {
  on('ui.render', { component: ['AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup'] }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true) return next(e)
    const ids = idsOf(e)
    if (ids === null) return next(e)

    // Each row reads only its own members, so it redraws only when its turn's fold changes.
    const owners = await Promise.all(ids.rows.map(id => read($, memberOf(rowTurnFamily, row(id)))))
    const turns = [...new Set(owners.filter((owner): owner is string => owner !== null && owner !== NEVER_FOLD))]
    const isUniform = !ids.isDoubtful && turns.length === 1 && owners.every(owner => owner === turns[0])

    if (!isUniform) {
      // In doubt the original shows; the summary too, when this row is a turn's anchor.
      for (const turnId of turns) {
        const anchor = await read($, memberOf(anchorFamily, row(turnId)))
        if (anchor !== null && ids.anchors.includes(anchor)) return summary($, e, next, turnId, true)
      }
      return next(e)
    }

    const turnId = turns[0] as string
    const anchor = await read($, memberOf(anchorFamily, row(turnId)))
    // Never hide a row of a turn that has no summary to open it with.
    if (anchor === null) return next(e)
    if (ids.anchors.includes(anchor)) return summary($, e, next, turnId, false)
    if (await read($, memberOf(expandedFamily, row(turnId)))) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  })
}
