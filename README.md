# Pino Plugin - Rotating File Transport

<div align="center">
  <a href="https://www.npmjs.com/package/pino-transport-rotating-file/v/latest" target="_blank" rel="noreferrer">
    <img src="https://img.shields.io/npm/v/pino-transport-rotating-file/latest?style=for-the-badge&logo=npm&logoColor=white&color=d52128" alt="Latest NPM Version"/>
  </a>

  <a href="https://github.com/MKAbuMattar/pino-transport-rotating-file" target="_blank" rel="noreferrer">
    <img src="https://img.shields.io/badge/github-%23181717.svg?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Repository"/>
  </a>

  <a href="https://github.com/MKAbuMattar/pino-transport-rotating-file/releases" target="_blank" rel="noreferrer">
    <img alt="GitHub Release" src="https://img.shields.io/github/v/release/MKAbuMattar/pino-transport-rotating-file?color=%23d52128&label=Latest%20release&style=for-the-badge" />
  </a>

  <a href="/LICENSE" target="_blank" rel="noreferrer">
    <img alt="GitHub License" src="https://img.shields.io/github/license/MKAbuMattar/pino-transport-rotating-file?color=%23d52128&style=for-the-badge">
  </a>

  <a href="https://github.com/MKAbuMattar/pino-transport-rotating-file/stargazers" target="_blank" rel="noreferrer">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/MKAbuMattar/pino-transport-rotating-file?color=%23d52128&label=GitHub%20Stars&style=for-the-badge">
  </a>
</div>

This module provides a custom transport for the `pino` logger, enabling rotating file streams with features like size-based and time-based rotation, gzip compression, retention policies, and error logging. It's designed for production-ready logging with flexible configuration options.

## Features

- **Size-Based and Time-Based Rotation**: Rotate logs based on file size (e.g., `100K`) or time intervals (e.g., `1d`).
- **Gzip Compression**: Automatically compress rotated files with customizable `zlib` options.
- **Retention Policy**: Clean up old logs after a specified number of days (e.g., `30`).
- **Timestamp Formats**: Support for multiple filename timestamp formats (`iso`, `unix`, `utc`, `rfc2822`, `epoch`).
- **Error Logging**: Buffer and flush errors to a separate file or console with configurable intervals.
- **Pretty Printing**: Optional log formatting using `pino-pretty`.
- **Enable/Disable Toggle**: Easily enable or disable the transport without changing configuration.
- **Immutable Files**: Option to ensure rotated files remain unchanged.
- **Event Handling**: Listen for the `rotated` event to perform custom actions post-rotation.

## Installation

Install the package via npm:

```bash
npm install pino pino-transport-rotating-file rotating-file-stream pino-pretty
```

If you're using `yarn`, run:

```bash
yarn add pino pino-transport-rotating-file rotating-file-stream pino-pretty
```

If you're using `pnpm`, run:

```bash
pnpm add pino pino-transport-rotating-file rotating-file-stream pino-pretty
```

## Usage

Here’s a basic example of integrating the transport with `pino`:

```typescript
import { join } from "node:path";
import { pino, type LoggerOptions } from "pino";

const loggerOptions: LoggerOptions = {
  name: "my-app",
  level: "info",
  transport: {
    targets: [
      {
        level: "info",
        target: "pino-pretty", // Optional: for console output
        options: { colorize: true },
      },
      {
        level: "info",
        target: "pino-transport-rotating-file",
        options: {
          dir: join(process.cwd(), "logs"),
          filename: "app",
          enabled: true,
          size: "100K",
          interval: "1d",
          compress: true,
          immutable: true,
          retentionDays: 30,
          compressionOptions: { level: 6, strategy: 0 },
          errorLogFile: join(process.cwd(), "logs", "errors.log"),
          timestampFormat: "iso",
          skipPretty: false,
          errorFlushIntervalMs: 1000,
        },
      },
    ],
  },
};

const logger = pino(loggerOptions);

logger.info("Server started");
logger.error("An error occurred");
```

### Multi-Level Logging Example

You can configure the transport for different log levels, as shown in `playground/index.ts`:

