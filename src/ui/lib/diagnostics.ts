export interface ClientDiagnosticBreadcrumb {
  readonly timestamp: string;
  readonly event: string;
  readonly [key: string]: unknown;
}

const DEFAULT_MAX_BREADCRUMBS = 80;
let breadcrumbs: ClientDiagnosticBreadcrumb[] = [];

export function addClientBreadcrumb(
  event: string,
  fields: Readonly<Record<string, unknown>> = {},
): ClientDiagnosticBreadcrumb {
  const crumb: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    event,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) crumb[key] = jsonSafe(value);
  }
  const built = crumb as ClientDiagnosticBreadcrumb;
  breadcrumbs = [...breadcrumbs, built].slice(-DEFAULT_MAX_BREADCRUMBS);
  return built;
}

export function getClientBreadcrumbs(): readonly ClientDiagnosticBreadcrumb[] {
  return breadcrumbs;
}

export function clearClientBreadcrumbs(): void {
  breadcrumbs = [];
}

export function logClientError(
  event: string,
  error: unknown,
  fields: Readonly<Record<string, unknown>> = {},
): void {
  const record = {
    timestamp: new Date().toISOString(),
    level: "error",
    event,
    fields: jsonSafe(fields),
    error: serializeClientError(error),
    breadcrumbs,
  };
  console.error(JSON.stringify(record));
}

function serializeClientError(error: unknown): Readonly<Record<string, unknown>> {
  if (!(error instanceof Error)) {
    return {
      name: typeof error,
      message: String(error),
      value: jsonSafe(error),
    };
  }
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: "cause" in error ? serializeClientError(error.cause) : undefined,
  };
}

function jsonSafe(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (value instanceof Error) return serializeClientError(value);
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => jsonSafe(item, seen));

  const output: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    output[key] = jsonSafe(val, seen);
  }
  return output;
}
