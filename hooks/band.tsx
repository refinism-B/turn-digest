import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, On, Timer } from 'claude-code'
import { countAgents, guard } from './guard'
import { IDLE, row } from './state'
import { decideStatus } from './status'

const turnFamily = atom({ plugin: 'turn-digest', key: 'turn' } as const, null)
const activityAtom = atom({ plugin: 'turn-digest', key: 'activity' } as const, IDLE)

const TICK_MS = 1_000
const POLL_MS = 3_000

// Rebuildable: a reload starts both over from session.start.
let timer: Timer | undefined
let lastPoll = 0
// Polls in a row that found no agent: a turn goes stalled only after two, so the
// gap between an agent ending and its notification turn starting raises no alarm.
let quietPolls = 0

/** Moves a running turn's clock; asks for agents every POLL_MS while running or waiting. */
async function tick($: EngineInterface): Promise<void> {
  const activity = await read($, activityAtom)
  if (activity.phase !== 'running' && activity.phase !== 'waiting') {
    quietPolls = 0
    return
  }
  const now = await $.clock.now()
  const isPoll = now - lastPoll >= POLL_MS
  if (isPoll) lastPoll = now
  const agents = isPoll ? await countAgents($) : activity.waiting.agents

  if (activity.phase === 'running') {
    await update($, activityAtom, current =>
      current.turnId === activity.turnId && current.phase === 'running'
        ? { ...current, now, waiting: { ...current.waiting, agents } }
        : current,
    )
    return
  }
  if (!isPoll || activity.phase !== 'waiting' || activity.turnId === null) return
  quietPolls = agents === 0 ? quietPolls + 1 : 0
  const turn = await read($, memberOf(turnFamily, row(activity.turnId)))
  if (turn === null) return
  const settled = { ...activity.waiting, agents }
  const phase = decideStatus({ reason: turn.reason, waiting: settled, finalText: turn.finalText ?? '' })
  if (phase === 'stalled' && quietPolls < 2) return
  if (phase === activity.phase && agents === activity.waiting.agents) return
  await update($, activityAtom, current => {
    if (current.turnId !== activity.turnId || current.phase !== 'waiting') return current
    const waiting = { ...current.waiting, agents }
    return { ...current, waiting, phase: decideStatus({ reason: turn.reason, waiting, finalText: turn.finalText ?? '' }) }
  })
}

export const registerBand = (on: On) => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    // An earlier load pinned the activity through $.ui.status; the hint line draws it now.
    $.ui.status(undefined)
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      void guard($, 'tick', () => tick($))
    })

    return result
  })
}
