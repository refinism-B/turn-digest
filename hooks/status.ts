import type { Activity, Phase, TurnRecord, Waiting } from '../types'
import { formatDuration, formatTally, joinDots } from './tally'

// Strict on purpose (a miss beats a false alarm): only Claude saying it will
// come back or report later, not a mere mention of waiting or a suggestion.
const PROMISES = [
  /(再|會|就)(通知|告訴|回報|回覆|報告)你/g,
  /會再回來|再回來(告訴|回報|通知)/g,
  /等(待)?[^。！？\n]{0,30}(回報|回來|結果|完成|跑完|結束|檢查完)[^。！？\n]{0,4}(後|再)/g,
  /稍後(再)?(回報|通知|告訴你|回來)/g,
  /\bI(?:'|’)?(?:ll| will) (?:report|let you know|get back|update you|check back|follow up|notify you)/gi,
  /\bwill report\b/gi,
  /\bwaiting (?:for|on)\b/gi,
  /\bwait(?:ing)? for .{0,60}\b(?:to finish|to complete|results?|report)/gi,
]
// A negation this close before a match ("不用等待", "no need to wait for") cancels it.
const NEGATED = /(不用|無需|無須|毋須|不必|不需|不會|沒有在|no need to|don(?:'|’)t need to|do not need to|without)[\s\S]{0,4}$/i

const lastParagraph = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map(block => block.trim())
    .filter(Boolean)
    .pop() ?? ''

/** Whether the reply's last paragraph says it is waiting on something. Strict: a miss beats a false alarm. */
export const looksLikeWaiting = (text: string): boolean => {
  const paragraph = lastParagraph(text)
  for (const pattern of PROMISES) {
    for (const match of paragraph.matchAll(pattern)) {
      if (!NEGATED.test(paragraph.slice(0, match.index))) return true
    }
  }

  return false
}

export const decideStatus = (input: {
  reason: TurnRecord['reason']
  waiting: Waiting
  finalText: string
}): Phase => {
  if (input.reason !== 'answer') return 'ended'
  const { agents, background, crons } = input.waiting
  if (agents + background + crons > 0) return 'waiting'

  return looksLikeWaiting(input.finalText) ? 'stalled' : 'done'
}

const elapsed = (turn: TurnRecord, now: number) => formatDuration((turn.endedAt ?? now) - turn.startedAt)

/** The band's one line for the phase; `null` draws nothing. */
export const formatActivity = (activity: Activity, turn: TurnRecord | null, now: number): string | null => {
  const { waiting } = activity
  switch (activity.phase) {
    case 'idle':
      return null
    case 'waiting': {
      const parts = [
        waiting.agents > 0 ? `子代理 ${waiting.agents}` : '',
        waiting.background > 0 ? `背景工作 ${waiting.background}` : '',
        waiting.crons > 0 ? `排程喚醒 ${waiting.crons}` : '',
      ].filter(Boolean)
      return `⧗ 等待中：${parts.join('、')}`
    }
    case 'stalled':
      return '⚠ 回合已結束，但沒有任何子代理或背景工作在跑'
  }
  if (turn === null) return null
  if (activity.phase === 'done') return joinDots(['✓ 已完成', formatTally(turn.calls), elapsed(turn, now)])
  if (activity.phase === 'ended') return joinDots(['✕ 回合中斷', formatTally(turn.calls), elapsed(turn, now)])
  const last = turn.calls[turn.calls.length - 1]
  const parts = [
    '執行中',
    last ? formatTally(turn.calls) : '',
    last ? `正在 ${last.label}` : '',
    waiting.agents > 0 ? `子代理 ${waiting.agents} 個執行中` : '',
    elapsed(turn, now),
  ].filter(Boolean)

  return joinDots(parts)
}
