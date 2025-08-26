import {Buffer} from 'node:buffer';
import {createReadStream, createWriteStream} from 'node:fs';
import {access, readdir, stat, unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {pipeline, Transform, type TransformCallback} from 'node:stream';
import {promisify} from 'node:util';
import {createGzip, type ZlibOptions} from 'node:zlib';
import build, {type OnUnknown} from 'pino-abstract-transport';
import {prettyFactory} from 'pino-pretty';
import {createStream, type RotatingFileStream} from 'rotating-file-stream';

type CreateErrorLogger = {
  log: (message: string, error?: unknown) => void;
  destroy: () => void;
};

// Types that match rotating-file-stream expectations
type StorageUnit = 'B' | 'K' | 'M' | 'G';
type TimeUnit = 's' | 'm' | 'h' | 'd' | 'M';
type Size = `${number}${StorageUnit}`;
type Interval = `${number}${TimeUnit}`;
type TimestampFormat = 'iso' | 'unix' | 'utc' | 'rfc2822' | 'epoch';

export interface PinoTransportOptions {
  dir: string;
  filename: string;
  enabled: boolean;
  size: Size;
  interval: Interval;
  compress: boolean;
  immutable: boolean;
  retentionDays?: number;
  compressionOptions?: ZlibOptions;
  errorLogFile?: string;
  timestampFormat?: TimestampFormat;
  skipPretty?: boolean;
  errorFlushIntervalMs?: number;
}

/** @typedef {import('node:stream').TransformCallback} TransformCallback */
/** @typedef {import('node:zlib').ZlibOptions} ZlibOptions */
/** @typedef {import('pino-abstract-transport').OnUnknown} OnUnknown */
/** @typedef {import('rotating-file-stream').RotatingFileStream} RotatingFileStream */

/**
 * @typedef {Object} CreateErrorLogger
 * @property {(message: string, error?: unknown) => void} log - Logs an error message.
 * @property {() => void} destroy - Destroys the error logger.
 */

/**
 * @typedef {'B' | 'K' | 'M' | 'G'} StorageUnit
 * @typedef {'s' | 'm' | 'h' | 'd' | 'M'} TimeUnit
 * @typedef {`${number}${StorageUnit}`} Size
 * @typedef {`${number}${TimeUnit}`} Interval
 * @typedef {'iso' | 'unix' | 'utc' | 'rfc2822' | 'epoch'} TimestampFormat
 */

/**
 * @typedef {Object} PinoTransportOptions
 * @property {string} dir - The directory to store the log files.
 * @property {string} filename - The base filename for the log files.
 * @property {boolean} enabled - Whether the transport is enabled.
 * @property {Size} size - The size at which to rotate the log files.
 * @property {Interval} interval - The interval at which to rotate the log files.
 * @property {boolean} compress - Whether to compress the log files.
 * @property {boolean} immutable - Whether to use immutable log files.
 * @property {number} [retentionDays=30] - The number of days to retain log files.
 * @property {ZlibOptions} [compressionOptions] - The options to use for compression.
 * @property {string} [errorLogFile] - The path to the error log file.
 * @property {TimestampFormat} [timestampFormat='iso'] - The format to use for the timestamp.
 * @property {boolean} [skipPretty=false] - Whether to skip pretty formatting.
 * @property {number} [errorFlushIntervalMs=60000] - The interval at which to flush the error log buffer.
 */

/**
 * @constant {Function} pipelineAsync
 * @description Promisified version of the Node.js pipeline function for handling streams.
 */
const pipelineAsync = promisify(pipeline);

/**
 * @constant {Record<StorageUnit, number>} sizeUnits
 * @description The conversion factor for storage units.
 */
const sizeUnits: Record<StorageUnit, number> = {
  B: 1,
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
};

/**
 * @constant {Record<TimeUnit, number>} timeUnits
 * @description The conversion factor for time units.
 */
const timeUnits: Record<TimeUnit, number> = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
  M: 30 * 24 * 60 * 60 * 1000,
};

/**
 * @function validateSize
 * @description Validates the size option for the rotating log file.
 *
 * @param {Size} size - The size option to validate.
 */
