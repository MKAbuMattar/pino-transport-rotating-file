import {join} from 'node:path';
import {
  type Level,
  type LoggerOptions,
  pino,
  type TransportPipelineOptions,
  type TransportTargetOptions,
} from 'pino';
import type {PinoTransportOptions} from '../src/index';

const levels = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] satisfies Array<Level>;

const createTransportOptions = (filename: string): PinoTransportOptions =>
  ({
    dir: join(process.cwd(), 'logs'),
    filename,
    enabled: true,
    size: '100K',
    interval: '1d',
    compress: true,
    immutable: true,
    retentionDays: 30,
    compressionOptions: {
      level: 6,
      strategy: 0,
    },
    errorLogFile: join(process.cwd(), 'logs', 'errors.log'),
    timestampFormat: 'iso',
    skipPretty: false,
    errorFlushIntervalMs: 60_000,
  }) satisfies PinoTransportOptions;

const targets: Array<TransportTargetOptions | TransportPipelineOptions> =
  levels.map((level: Level) => ({
    level,
    target: '../src/index',
    options: createTransportOptions(level === 'trace' ? 'all' : level),
  }));

export const loggerOptions: LoggerOptions = {
  name: 'playground',
  level: 'trace',
  transport: {
    targets: [
      {
        level: 'trace',
        target: 'pino-pretty',
        options: {colorize: true},
      },
      ...targets,
    ],
  },
} satisfies LoggerOptions;

const logger = pino(loggerOptions);

(async () => {
  let i = 0;
  const MAX_ITERATIONS = 10_000_000;
  while (i < MAX_ITERATIONS) {
    logger.trace(`[TRACE] This is a trace message ${i}`);
    logger.debug(`[DEBUG] This is a debug message ${i}`);
    logger.info(`[INFO] This is an info message ${i}`);
    logger.warn(`[WARN] This is a warn message ${i}`);
    logger.error(`[ERROR] This is an error message ${i}`);
    logger.fatal(`[FATAL] This is a fatal message ${i}`);
    i++;
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  logger.info('Logging complete.');
})();
