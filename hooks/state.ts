import type { Activity } from '../types'

// The atoms themselves live in each module that reads or writes them: the
// engine's scan only follows `atom(...)` written in the file that uses it.
// Families: `atom({ plugin: 'turn-digest', key }, initial)`, a member by
// `memberOf(family, { requestId: id })`.
//   turn      id = turnId                               TurnRecord | null
//   rowTurn   id = tool_use_id | `text:<textKey>`       turnId | NEVER_FOLD | null
//   anchor    id = turnId                               `tool:<id>` | `text:<key>` | null
//   expanded  id = turnId                               boolean

export const IDLE: Activity = { turnId: null, phase: 'idle', waiting: { agents: 0, background: 0, crons: 0 }, now: 0 }

/** rowTurn value of a text that must always show: a final reply, or a text two turns share. */
export const NEVER_FOLD = '!'

/** A family member's address, in the shape `memberOf` keys by. */
export const row = (id: string) => ({ requestId: id })
