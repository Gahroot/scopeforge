/**
 * Structured diagnostics logging for ScopeForge boundaries (server, agent, CLI,
 * PDF render). The deterministic `src/core` engine never imports this — logging
 * touches the clock and process streams, which would break core reproducibility.
 *
 * Every record is a single line of JSON so logs stay greppable and machine-
 * parseable. Errors are serialized with their full `cause` chain, `stack`, any
 * `code`, and extra own-properties so we always know *why* a failure happened.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

type LevelSetting = LogLevel | "silent";

const LEVEL_RANK: Readonly<Record<LevelSetting, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

const DEFAULT_LEVEL: LogLevel = "info";
const MAX_CAUSE_DEPTH = 8;

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string | number;
  readonly cause?: SerializedError;
  /** Nested errors from `AggregateError`. */
  readonly errors?: readonly SerializedError[];
  /** Any extra own-enumerable properties carried on the error. */
  readonly extra?: Readonly<Record<string, unknown>>;
  /** Set when the thrown value was not an `Error` instance. */
  readonly nonError?: unknown;
}

export interface DiagnosticRecord {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly event: string;
  readonly message?: string;
  readonly error?: SerializedError;
  readonly [key: string]: unknown;
}

const STANDARD_ERROR_KEYS = new Set(["name", "message", "stack", "cause", "code", "errors"]);

/**
 * Recursively serialize any thrown value into a plain, JSON-safe shape. Captures
 * the `cause` chain (depth-limited), `AggregateError.errors`, and any extra own
 * properties an error carries (e.g. a custom `code` or `detail`).
 */
export function serializeError(value: unknown, depth: number = MAX_CAUSE_DEPTH): SerializedError {
  if (!(value instanceof Error)) {
    return {
      name: typeof value,
      message: safeStringify(value),
      nonError: jsonSafe(value),
    };
  }

  const extra = collectExtraProps(value);
  const code = (value as { code?: unknown }).code;

  const serialized: {
    name: string;
    message: string;
    stack?: string;
    code?: string | number;
    cause?: SerializedError;
    errors?: readonly SerializedError[];
    extra?: Readonly<Record<string, unknown>>;
  } = {
    name: value.name,
    message: value.message,
  };

  if (typeof value.stack === "string") serialized.stack = value.stack;
  if (typeof code === "string" || typeof code === "number") serialized.code = code;

  if (depth > 0 && value.cause !== undefined && value.cause !== null) {
    serialized.cause = serializeError(value.cause, depth - 1);
  }

  if (depth > 0 && value instanceof AggregateError && Array.isArray(value.errors)) {
    serialized.errors = value.errors.map((inner) => serializeError(inner, depth - 1));
  }

  if (Object.keys(extra).length > 0) serialized.extra = extra;

  return serialized;
}

function collectExtraProps(error: Error): Readonly<Record<string, unknown>> {
  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(error)) {
    if (STANDARD_ERROR_KEYS.has(key)) continue;
    extra[key] = jsonSafe((error as unknown as Record<string, unknown>)[key]);
  }
  return extra;
}

export function resolveLogLevel(env: NodeJS.ProcessEnv = process.env): LevelSetting {
  const raw = env.SCOPEFORGE_LOG_LEVEL?.trim().toLowerCase();
  if (raw === undefined || raw.length === 0) return DEFAULT_LEVEL;
  if (raw in LEVEL_RANK) return raw as LevelSetting;
  return DEFAULT_LEVEL;
}

export function isLevelEnabled(level: LogLevel, env: NodeJS.ProcessEnv = process.env): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[resolveLogLevel(env)];
}

/** Build a diagnostic record without emitting it (used by tests + the writers). */
export function buildRecord(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): DiagnosticRecord {
  const { error, message, ...rest } = fields;
  const base: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    event,
  };
  if (typeof message === "string") base.message = message;
  for (const [key, val] of Object.entries(rest)) {
    if (val !== undefined) base[key] = jsonSafe(val);
  }
  if (error !== undefined) base.error = serializeError(error);
  return base as DiagnosticRecord;
}

export function logEvent(
  level: LogLevel,
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  if (!isLevelEnabled(level)) return;
  const record = buildRecord(level, event, fields);
  const line = safeStringify(record);
  if (level === "warn" || level === "error") {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
}

export function logDebug(event: string, fields?: Readonly<Record<string, unknown>>): void {
  logEvent("debug", event, fields ?? {});
}

export function logInfo(event: string, fields?: Readonly<Record<string, unknown>>): void {
  logEvent("info", event, fields ?? {});
}

export function logWarn(event: string, fields?: Readonly<Record<string, unknown>>): void {
  logEvent("warn", event, fields ?? {});
}

/** Log an error-level record with the thrown value serialized under `error`. */
export function logError(
  event: string,
  error: unknown,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  logEvent("error", event, { ...fields, error });
}

let globalDiagnosticsInstalled = false;

/**
 * Install last-resort process handlers so no error of any kind goes unobserved.
 * Idempotent: safe to call from multiple entry points. Returns a disposer.
 */
export function installGlobalDiagnostics(): () => void {
  if (globalDiagnosticsInstalled) return () => undefined;
  globalDiagnosticsInstalled = true;

  const onUncaught = (error: unknown): void => {
    logError("scopeforge.process.uncaught_exception", error, { fatal: true });
  };
  const onUnhandled = (reason: unknown): void => {
    logError("scopeforge.process.unhandled_rejection", reason);
  };
  const onWarning = (warning: Error): void => {
    logWarn("scopeforge.process.warning", { error: warning });
  };

  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUnhandled);
  process.on("warning", onWarning);

  return () => {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUnhandled);
    process.off("warning", onWarning);
    globalDiagnosticsInstalled = false;
  };
}

function jsonSafe(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) return serializeError(value, 2);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = jsonSafe(val, seen);
  }
  return output;
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
