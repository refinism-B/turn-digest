import type { Register } from 'claude-code'
import { registerBand } from './band'
import { registerFolding } from './fold'
import { registerRecording } from './record'
import { registerStatusLine } from './statusline'

export const register: Register = on => {
  registerRecording(on)
  registerFolding(on)
  registerBand(on)
  registerStatusLine(on)
}
