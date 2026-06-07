import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type { ViteDevServer } from "vite";
import {
  readAgentConfigFromEnv,
  summarizeAgentConfig,
  type AgentConfig,
  type AgentConfigEnv,
  type AgentConfigSummary,
} from "../agent/config.node.js";
import { createSessionStore, type SessionStore } from "../agent/session.node.js";
import { installGlobalDiagnostics, logError, logEvent } from "../diagnostics/logger.node.js";
import { handleAgentMessages } from "./agentStream.node.js";
import { handleApiRoute, type ApiRouteResponse, type AppRouteDependencies } from "./routes.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;
const DEFAULT_STATIC_DIR = "dist";
const MAX_JSON_BYTES = 4 * 1024 * 1024;

export interface AppServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly root?: string;
  readonly staticDir?: string;
  readonly devUi?: boolean;
  readonly routes?: AppRouteDependencies;
  readonly agentConfig?: AgentConfig;
  readonly agentEnv?: AgentConfigEnv;
}

export interface RunningAppServer {
  readonly host: string;
  readonly port: number;
  readonly url: string;
  readonly agent: AgentConfigSummary;
  readonly close: () => Promise<void>;
}

interface RequestContext {
  readonly staticDir: string;
  readonly routes: AppRouteDependencies;
  readonly agentConfig: AgentConfig;
  readonly sessions: SessionStore;
  vite: ViteDevServer | null;
}

type JsonBodyResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: ApiRouteResponse };

interface CliOptions {
  readonly serverOptions: AppServerOptions;
  readonly help: boolean;
}

export async function startAppServer(options: AppServerOptions = {}): Promise<RunningAppServer> {
  installGlobalDiagnostics();
  const agentConfig =
    options.agentConfig ?? readAgentConfigFromEnv(options.agentEnv ?? process.env);
  const agentSummary = summarizeAgentConfig(agentConfig);
  const root = resolve(options.root ?? process.cwd());
  const staticDir = resolve(root, options.staticDir ?? DEFAULT_STATIC_DIR);
  const host = options.host ?? process.env.SCOPEFORGE_APP_HOST ?? DEFAULT_HOST;
  const port = options.port ?? parsePort(process.env.SCOPEFORGE_APP_PORT) ?? DEFAULT_PORT;
  let vite: ViteDevServer | null = null;

  const context: RequestContext = {
    staticDir,
    routes: { ...(options.routes ?? {}), agentSummary },
    agentConfig,
    sessions: createSessionStore(),
    vite,
  };

  const server = createServer((request, response) => {
    void handleNodeRequest(request, response, context);
  });

  if (options.devUi === true) {
    const { createServer: createViteServer } = await import("vite");
    vite = await createViteServer({
      root,
      appType: "spa",
      server: {
        middlewareMode: { server },
        hmr: { server },
      },
    });
    context.vite = vite;
  }

  await listen(server, host, port);
  const boundPort = readBoundPort(server);
  const url = `http://${displayHost(host)}:${boundPort}`;

  return {
    host,
    port: boundPort,
    url,
    agent: agentSummary,
    close: async () => {
      if (vite !== null) await vite.close();
      await closeServer(server);
    },
  };
}

