import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, TurnStepToolChunk } from 'claude-code'
import type { CallRecord, TurnRecord } from '../types'
import { countAgents, guard } from './guard'
import { isQuestion, norm, textKey } from './keys'
import { decideStatus } from './status'
import { IDLE, NEVER_FOLD, row } from './state'
import { callFile, callLabel, classifyTool } from './tally'

const turnFamily = atom({ plugin: 'turn-digest', key: 'turn' } as const, null)
const rowTurnFamily = atom({ plugin: 'turn-digest', key: 'rowTurn' } as const, null)
const anchorFamily = atom({ plugin: 'turn-digest', key: 'anchor' } as const, null)
const activityAtom = atom({ plugin: 'turn-digest', key: 'activity' } as const, IDLE)
const lastTurnIdAtom = atom({ plugin: 'turn-digest', key: 'lastTurnId' } as const, null)

const FINISHED = new Set(['completed', 'failed', 'killed'])
const UNTOUCHED = 'AskUserQuestion'

const patchTurn = ($: EngineInterface, id: string, change: (turn: TurnRecord) => TurnRecord) =>
  update($, memberOf(turnFamily, row(id)), turn => (turn === null ? null : change(turn)))

/** The summary's row: the first tool row, or (no tool yet) the first folded text. */
const anchorOf = (turn: TurnRecord): string | null => {
  if (turn.firstTool !== undefined) return `tool:${turn.firstTool}`
  const first = turn.midKeys[0]
  return first === undefined ? null : `text:${first}`
}

/** Writes the turn's anchor only when it moved: every row of the turn reads it. */
const syncAnchor = async ($: EngineInterface, turn: TurnRecord | null) => {
  if (turn === null) return
  const ref = memberOf(anchorFamily, row(turn.id))
  const anchor = anchorOf(turn)
  if ((await read($, ref)) !== anchor) await update($, ref, () => anchor)
}

/** Marks a text as one that always shows; a turn that had folded it lets it go. */
const pinText = async ($: EngineInterface, key: string) => {
  const ref = memberOf(rowTurnFamily, row(`text:${key}`))
  const owner = await read($, ref)
  if (owner === NEVER_FOLD) return
  await update($, ref, () => NEVER_FOLD)
  if (owner === null) return
  await syncAnchor($, await patchTurn($, owner, turn => ({ ...turn, midKeys: turn.midKeys.filter(k => k !== key) })))
}

/** Claims a text for this turn's fold; a text another turn holds too is pinned instead. */
const claimText = async ($: EngineInterface, turnId: string, key: string): Promise<boolean> => {
  const ref = memberOf(rowTurnFamily, row(`text:${key}`))
  const owner = await read($, ref)
  if (owner === turnId) return true
  if (owner === NEVER_FOLD) return false
  if (owner !== null) {
    await pinText($, key)
    return false
  }
  await update($, ref, () => turnId)
  return true
}

const keysOf = (texts: readonly string[]) => texts.filter(text => norm(text) !== '').map(textKey)

/**
 * Text blocks that closed before a tool chunk are intermediate: fold them,
 * unless they ask something.
 */
const markStep = async ($: EngineInterface, turnId: string, texts: readonly string[], tool?: TurnStepToolChunk) => {
  const claimed: string[] = []
  for (const key of keysOf(texts.filter(text => !isQuestion(text)))) {
    if (await claimText($, turnId, key)) claimed.push(key)
  }
  if (tool !== undefined) await update($, memberOf(rowTurnFamily, row(tool.id)), () => turnId)
  const anchorTool = tool !== undefined && tool.name !== UNTOUCHED ? tool.id : undefined
  const turn = await patchTurn($, turnId, t => ({
    ...t,
    midKeys: [...t.midKeys, ...claimed.filter(key => !t.midKeys.includes(key))],
    ...(t.firstTool === undefined && anchorTool !== undefined ? { firstTool: anchorTool } : {}),
  }))
  await syncAnchor($, turn)
}

/**
 * The texts that ended the turn always show: the final step's blocks, the
 * latest step's blocks when the turn stopped early, and the answer itself.
 */
const keepFinal = async ($: EngineInterface, keys: readonly string[]) => {
  for (const key of new Set(keys)) await pinText($, key)
}

