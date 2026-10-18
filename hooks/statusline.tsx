import { atom, memberOf, read } from 'claude-code'
import type { Color, On } from 'claude-code'
import type { Phase } from '../types'
import { IDLE, row } from './state'
import { formatActivity } from './status'

const turnFamily = atom({ plugin: 'turn-digest', key: 'turn' } as const, null)
const activityAtom = atom({ plugin: 'turn-digest', key: 'activity' } as const, IDLE)

// Still going = yellow, finished = green, something to look at = red.
const COLORS: Record<Phase, Color> = {
  idle: 'inactive',
  running: 'warning',
  waiting: 'warning',
  done: 'success',
  stalled: 'error',
  ended: 'error',
}

/**
 * The activity line, drawn by us above the engine's hint line under the prompt
 * (fullscreen terminal only). It reads the activity, so each write (the 1 s
 * tick included) redraws it.
 */
export const registerStatusLine = (on: On) => {
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen !== true) return next(e)
    const activity = await read($, activityAtom)
    const turn = activity.turnId === null ? null : await read($, memberOf(turnFamily, row(activity.turnId)))
    const line = formatActivity(activity, turn, activity.now)
    if (line === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text color={COLORS[activity.phase]} wrap="truncate-end">
          {line}
        </Text>
        {await next(e)}
      </Box>
    )
  })
}