function validateSize(size: Size): void {
  const match = /^(\d+)([BKMG])$/.exec(size);
  if (!match)
    throw new Error(
      `Invalid size format: ${size}. Expected format: <number><B|K|M|G>`,
    );
  const [_, num, unit] = match;
  if (Number.parseInt(num, 10) <= 0)
    throw new Error(`Size must be positive: ${size}`);
  if (!sizeUnits[unit as StorageUnit])
    throw new Error(`Unknown size unit: ${unit}`);
}

/**
 * @function validateInterval
 * @description Validates the interval option for the rotating log file.
 *
 * @param {Interval} interval - The interval option to validate.
 */
function validateInterval(interval: Interval): void {
  const match = /^(\d+)([smhdM])$/.exec(interval);
  if (!match)
    throw new Error(
      `Invalid interval format: ${interval}. Expected format: <number><s|m|h|d|M>`,
    );
  const [_, num, unit] = match;
  if (Number.parseInt(num, 10) <= 0)
    throw new Error(`Interval must be positive: ${interval}`);
  if (!timeUnits[unit as TimeUnit])
    throw new Error(`Unknown time unit: ${unit}`);
}

/**
 * @function validateTimestampFormat
 * @description Validates the timestampFormat option for the rotating log file.
 *
 * @param {TimestampFormat} format - The timestampFormat option to validate.
 */
function validateTimestampFormat(format: TimestampFormat): void {
  const validFormats: TimestampFormat[] = [
    'iso',
    'unix',
    'utc',
    'rfc2822',
    'epoch',
  ];
  if (!validFormats.includes(format)) {
    throw new Error(
      `Invalid timestampFormat: ${format}. Expected one of: ${validFormats.join(', ')}`,
    );
  }
}

/**
 * @function generator
 * @description Generates the file path for the rotating log file.
 *
 * @param {number | Date | null} time - The time to use in the filename.
 * @param {string} dir - The directory to store the log files.
 * @param {string} filename - The base filename for the log files.
 * @param {TimestampFormat} timestampFormat - The format to use for the timestamp.
 *
 * @returns {string} The generated file path.
 */
function generator(
  time: number | Date | null,
  dir: string,
  filename: string,
  timestampFormat: TimestampFormat = 'iso',
): string {
  if (!time) return join(dir, `${filename}.log`);
  const _date = new Date(time);
  let timestamp: string;

  switch (timestampFormat) {
    case 'iso':
      timestamp = _date.toISOString().replace(/[-:T]/g, '').split('.')[0];
      break;
    case 'unix':
      timestamp = _date.getTime().toString();
      break;
    case 'utc':
      timestamp = _date
        .toUTCString()
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .trim();
      break;
    case 'rfc2822':
      timestamp = _date
        .toString()
        .replace(/[^a-zA-Z0-9]/g, '-')
        .replace(/-+/g, '-')
        .trim();
      break;
    case 'epoch':
      timestamp = (_date.getTime() / 1000).toFixed(0);
      break;
    default:
      timestamp = _date.toISOString().replace(/[-:T]/g, '').split('.')[0];
      break;
  }

  const fullName = `${filename}-${timestamp}.log`;
  return join(dir, fullName.length > 200 ? fullName.slice(0, 200) : fullName);
}

/**
 * @function fileExists
 * @description Checks if a file exists at the given path.
 *
 * @param {string} path - The path to the file.
 *
 * @returns {Promise<boolean>} A promise that resolves to true if the file exists, otherwise false.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @function createErrorLogger
 * @description Creates a logger for handling errors during compression and cleanup.
 *
 * @param {string} errorLogFile - The path to the error log file.
 * @param {number} bufferSize - The maximum number of log messages to buffer before flushing.
 * @param {number} flushIntervalMs - The interval at which to flush the log buffer.
 *
 * @returns {CreateErrorLogger} The error logger instance.
 */
