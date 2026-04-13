/**
 * Terminal Detector — identifies the host terminal emulator.
 *
 * Reads process.env.TERM_PROGRAM and returns a normalised string.
 */

/**
 * Detect the current terminal emulator.
 *
 * @returns {'iterm' | 'terminal-app' | 'kitty' | 'wezterm' | 'generic'}
 */
export function detectTerminal() {
  const termProgram = process.env.TERM_PROGRAM ?? '';

  switch (termProgram) {
    case 'iTerm.app':
      return 'iterm';
    case 'Apple_Terminal':
      return 'terminal-app';
    case 'kitty':
      return 'kitty';
    case 'WezTerm':
      return 'wezterm';
    default:
      return 'generic';
  }
}
