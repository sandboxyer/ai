import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export async function forceCleanAllReadlineInterfaces() {
  // Step 1: Force close stdin raw mode immediately
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (e) {}
    try { process.stdin.pause(); } catch (e) {}
    try { process.stdin.resume(); } catch (e) {}
  }

  // Step 2: Remove ALL listeners from stdin/stdout
  try { process.stdin.removeAllListeners(); } catch (e) {}
  try { process.stdout.removeAllListeners(); } catch (e) {}

  // Step 3: Remove signal handlers that readline adds
  const signals = ['SIGINT', 'SIGTSTP', 'SIGCONT', 'SIGTERM'];
  for (const signal of signals) {
    try {
      process.removeAllListeners(signal);
    } catch (e) {}
  }

  // Step 4: Clear the readline module cache to force fresh instances
  try {
    const readlinePath = require.resolve('readline');
    if (readlinePath) {
      delete require.cache[readlinePath];
      // Also clear any cached modules that might hold readline references
      Object.keys(require.cache).forEach(key => {
        if (key.includes('readline') || key.includes('TerminalHUD') || key.includes('ChatHUD')) {
          delete require.cache[key];
        }
      });
    }
  } catch (e) {}

  // Step 5: Reset stdin state
  if (process.stdin._readableState) {
    try {
      process.stdin._readableState.reading = false;
      process.stdin._readableState.flowing = null;
    } catch (e) {}
  }

  // Step 6: Force garbage collection if available
  if (global.gc) {
    try { global.gc(); } catch (e) {}
  }

  // Step 7: Small delay to let Node.js process the cleanup
  await new Promise(resolve => setTimeout(resolve, 100));

  return true;
}