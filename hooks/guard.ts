import type { EngineInterface } from 'claude-code'

// Function declarations: the engine's scan follows `$` across files only into these.

const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])

/** Subagents and teammates still at work. */
export async function countAgents($: EngineInterface): Promise<number> {
  return (await $.agent.list()).filter(agent => LIVE_AGENT.has(agent.status)).length
}

/**
 * Runs bookkeeping that must never cost the person their content or their
 * tool call: a failure is logged to the debug log and the hook goes on.
 */
export async function guard<T>($: EngineInterface, what: string, work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work()
  } catch (error) {
    $.ui.log(`turn-digest: ${what}: ${String(error)}`, { to: 'debug' })
    return undefined
  }
}
