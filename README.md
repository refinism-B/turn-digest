# turn-digest

[繁體中文](README.zh-TW.md)

A Claude Code mod (function hooks) that keeps the transcript readable when you only care about the result.

- **Folds each turn's process into one row.** Intermediate text, tool calls and tool results collapse into a single clickable summary; the final reply stays in full.
- **Shows what is happening now** in a coloured line just above the hint line under the prompt.
- **Flags a turn that says it is waiting but has nothing running**, e.g. a reply ending in "I'll report back once the agent finishes" when no agent, background task or scheduled wake-up exists.

```
▸ 12 步：讀 5、改 2 檔、測 1、指令 3、子代理 1（1 失敗）· 48s     ← click to expand that turn
(final reply, shown in full)
```

The interface text is Traditional Chinese.

## What you see

### Summary row

`▸ N 步：讀 a、改 b 檔、測 c、指令 d、子代理 e（f 失敗）· time`
(N steps: reads, files edited, test runs, other commands, subagents, failures, elapsed time; zero counts are left out).

- Click the row to expand that turn; the row becomes `▾ 收合 · …`. Click again to fold it. Other turns are not affected; new turns start folded.
- Folded: intermediate text, tool-call rows, tool results.
- Never folded: your prompts, the final reply, intermediate text containing a question mark (`?` / `？`), and `AskUserQuestion` questions and answers.
- When the mod cannot tell for sure whether a row belongs to a turn, it shows the row as is.
- Thinking is not shown while it streams (main conversation only; subagents untouched).

### Activity line

| Colour | Example | Meaning |
|---|---|---|
| yellow | `執行中 · 8 步：讀 7、改 1 檔 · 正在 Edit main.ts · 42s` | running: tally, current call, elapsed time (ticks every second) |
| yellow | `⧗ 等待中：子代理 2、背景工作 1、排程喚醒 1` | turn ended, subagents / background tasks / scheduled wake-ups still pending |
| green | `✓ 已完成 · 5 步：讀 2、改 1 檔、指令 2（4 失敗）· 15s` | turn ended, nothing pending |
| red | `⚠ 回合已結束，但沒有任何子代理或背景工作在跑` | the reply's last paragraph says it is waiting (a fixed list of Chinese and English phrases), but nothing is running |
| red | `✕ 回合中斷 · 5 步：… · 15s` | turn interrupted, refused or errored |

The stall warning is shown on this line only: no sound, no notification, nothing is sent on your behalf. The mod makes no model calls.

## Requirements

- Claude Code with function-hook mods. Tested on **Claude Code 2.1.302, Windows 10**.
- **Fullscreen terminal.** The mod only changes the fullscreen terminal; everywhere else it leaves Claude Code's drawing alone.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install turn-digest --marketplace refinism-B/turn-digest
```

Answer `y` to add the marketplace, then choose a scope (user scope is listed first).

Or from a shell:

```
claude plugin install turn-digest --marketplace refinism-B/turn-digest
```

## Known issues

- **The failure count can be higher than the failures you see.** It counts every call Claude Code reports as an error, including shell commands that exit non-zero. Claude Code's grouped rows (`Read 2 files`, `Listed 1 directory`) do not mark which calls inside them failed.
- **Intermediate text shows briefly before it folds.** Whether a text block is intermediate is only known once the turn moves on.
- **Folding also applies in the `Ctrl+O` view.** A mod cannot tell whether that view is open, so use the summary row to expand a turn.
- **Turns from before the mod loaded are not folded.**
- **Background-task and scheduled wake-up counts depend on the `Stop` event.** `claude plugin validate` reports that, where an organization manages Claude Code, `Stop` hooks only run in plugins the organization lists in managed settings.

## License

[MIT](LICENSE)
