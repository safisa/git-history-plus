/** macOS keeps Ctrl+F for "forward one character", so find is Cmd+F there and Ctrl+F elsewhere. */
export const isMac = (): boolean => /Mac|iPhone|iPad/.test(navigator.platform);