export const registerRecording = (on: On) => {
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      await guard($, 'turn.start', async () => {
        const now = await $.clock.now()
        await update($, memberOf(turnFamily, row(e.turnId)), () => ({ id: e.turnId, startedAt: now, calls: [], midKeys: [], lastKeys: [] }))
        await update($, activityAtom, () => ({ ...IDLE, turnId: e.turnId, phase: 'running' as const, now }))
        await update($, lastTurnIdAtom, () => e.turnId)
      })
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    const isMain = e.agentId === undefined
    // Text by block index since the last tool chunk; and every block of the step.
    const texts = new Map<number, string>()
    const blocks = new Map<number, string>()
    let stepTool: string | undefined
    let result
    for (;;) {
      const step = await stream.next()
      if (step.done) {
        result = step.value
        break
      }
      const chunk = step.value
      if (isMain && chunk.kind === 'thinking') continue
      if (isMain && chunk.kind === 'text') {
        texts.set(chunk.index, (texts.get(chunk.index) ?? '') + chunk.text)
        blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
      }
      if (isMain && chunk.kind === 'tool') {
        const closed = [...texts.values()]
        texts.clear()
        if (stepTool === undefined && chunk.name !== UNTOUCHED) stepTool = chunk.id
        await guard($, 'turn.step', () => markStep($, e.turnId, closed, chunk))
      }
      yield chunk
    }
    if (isMain && result !== undefined) {
      const rest = [...texts.values()]
      const lastKeys = keysOf([...blocks.values()])
      const answer = result.answer
      if (result.toolUses.length > 0) {
        await guard($, 'turn.step', async () => {
          if (rest.length > 0) await markStep($, e.turnId, rest)
          await patchTurn($, e.turnId, turn => ({ ...turn, lastKeys }))
        })
      } else {
        // The last step: its text is the reply. A tool chunk that never became a call anchors nothing.
        await guard($, 'turn.step', async () => {
          await keepFinal($, [...lastKeys, ...keysOf([answer])])
          const turn = await patchTurn($, e.turnId, t => {
            const { firstTool, ...others } = t
            const isPhantom = firstTool !== undefined && firstTool === stepTool
            return { ...(isPhantom ? others : t), finalText: answer, lastKeys }
          })
          await syncAnchor($, turn)
        })
      }
    }

    return result
  })

  on('tool.call', async ($, e, next) => {
    const id = e.tool_use_id
    if (e.agentId !== undefined || !id) return next(e)
    const turnId = await guard($, 'tool.call', async () => {
      const current = await read($, lastTurnIdAtom)
      if (current === null) return undefined
      const file = callFile(e)
      const call: CallRecord = {
        id,
        tool: e.tool,
        category: classifyTool(e.tool, e),
        label: callLabel(e.tool, e),
        ...(file === undefined ? {} : { file }),
        isRunning: true,
        isErrored: false,
      }
      await update($, memberOf(rowTurnFamily, row(id)), () => current)
      await patchTurn($, current, turn =>
        turn.endedAt !== undefined ? turn : { ...turn, calls: [...turn.calls.filter(c => c.id !== id), call] },
      )
      return current
    })
    const result = await next(e)
    if (turnId !== undefined) {
      const isErrored = typeof result.deny === 'string' || result.isError === true
      await guard($, 'tool.call', () =>
        patchTurn($, turnId, turn => ({
          ...turn,
          calls: turn.calls.map(call => (call.id === id ? { ...call, isRunning: false, isErrored } : call)),
        })),
      )
    }

    return result
  })
    // A failure here must never cost the call: let it through (or keep its result).
    .catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    // Ending the turn comes first: nothing after it may leave the band at 執行中.
    const now = (await guard($, 'turn.complete', () => $.clock.now())) ?? 0
    const turn = await guard($, 'turn.complete', async () => {
      const ended = await patchTurn($, e.turnId, t => ({ ...t, endedAt: now, reason: e.reason }))
      if (ended === null) return null
      await keepFinal($, [...ended.lastKeys, ...keysOf([e.answer, ended.finalText ?? ''])])
      return ended
    })
    if (turn === null || turn === undefined) return result
    const agents = (await guard($, 'turn.complete', () => countAgents($))) ?? 0
    await guard($, 'turn.complete', () =>
      update($, activityAtom, current => {
        // A Stop that came first left this turn's background and cron counts.
        const kept = current.turnId === e.turnId ? current.waiting : IDLE.waiting
        const waiting = { agents, background: kept.background, crons: kept.crons }
        const phase = decideStatus({ reason: e.reason, waiting, finalText: turn.finalText ?? e.answer })
        return { turnId: e.turnId, phase, waiting, now }
      }),
    )

    return result
  })

  // The only source of background work and scheduled wake-ups.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id !== undefined) return result
    await guard($, 'classic.Stop', async () => {
      // Subagents are counted from $.agent.list() already.
      const background = (e.background_tasks ?? []).filter(
        task => !FINISHED.has(task.status) && !/agent/i.test(task.type),
      ).length
      const crons = (e.session_crons ?? []).length
      const agents = await countAgents($)
      const turnId = (await read($, activityAtom)).turnId
      if (turnId === null) return
      const turn = await read($, memberOf(turnFamily, row(turnId)))
      await update($, activityAtom, current => {
        if (current.turnId !== turnId) return current
        const waiting = { agents, background, crons }
        // Before turn.complete: keep the counts, the phase is turn.complete's to set.
        if (current.phase === 'running' || turn === null || turn.endedAt === undefined) return { ...current, waiting }
        return { ...current, waiting, phase: decideStatus({ reason: turn.reason, waiting, finalText: turn.finalText ?? '' }) }
      })
    })

    return result
  })
    // Never let the band's bookkeeping change how the session stops.
    .catch(($, e, next) => next(e))
}