async function handleNodeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  const startedAt = performance.now();
  const method = request.method ?? "GET";
  const abortController = new AbortController();
  request.on("aborted", () => abortController.abort());

  let pathname = "/";
  let status = 500;

  try {
    const url = new URL(request.url ?? "/", "http://scopeforge.local");
    pathname = url.pathname;

    if (pathname.startsWith("/api")) {
      const bodyResult = await readJsonBody(request);
      if (!bodyResult.ok) {
        status = bodyResult.response.status;
        sendRouteResponse(response, bodyResult.response);
        return;
      }

      if (method === "POST" && pathname === "/api/agent/messages") {
        if (!context.agentConfig.enabled) {
          status = 503;
          sendRouteResponse(
            response,
            jsonRouteResponse(503, {
              ok: false,
              error: {
                code: "agent_disabled",
                message:
                  context.agentConfig.reason === "disabled_by_env"
                    ? "The agent is disabled by SCOPEFORGE_AGENT_ENABLED."
                    : "The agent is not configured. Set SCOPEFORGE_AGENT_* environment variables.",
              },
            }),
          );
          return;
        }
        await handleAgentMessages(request, response, bodyResult.value, {
          config: context.agentConfig,
          sessions: context.sessions,
          ...(context.routes.proposalProjectStore === undefined
            ? {}
            : { proposalProjectStore: context.routes.proposalProjectStore }),
        });
        status = response.statusCode;
        return;
      }

      const apiResponse = await handleApiRoute(
        {
          method,
          pathname,
          body: bodyResult.value,
          signal: abortController.signal,
        },
        context.routes,
      );
      if (apiResponse === null) {
        status = 404;
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Not found");
        return;
      }

      status = apiResponse.status;
      sendRouteResponse(response, apiResponse);
      return;
    }

    if (context.vite !== null) {
      await serveViteMiddleware(context.vite, request, response);
      status = response.statusCode;
      if (!response.writableEnded) {
        await serveStaticFile(request, response, context.staticDir);
        status = response.statusCode;
      }
      return;
    }

    await serveStaticFile(request, response, context.staticDir);
    status = response.statusCode;
  } catch (error) {
    status = 500;
    logError("scopeforge.request.unhandled", error, {
      method,
      pathname,
      headersSent: response.headersSent,
    });
    if (!response.headersSent) {
      sendRouteResponse(
        response,
        jsonRouteResponse(500, {
          ok: false,
          error: {
            code: "server_error",
            message: error instanceof Error ? error.message : String(error),
          },
        }),
      );
    } else {
      response.end();
    }
  } finally {
    logRequest(method, pathname, status, performance.now() - startedAt);
  }
}