```typescript
import { join } from "node:path";
import { pino, type Level, type LoggerOptions } from "pino";

const levels: Level[] = ["trace", "debug", "info", "warn", "error", "fatal"];

const createTransportOptions = (filename: string) => ({
  dir: join(process.cwd(), "logs"),
  filename,
  enabled: true,
  size: "100K",
  interval: "1d",
  compress: true,
  immutable: true,
  retentionDays: 30,
  compressionOptions: { level: 6, strategy: 0 },
  errorLogFile: join(process.cwd(), "logs", "errors.log"),
  timestampFormat: "iso",
  skipPretty: false,
  errorFlushIntervalMs: 1000,
});

const loggerOptions: LoggerOptions = {
  name: "playground",
  level: "trace",
  transport: {
    targets: [
      { level: "trace", target: "pino-pretty", options: { colorize: true } },
      ...levels.map((level) => ({
        level,
        target: "pino-transport-rotating-file",
        options: createTransportOptions(level === "trace" ? "all" : level),
      })),
    ],
  },
};

const logger = pino(loggerOptions);

(async () => {
  for (let i = 0; i < 5; i++) {
    logger.trace(`Trace message ${i}`);
    logger.debug(`Debug message ${i}`);
    logger.info(`Info message ${i}`);
    logger.warn(`Warn message ${i}`);
    logger.error(`Error message ${i}`);
    logger.fatal(`Fatal message ${i}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  logger.info("Logging complete");
})();
```

## Configuration Options

The transport accepts the following options:

|         Option         |   Type    |        Default Value        |                                                              Description                                                               |
| :--------------------: | :-------: | :-------------------------: | :------------------------------------------------------------------------------------------------------------------------------------: |
|         `dir`          | `string`  |        **Required**         |                                               The directory where log files are stored.                                                |
|       `filename`       | `string`  |            `app`            |                                                    The base filename for log files.                                                    |
|       `enabled`        | `boolean` |           `true`            |                                                    Enable or disable the transport.                                                    |
|         `size`         | `string`  |           `100K`            |                                     File size threshold for rotation (e.g., `100K`, `1M`, `10G`).                                      |
|       `interval`       | `string`  |            `1d`             |                              Time interval for rotation (e.g., `1s`, `1m`, `1h`, `1d`, `1w`, `1M`, `1y`).                              |
|       `compress`       | `boolean` |           `true`            |                                              Enables gzip compression for rotated files.                                               |
|      `immutable`       | `boolean` |           `true`            |                                                Prevents modification of rotated files.                                                 |
|    `retentionDays`     | `number`  |            `30`             |                                  Days to retain logs before deletion (set to `0` to disable cleanup).                                  |
|  `compressionOptions`  | `object`  | `{ level: 6, strategy: 0 }` | Options for `zlib` compression (e.g., `{ level: 6, strategy: 0 }`) (see Node.js `zlib` [docs](https://nodejs.org/api/zlib.html#zlib)). |
|     `errorLogFile`     | `string`  |         `undefined`         |                                        Path to error log file; if unset, errors go to `stderr`.                                        |
|   `timestampFormat`    | `string`  |            `iso`            |                                            Format for timestamps in filenames (see below).                                             |
|      `skipPretty`      | `boolean` |           `false`           |                                            Skips `pino-pretty` formatting for performance.                                             |
| `errorFlushIntervalMs` | `number`  |     `60000` (1 minute)      |                                    Interval in milliseconds to flush errors to the error log file.                                     |

### Supported Timestamp Formats

The transport supports the following timestamp formats for rotated files:

- `iso`: `YYYYMMDDHHMMSS` (e.g., `app-20250322123456.log`)
- `unix`: Milliseconds since epoch (e.g., `app-1742582096000.log`)
- `utc`: Sanitized UTC string (e.g., `app-Sat-22-Mar-2025-12-34-56-GMT.log`)
- `rfc2822`: Sanitized RFC 2822 string (e.g., `app-Sat-22-Mar-2025-12-34-56-GMT-0500-EDT.log`)
- `epoch`: Seconds since epoch (e.g., `app-1742582096.log`)

### Size and Interval Units

- **Size Units**: `K` (KB), `M` (MB), `G` (GB), `T` (TB), `P` (PB), `E` (EB)
- **Time Units**: `s` (seconds), `m` (minutes), `h` (hours), `d` (days), `w` (weeks), `M` (months), `y` (years)

### File Rotation and Events

- **Rotation Triggers**: Files rotate when they reach the size limit or interval expires.
- **Compression**: Rotated files are compressed to `.gz` if `compress` is `true`, and the original is deleted.
- **Retention**: Files older than `retentionDays` are deleted daily.
- **Filename Pattern**: `${filename}-${timestamp}.log` (capped at 200 characters).

## License

This project is licensed under the MIT License. See the [LICENSE](/LICENSE) file for details.
