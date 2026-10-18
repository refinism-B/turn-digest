export type Category = 'read' | 'edit' | 'test' | 'command' | 'agent' | 'other'

export type CallRecord = {
  /** tool_use_id */
  id: string
  tool: string
  category: Category
  /** edit/read target path, for the distinct-file count and the label */
  file?: string
  /** callLabel() output */
  label: string
  isRunning: boolean
  isErrored: boolean
}

export type TurnRecord = {
  /** turnId */
  id: string
  /** $.clock.now() ms */
  startedAt: number
  endedAt?: number
  calls: CallRecord[]
  /** textKey() of folded intermediate texts */
  midKeys: string[]
  /** first tool chunk of the turn that is not AskUserQuestion: the summary's row */
  firstTool?: string
  /** textKey() of every text block of the latest step: never folded once the turn ends */
  lastKeys: string[]
  reason?: 'answer' | 'aborted' | 'refusal' | 'error'
  finalText?: string
}

export type Waiting = { agents: number; background: number; crons: number }

export type Phase = 'idle' | 'running' | 'done' | 'waiting' | 'stalled' | 'ended'

/** now: last clock tick (ms) */
export type Activity = { turnId: string | null; phase: Phase; waiting: Waiting; now: number }

declare module 'claude-code' {
  interface PluginState {
    'turn-digest': {
      /** id = turnId */
      turn: StateFamily<TurnRecord | null>
      /** id = tool_use_id or `text:<textKey>` → turnId; `'!'` = this text never folds */
      rowTurn: StateFamily<string | null>
      /** id = turnId → the row drawing the summary: `tool:<tool_use_id>` | `text:<textKey>`; null = fold nothing */
      anchor: StateFamily<string | null>
      /** id = turnId */
      expanded: StateFamily<boolean>
      activity: Activity
      lastTurnId: string | null
    }
  }
}
