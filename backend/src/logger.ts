import { getConfig } from './config.ts';

/**
 * A deliberately tiny structured logger.
 *
 * Request logs carry the `X-Request-Id`, because that is the id the contract tells
 * clients to quote in bug reports — it is only useful if it appears in the logs.
 *
 * Nothing here ever receives a password or a token: the call sites pass ids and codes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  readonly [key: string]: unknown;
}

function emit(level: LogLevel, message: string, fields: LogFields): void {
  const { logFormat } = getConfig();
  if (logFormat === 'silent') return;

  if (logFormat === 'json') {
    process.stdout.write(
      `${JSON.stringify({ level, time: new Date().toISOString(), message, ...fields })}\n`,
    );
    return;
  }

  const suffix = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  process.stdout.write(
    `${level.toUpperCase().padEnd(5)} ${message}${suffix ? ` ${suffix}` : ''}\n`,
  );
}

export const logger = {
  debug: (message: string, fields: LogFields = {}) => emit('debug', message, fields),
  info: (message: string, fields: LogFields = {}) => emit('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => emit('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => emit('error', message, fields),
};
