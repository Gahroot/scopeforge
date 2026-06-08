import {
  addBreadcrumb,
  buildRecord,
  clearBreadcrumbs,
  getBreadcrumbs,
  installGlobalDiagnostics,
  isLevelEnabled,
  logError,
  resolveLogLevel,
  serializeError,
} from "./logger.node.js";

describe("serializeError", () => {
  it("captures name, message, stack, and a custom code", () => {
    const error = Object.assign(new Error("boom"), { code: "E_BOOM" });
    const serialized = serializeError(error);

    expect(serialized.name).toBe("Error");
    expect(serialized.message).toBe("boom");
    expect(serialized.code).toBe("E_BOOM");
    expect(typeof serialized.stack).toBe("string");
  });

  it("walks the cause chain so the root cause is never lost", () => {
    const root = new Error("disk is full");
    const wrapped = new Error("could not write proposal", { cause: root });

    const serialized = serializeError(wrapped);

    expect(serialized.message).toBe("could not write proposal");
    expect(serialized.cause?.message).toBe("disk is full");
  });

  it("expands AggregateError children", () => {
    const aggregate = new AggregateError([new Error("a"), new Error("b")], "both failed");

    const serialized = serializeError(aggregate);

    expect(serialized.errors?.map((inner) => inner.message)).toEqual(["a", "b"]);
  });

  it("captures extra own properties as JSON-safe values", () => {
    const error = Object.assign(new Error("brand fetch failed"), {
      url: "https://example.com",
      detail: "timeout",
    });

    const serialized = serializeError(error);

    expect(serialized.extra).toEqual({ url: "https://example.com", detail: "timeout" });
  });

  it("represents non-Error throws without losing the value", () => {
    const serialized = serializeError("just a string");

    expect(serialized.name).toBe("string");
    expect(serialized.message).toBe("just a string");
    expect(serialized.nonError).toBe("just a string");
  });

  it("does not recurse forever on circular extra props", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const error = Object.assign(new Error("loop"), { ctx: circular });

    const serialized = serializeError(error);

    expect(serialized.extra).toEqual({ ctx: { self: "[Circular]" } });
  });
});

describe("resolveLogLevel / isLevelEnabled", () => {
  it("defaults to info when unset or invalid", () => {
    expect(resolveLogLevel({})).toBe("info");
    expect(resolveLogLevel({ SCOPEFORGE_LOG_LEVEL: "nonsense" })).toBe("info");
  });

  it("honors a configured level", () => {
    expect(resolveLogLevel({ SCOPEFORGE_LOG_LEVEL: "debug" })).toBe("debug");
    expect(resolveLogLevel({ SCOPEFORGE_LOG_LEVEL: " WARN " })).toBe("warn");
  });

  it("gates lower levels when threshold is higher", () => {
    expect(isLevelEnabled("debug", { SCOPEFORGE_LOG_LEVEL: "warn" })).toBe(false);
    expect(isLevelEnabled("error", { SCOPEFORGE_LOG_LEVEL: "warn" })).toBe(true);
    expect(isLevelEnabled("info", { SCOPEFORGE_LOG_LEVEL: "silent" })).toBe(false);
  });
});

describe("buildRecord", () => {
  it("includes event, level, and serialized error but drops undefined fields", () => {
    clearBreadcrumbs();
    const record = buildRecord("error", "scopeforge.test.failure", {
      error: new Error("nope"),
      pathname: "/api/x",
      missing: undefined,
    });

    expect(record.level).toBe("error");
    expect(record.event).toBe("scopeforge.test.failure");
    expect(record.pathname).toBe("/api/x");
    expect("missing" in record).toBe(false);
    expect(record.error?.message).toBe("nope");
    expect(typeof record.timestamp).toBe("string");
  });

  it("attaches breadcrumbs to error records", () => {
    clearBreadcrumbs();
    addBreadcrumb("scopeforge.test.step", { pathname: "/api/x" });

    const record = buildRecord("error", "scopeforge.test.failure", { error: new Error("nope") });

    expect(record.breadcrumbs).toEqual([
      expect.objectContaining({ event: "scopeforge.test.step", pathname: "/api/x" }),
    ]);
    clearBreadcrumbs();
  });
});


describe("breadcrumbs", () => {
  it("keeps a bounded trail of JSON-safe diagnostic steps", () => {
    const priorLimit = process.env.SCOPEFORGE_LOG_BREADCRUMBS;
    process.env.SCOPEFORGE_LOG_BREADCRUMBS = "2";
    clearBreadcrumbs();

    addBreadcrumb("scopeforge.test.one");
    addBreadcrumb("scopeforge.test.two", { detail: { nested: true } });
    addBreadcrumb("scopeforge.test.three");

    expect(getBreadcrumbs().map((crumb) => crumb.event)).toEqual([
      "scopeforge.test.two",
      "scopeforge.test.three",
    ]);

    clearBreadcrumbs();
    if (priorLimit === undefined) delete process.env.SCOPEFORGE_LOG_BREADCRUMBS;
    else process.env.SCOPEFORGE_LOG_BREADCRUMBS = priorLimit;
  });
});

describe("installGlobalDiagnostics", () => {
  it("is idempotent and removes its own handlers on dispose", () => {
    const before = process.listenerCount("uncaughtException");
    const disposeA = installGlobalDiagnostics();
    const disposeB = installGlobalDiagnostics();
    expect(process.listenerCount("uncaughtException")).toBe(before + 1);

    disposeB();
    disposeA();
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});

describe("logError", () => {
  it("writes a single JSON line to stderr", () => {
    const written: string[] = [];
    const priorLevel = process.env.SCOPEFORGE_LOG_LEVEL;
    process.env.SCOPEFORGE_LOG_LEVEL = "error";
    const original = process.stderr.write.bind(process.stderr);
    // biome-ignore lint/suspicious/noExplicitAny: test shim for stream write
    process.stderr.write = ((chunk: any): boolean => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      logError("scopeforge.test.boundary", new Error("kaboom"), { pathname: "/api/y" });
    } finally {
      process.stderr.write = original;
      if (priorLevel === undefined) delete process.env.SCOPEFORGE_LOG_LEVEL;
      else process.env.SCOPEFORGE_LOG_LEVEL = priorLevel;
    }

    expect(written).toHaveLength(1);
    const line = written[0] ?? "";
    expect(line.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    expect(parsed.event).toBe("scopeforge.test.boundary");
    expect(parsed.pathname).toBe("/api/y");
    expect((parsed.error as { message: string }).message).toBe("kaboom");
  });
});
