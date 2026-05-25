// Minimal main-process logger (CLAUDE.md §5: no console.log in committed code).
// It accepts only scalar/Error args by type, which keeps audio buffers and API
// keys out of the log surface by construction — never widen LogArg to ArrayBuffer.

type LogArg = string | number | boolean | null | undefined | Error;

function format(level: string, msg: string, args: LogArg[]): string {
  const extra = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
    .join(' ');
  return `[${new Date().toISOString()}] ${level} ${msg}${extra ? ' ' + extra : ''}\n`;
}

export const logger = {
  info: (msg: string, ...args: LogArg[]): void => {
    process.stdout.write(format('INFO', msg, args));
  },
  warn: (msg: string, ...args: LogArg[]): void => {
    process.stdout.write(format('WARN', msg, args));
  },
  error: (msg: string, ...args: LogArg[]): void => {
    process.stderr.write(format('ERROR', msg, args));
  },
};
