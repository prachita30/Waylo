import pino from 'pino';

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } } : {}),
  });
}
export type Logger = ReturnType<typeof createLogger>;