const createErrorLogger = (
  errorLogFile?: string,
  bufferSize = 100,
  flushIntervalMs = 60 * 1000,
): CreateErrorLogger => {
  let buffer: string[] = [];
  let flushInterval: NodeJS.Timeout | null = null;

  /**
   * @function flush
   * @description Flushes the log buffer to the error log file.
   *
   * @returns {void}
   */
  const flush = (): void => {
    if (buffer.length === 0) return;
    const logMessage = buffer.join('');
    buffer = [];
    if (errorLogFile) {
      createWriteStream(errorLogFile, {flags: 'a'}).write(logMessage);
    } else {
      console.error(logMessage);
    }
  };

  /**
   * @function startFlushInterval
   * @description Starts the interval for flushing the log buffer.
   *
   * @returns {void}
   */
  const startFlushInterval = (): void => {
    flushInterval = setInterval(flush, flushIntervalMs);
  };

  startFlushInterval();

  /**
   * @function log
   * @description Logs an error message to the error log file.
   *
   * @param {string} message - The error message to log.
   * @param {unknown} error - The error object to log.
   *
   * @returns {void}
   */
  const log = (message: string, error?: unknown): void => {
    const logMessage = `${new Date().toISOString()} - ${message}${error ? `: ${error}` : ''}\n`;
    buffer = [...buffer, logMessage];
    if (buffer.length >= bufferSize) flush();
  };

  const destroy = (): void => {
    flush();
    if (flushInterval) clearInterval(flushInterval);
  };

  return {log, destroy};
};

/**
 * @function compressFile
 * @description Compresses a file using gzip and writes the compressed file to the destination.
 *
 * @param {string} src - The path to the source file.
 * @param {string} dest - The path to the destination file.
 * @param {ZlibOptions} compressionOptions - The options to use for the compression.
 * @param {CreateErrorLogger} errorLogger - The error logger instance.
 *
 * @returns {Promise<void>} A promise that resolves once the file has been compressed.
 */
async function compressFile(
  src: string,
  dest: string,
  compressionOptions: ZlibOptions,
  errorLogger: ReturnType<typeof createErrorLogger>,
): Promise<void> {
  try {
    const exists = await fileExists(src);
    if (!exists) {
      errorLogger.log(`Skipping compression, file does not exist: ${src}`);
      return;
    }

    const stats = await stat(src);
    if (stats.isDirectory()) {
      errorLogger.log(`Skipping compression, source is a directory: ${src}`);
      return;
    }

    await pipelineAsync(
      createReadStream(src),
      createGzip(compressionOptions),
      createWriteStream(dest),
    );

    if (!(await fileExists(dest))) {
      throw new Error(`Compression failed: Destination file ${dest} not found`);
    }

    await unlink(src);
  } catch (error) {
    errorLogger.log(`Error compressing file ${src}`, error);
    throw error;
  }
}

/**
 * @function cleanupOldFiles
 * @description Cleans up old log files in the directory based on the retention period.
 *
 * @param {string} dir - The directory to clean up.
 * @param {string} filename - The base filename for the log files.
 * @param {number} retentionDays - The number of days to retain log files.
 * @param {CreateErrorLogger} errorLogger - The error logger instance.
 *
 * @returns {Promise<void>} A promise that resolves once the old files have been cleaned up.
 */