async function readJsonBody(request: IncomingMessage): Promise<JsonBodyResult> {
  if (request.method !== "POST" && request.method !== "PUT" && request.method !== "PATCH") {
    return { ok: true, value: undefined };
  }

  const contentType = headerValue(request.headers["content-type"]);
  if (contentType !== undefined && !contentType.toLowerCase().includes("application/json")) {
    return {
      ok: false,
      response: jsonRouteResponse(415, {
        ok: false,
        error: {
          code: "unsupported_media_type",
          message: "API requests with a body must use application/json.",
        },
      }),
    };
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BYTES) {
      return {
        ok: false,
        response: jsonRouteResponse(413, {
          ok: false,
          error: {
            code: "payload_too_large",
            message: `JSON request bodies must be ${MAX_JSON_BYTES} bytes or smaller.`,
          },
        }),
      };
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return { ok: true, value: undefined };

  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (rawBody.length === 0) return { ok: true, value: undefined };

  try {
    return { ok: true, value: JSON.parse(rawBody) as unknown };
  } catch (error) {
    logEvent("debug", "scopeforge.request.invalid_json", { error, bytes: rawBody.length });
    return {
      ok: false,
      response: jsonRouteResponse(400, {
        ok: false,
        error: {
          code: "invalid_json",
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    };
  }
}

async function serveViteMiddleware(
  vite: ViteDevServer,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    vite.middlewares(request, response, (error: unknown) => {
      if (error === undefined) {
        resolvePromise();
        return;
      }
      rejectPromise(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function serveStaticFile(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string,
): Promise<void> {
  const method = request.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, {
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Method not allowed");
    return;
  }

  const url = new URL(request.url ?? "/", "http://scopeforge.local");
  const pathname = safeDecodePathname(url.pathname);
  if (pathname === null) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const candidate = resolve(staticDir, requestedPath);
  if (!isPathInside(candidate, staticDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  const filePath = await resolveStaticFile(candidate, staticDir);
  if (filePath === null) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const bytes = await readFile(filePath);
  response.writeHead(200, {
    "Cache-Control": cacheControlFor(filePath),
    "Content-Length": String(bytes.byteLength),
    "Content-Type": contentTypeFor(filePath),
    "X-Content-Type-Options": "nosniff",
  });
  if (method === "HEAD") {
    response.end();
    return;
  }
  response.end(bytes);
}

async function resolveStaticFile(candidate: string, staticDir: string): Promise<string | null> {
  const direct = await stat(candidate).catch(() => null);
  if (direct?.isFile() === true) return candidate;
  if (direct?.isDirectory() === true) {
    const indexFile = resolve(candidate, "index.html");
    const indexStat = await stat(indexFile).catch(() => null);
    if (indexStat?.isFile() === true) return indexFile;
  }

  const fallback = resolve(staticDir, "index.html");
  const fallbackStat = await stat(fallback).catch(() => null);
  if (fallbackStat?.isFile() === true) return fallback;
  return null;
}

function sendRouteResponse(response: ServerResponse, routeResponse: ApiRouteResponse): void {
  if (routeResponse.kind === "json") {
    const payload = JSON.stringify(routeResponse.body);
    response.writeHead(routeResponse.status, {
      ...routeResponse.headers,
      "Content-Length": String(Buffer.byteLength(payload)),
    });
    response.end(payload);
    return;
  }

  response.writeHead(routeResponse.status, routeResponse.headers);
  response.end(routeResponse.body);
}

function jsonRouteResponse(status: number, body: unknown): ApiRouteResponse {
  return {
    kind: "json",
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    body,
  };
}

function safeDecodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate === root || candidate.startsWith(normalizedRoot);
}

function contentTypeFor(path: string): string {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".json":
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml; charset=utf-8";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}

function cacheControlFor(path: string): string {
  return extname(path).toLowerCase() === ".html" ? "no-store" : "public, max-age=3600";
}

function headerValue(value: string | readonly string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  return value?.[0];
}

function listen(server: Server, host: string, port: number): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      rejectPromise(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolvePromise();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    server.close((error) => {
      if (error !== undefined) {
        rejectPromise(error);
        return;
      }
      resolvePromise();
    });
  });
}

function readBoundPort(server: Server): number {
  const address = server.address();
  if (typeof address === "object" && address !== null) return address.port;
  return DEFAULT_PORT;
}

function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::") return DEFAULT_HOST;
  return host;
}

function parsePort(input: string | undefined): number | undefined {
  if (input === undefined) return undefined;
  const port = Number(input);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) return undefined;
  return port;
}

function logRequest(method: string, pathname: string, status: number, elapsedMs: number): void {
  logEvent(status >= 500 ? "warn" : "info", "scopeforge.request", {
    method,
    pathname,
    status,
    elapsedMs: Math.round(elapsedMs * 100) / 100,
  });
}

function parseCliArgs(argv: readonly string[]): CliOptions {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueArgs = new Set(["--host", "--port", "--root", "--static-dir"]);
  const flagArgs = new Set(["--dev-ui", "--help"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (flagArgs.has(arg)) {
      flags.add(arg);
      continue;
    }
    if (!valueArgs.has(arg)) throw new Error(`Unknown argument: ${arg}\n${usage()}`);

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.\n${usage()}`);
    }
    values.set(arg, value);
    index += 1;
  }

  const portValue = values.get("--port");
  const port = portValue === undefined ? undefined : parsePort(portValue);
  if (portValue !== undefined && port === undefined) {
    throw new Error(`--port must be an integer from 1 to 65535.\n${usage()}`);
  }

  const host = values.get("--host");
  const root = values.get("--root");
  const staticDir = values.get("--static-dir");

  return {
    help: flags.has("--help"),
    serverOptions: {
      ...(host === undefined ? {} : { host }),
      ...(port === undefined ? {} : { port }),
      ...(root === undefined ? {} : { root }),
      ...(staticDir === undefined ? {} : { staticDir }),
      devUi: flags.has("--dev-ui"),
    },
  };
}

function usage(): string {
  return [
    "Usage: npm run app:dev -- [--host 127.0.0.1] [--port 4174]",
    "       npm run app:server -- [--static-dir dist] [--host 127.0.0.1] [--port 4174]",
    "Options:",
    "  --dev-ui              Mount Vite dev middleware behind the app server.",
    "  --host <host>         Host to bind. Defaults to 127.0.0.1.",
    "  --port <port>         Port to bind. Defaults to 4174.",
    "  --root <path>         Project root. Defaults to cwd.",
    "  --static-dir <path>   Built Vite assets directory. Defaults to dist.",
  ].join("\n");
}

function isDirectRun(entryPath: string | undefined): boolean {
  if (entryPath === undefined) return false;
  return import.meta.url === pathToFileURL(resolve(entryPath)).href;
}

if (isDirectRun(process.argv[1])) {
  parseAndStart(process.argv.slice(2)).catch((error: unknown) => {
    logError("scopeforge.app_server.startup_failed", error);
    process.exitCode = 1;
  });
}

async function parseAndStart(argv: readonly string[]): Promise<void> {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  const server = await startAppServer(options.serverOptions);
  logEvent("info", "scopeforge.app_server.started", {
    url: server.url,
    devUi: options.serverOptions.devUi === true,
    agent: server.agent,
  });
}
