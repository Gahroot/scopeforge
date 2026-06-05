/**
 * Vitest global setup: silence ScopeForge diagnostics during tests so failure-
 * path assertions don't flood the reporter with intentional error logs. Tests
 * that assert on logging set their own level or stub the stream writers.
 */
process.env.SCOPEFORGE_LOG_LEVEL ??= "silent";