async function cleanupOldFiles(
  dir: string,
  filename: string,
  retentionDays: number,
  errorLogger: ReturnType<typeof createErrorLogger>,
): Promise<void> {
  try {
    const files = await readdir(dir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

    await Promise.all(
      files
        .filter(
          (file) =>
            file.startsWith(filename) &&
            (file.endsWith('.log') || file.endsWith('.log.gz')),
        )
        .map(async (file) => {
          const filePath = join(dir, file);
          const stats = await stat(filePath);
          if (stats.mtimeMs < cutoff) {
            await unlink(filePath);
            errorLogger.log(`Deleted old log file: ${filePath}`);
          }
        }),
    );
  } catch (error) {
    errorLogger.log(`Error during log file cleanup in ${dir}`, error);
  }
}

/**
 * @function pinoTransportRotatingFile
 * @description Creates a Pino transport for rotating log files.
 *
 * @param {Partial<PinoTransportOptions>} options - The options for the rotating log file transport.
 *
 * @returns {Promise<Transform & OnUnknown>} A promise that resolves to the transport instance.
 */
export async function pinoTransportRotatingFile(
  options: Partial<PinoTransportOptions> = {
    dir: '',
    filename: 'app',
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
    errorLogFile: undefined,
    timestampFormat: 'iso',
    skipPretty: false,
    errorFlushIntervalMs: 60 * 1000,
  },
): Promise<Transform & OnUnknown> {
  const {
    dir,
    filename = 'app',
    enabled = true,
    size = '100K',
    interval = '1d',
    compress = true,
    immutable = true,
    retentionDays = 30,
    compressionOptions = {
      level: 6,
      strategy: 0,
    },
    errorLogFile,
    timestampFormat = 'iso',
    skipPretty = false,
    errorFlushIntervalMs = 60 * 1000,
  } = options;

  if (!enabled) {
    return build((source) => source, {
      parse: 'lines',
      expectPinoConfig: true,
      // @ts-expect-error
      enablePipelining: false,
      close() {},
    });
  }

  if (!dir) throw new Error('Missing required option: dir');
  validateSize(size);
  validateInterval(interval);
  validateTimestampFormat(timestampFormat);

  const errorLogger = createErrorLogger(
    errorLogFile,
    100,
    errorFlushIntervalMs,
  );
  const rotatingStream: RotatingFileStream = createStream(
    (time) => generator(time, dir, filename, timestampFormat),
    {size, interval, immutable},
  );

  const compressedFiles = new Map<string, number>();
  const MAX_COMPRESSION_AGE = 24 * 60 * 60 * 1000;

  if (compress) {
    rotatingStream.on('rotated', async (rotatedFile: string) => {
      try {
        if (compressedFiles.has(rotatedFile)) return;
        const isFile = (await stat(rotatedFile)).isFile();
        if (isFile) {
          const compressedFile = `${rotatedFile}.gz`;
          await compressFile(
            rotatedFile,
            compressedFile,
            compressionOptions,
            errorLogger,
          );
          compressedFiles.set(rotatedFile, Date.now());
          setTimeout(
            () => compressedFiles.delete(rotatedFile),
            MAX_COMPRESSION_AGE,
          );
        } else {
          errorLogger.log(
            `Skipping compression, rotated file is a directory: ${rotatedFile}`,
          );
        }
      } catch (err) {
        errorLogger.log(`Error compressing rotated file ${rotatedFile}`, err);
      }
    });
  }

  let cleanupInterval: NodeJS.Timeout | undefined;
  if (retentionDays > 0) {
    await cleanupOldFiles(dir, filename, retentionDays, errorLogger);
    cleanupInterval = setInterval(
      () => cleanupOldFiles(dir, filename, retentionDays, errorLogger),
      24 * 60 * 60 * 1000,
    );
  }

  return build(
    (source: Transform & OnUnknown) => {
      const prettyStream = skipPretty
        ? source
        : new Transform({
            objectMode: true,
            autoDestroy: true,
            transform(
              chunk: string | Buffer<ArrayBufferLike> | ArrayBufferView,
              encoding: BufferEncoding,
              callback: TransformCallback,
            ) {
              try {
                const logMessage = Buffer.isBuffer(chunk)
                  ? chunk.toString(encoding)
                  : chunk;
                const prettyLog = prettyFactory({colorize: false})(logMessage);
                callback(null, prettyLog);
              } catch (error) {
                callback(
                  error instanceof Error
                    ? error
                    : new Error(String(error) || 'An unknown error occurred'),
                );
              }
            },
          });

      pipeline(source, prettyStream, rotatingStream, (err) => {
        if (err) errorLogger.log('Failed to write log in transport', err);
      });

      return prettyStream;
    },
    {
      parse: 'lines',
      expectPinoConfig: true,
      // @ts-expect-error
      enablePipelining: false,
      async close() {
        errorLogger.destroy();
        if (cleanupInterval) clearInterval(cleanupInterval);
        await new Promise<void>((resolve) =>
          rotatingStream.end(() => resolve()),
        );
      },
    },
  );
}

export default pinoTransportRotatingFile;
