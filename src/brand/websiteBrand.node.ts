import { Buffer } from "node:buffer";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { ProposalBrand, ProposalBrandColors } from "../proposal/types.js";
import type {
  ExtractWebsiteBrandFromHtmlOptions,
  ExtractWebsiteBrandOptions,
  WebsiteBrandAsset,
  WebsiteBrandColorCandidate,
  WebsiteBrandColorRole,
  WebsiteBrandColorSource,
  WebsiteBrandExtractionResult,
  WebsiteBrandExtractionSources,
  WebsiteBrandFetchedPage,
  WebsiteBrandFieldSource,
  WebsiteBrandLookup,
  WebsiteBrandManualOverrides,
  WebsiteBrandMeta,
  WebsiteBrandRedirect,
  WebsiteBrandResolvedAddress,
  WebsiteBrandSignalSource,
} from "./types.js";

export type WebsiteBrandFetchErrorCode =
  | "BAD_URL"
  | "BAD_SCHEME"
  | "BAD_HOSTNAME"
  | "BLOCKED_ADDRESS"
  | "TOO_MANY_REDIRECTS"
  | "REDIRECT_WITHOUT_LOCATION"
  | "HTTP_ERROR"
  | "NON_HTML"
  | "BODY_TOO_LARGE"
  | "TIMEOUT";

export class WebsiteBrandFetchError extends Error {
  readonly code: WebsiteBrandFetchErrorCode;
  readonly url: string;
  readonly detail?: string;

  constructor(code: WebsiteBrandFetchErrorCode, url: string, message: string, detail?: string) {
    super(message);
    this.name = "WebsiteBrandFetchError";
    this.code = code;
    this.url = url;
    if (detail !== undefined) this.detail = detail;
  }
}

interface ValidationOptions {
  readonly baseUrl?: URL;
  readonly lookupHost?: WebsiteBrandLookup;
}

interface JsonLdBrandSignals {
  readonly name?: string;
  readonly legalName?: string;
  readonly description?: string;
  readonly slogan?: string;
  readonly logoUrl?: string;
  readonly imageUrl?: string;
}

interface AttributeMatch {
  readonly tag: string;
  readonly attrs: Record<string, string>;
  readonly body?: string;
  readonly index: number;
}

interface ColorStats {
  count: number;
  role: WebsiteBrandColorRole;
  source: WebsiteBrandColorSource;
  confidence: number;
  property?: string;
  selector?: string;
}

interface PaletteBuildResult {
  readonly colors: ProposalBrandColors;
  readonly sources: Readonly<Partial<Record<keyof ProposalBrandColors, WebsiteBrandFieldSource>>>;
}

interface PalettePick {
  readonly hex: string;
  readonly candidate?: WebsiteBrandColorCandidate;
  readonly source: WebsiteBrandSignalSource;
}

interface NameCandidate {
  readonly value: string;
  readonly source: WebsiteBrandSignalSource;
  readonly selector?: string;
  readonly attribute?: string;
  readonly confidence: number;
}

interface CssSource {
  readonly css: string;
  readonly selector: string;
}

interface ImageSrcCandidate {
  readonly url: string;
  readonly score: number;
}

const DEFAULT_MAX_BYTES = 1_500_000;
const HARD_MAX_BYTES = 5_000_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const HARD_MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REDIRECTS = 3;
const HARD_MAX_REDIRECTS = 8;
const USER_AGENT = "ScopeForge WebsiteBrandExtractor/1.0";
const EXTRACTOR = "scopeforge.websiteBrand.node" as const;
const EXTRACTOR_VERSION = 1 as const;
const MAX_ASSETS = 80;
const MAX_COLORS = 32;

const DEFAULT_COLORS = {
  primary: "#111827",
  secondary: "#334155",
  accent: "#2563eb",
  background: "#f8fafc",
  surface: "#ffffff",
  text: "#111827",
  mutedText: "#64748b",
  border: "#dbe3ef",
} satisfies ProposalBrandColors;

const PALETTE_KEYS = [
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text",
  "mutedText",
  "border",
] as const satisfies readonly (keyof ProposalBrandColors)[];

const INTERNAL_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
] as const;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const TAG_RE_CACHE = new Map<string, RegExp>();
const ATTR_RE = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
const CSS_DECLARATION_RE = /(?:^|[;{\s])([\w-]+)\s*:\s*([^;{}]+)/gi;
const CSS_COLOR_TOKEN_RE =
  /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

export async function extractWebsiteBrand(
  url: string,
  options: ExtractWebsiteBrandOptions = {},
): Promise<WebsiteBrandExtractionResult> {
  const fetched = await fetchWebsiteBrandPage(url, options);
  return extractWebsiteBrandFromHtml(fetched.html, fetched.finalUrl, {
    requestedUrl: fetched.requestedUrl,
    normalizedUrl: fetched.normalizedUrl,
    fetchedAt: fetched.fetchedAt,
    statusCode: fetched.statusCode,
    bytesRead: fetched.bytesRead,
    elapsedMs: fetched.elapsedMs,
    redirects: fetched.redirects,
    warnings: fetched.warnings,
    ...(fetched.contentType === undefined ? {} : { contentType: fetched.contentType }),
    ...(options.manualOverrides === undefined ? {} : { manualOverrides: options.manualOverrides }),
  });
}

export async function fetchWebsiteBrandPage(
  url: string,
  options: ExtractWebsiteBrandOptions = {},
): Promise<WebsiteBrandFetchedPage> {
  const maxBytes = clampInt(options.maxBytes, DEFAULT_MAX_BYTES, 50_000, HARD_MAX_BYTES);
  const timeoutMs = clampInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 500, HARD_MAX_TIMEOUT_MS);
  const maxRedirects = clampInt(options.maxRedirects, DEFAULT_MAX_REDIRECTS, 0, HARD_MAX_REDIRECTS);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new WebsiteBrandFetchError("BAD_URL", url, "No fetch implementation is available.");
  }

  const startedMs = Date.now();
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const validationOptions =
    options.lookupHost === undefined ? {} : { lookupHost: options.lookupHost };
  const normalized = await validateWebsiteBrandFetchUrl(url, validationOptions);
  const requestedUrl = url;
  const normalizedUrl = normalized.href;
  const redirects: WebsiteBrandRedirect[] = [];
  const warnings: string[] = [];
  let current = normalized;

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "user-agent": USER_AGENT,
        },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (location === null) {
          throw new WebsiteBrandFetchError(
            "REDIRECT_WITHOUT_LOCATION",
            current.href,
            `Redirect from ${current.href} did not include a Location header.`,
          );
        }
        if (redirectCount >= maxRedirects) {
          throw new WebsiteBrandFetchError(
            "TOO_MANY_REDIRECTS",
            current.href,
            `Website brand fetch exceeded ${maxRedirects} redirect${maxRedirects === 1 ? "" : "s"}.`,
          );
        }
        const next = await validateWebsiteBrandFetchUrl(location, {
          baseUrl: current,
          ...(options.lookupHost === undefined ? {} : { lookupHost: options.lookupHost }),
        });
        redirects.push({ from: current.href, to: next.href, statusCode: response.status });
        current = next;
        continue;
      }

      if (!response.ok) {
        throw new WebsiteBrandFetchError(
          "HTTP_ERROR",
          current.href,
          `Failed to fetch ${current.href}: HTTP ${response.status}.`,
          String(response.status),
        );
      }

      const contentType = response.headers.get("content-type") ?? undefined;
      if (!isHtmlContent(contentType)) {
        throw new WebsiteBrandFetchError(
          "NON_HTML",
          current.href,
          `Expected an HTML page from ${current.href}, got ${contentType ?? "unknown content type"}.`,
          contentType,
        );
      }

      const body = await readLimitedBody(response, current.href, maxBytes);
      const html = decodeResponseBody(body, contentType);
      return {
        html,
        requestedUrl,
        normalizedUrl,
        finalUrl: current.href,
        fetchedAt,
        statusCode: response.status,
        bytesRead: body.byteLength,
        elapsedMs: Date.now() - startedMs,
        redirects,
        warnings,
        ...(contentType === undefined ? {} : { contentType }),
      } satisfies WebsiteBrandFetchedPage;
    } catch (err) {
      if (err instanceof WebsiteBrandFetchError) throw err;
      if (controller.signal.aborted) {
        throw new WebsiteBrandFetchError(
          "TIMEOUT",
          current.href,
          `Request timed out after ${timeoutMs}ms.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new WebsiteBrandFetchError(
    "TOO_MANY_REDIRECTS",
    normalizedUrl,
    `Website brand fetch exceeded ${maxRedirects} redirect${maxRedirects === 1 ? "" : "s"}.`,
  );
}

export async function validateWebsiteBrandFetchUrl(
  input: string,
  options: ValidationOptions = {},
): Promise<URL> {
  const url = parseWebsiteUrl(input, options.baseUrl);
  if (url.protocol !== "https:") {
    throw new WebsiteBrandFetchError(
      "BAD_SCHEME",
      input,
      `Only https: website URLs are allowed (got ${url.protocol}).`,
    );
  }
  if (url.username || url.password) {
    throw new WebsiteBrandFetchError(
      "BAD_HOSTNAME",
      input,
      "Website URLs with embedded credentials are not allowed.",
    );
  }

  const hostname = normalizeHostnameForChecks(url.hostname);
  if (hostname.length === 0) {
    throw new WebsiteBrandFetchError("BAD_HOSTNAME", input, "Website URL has no hostname.");
  }
  if (isInternalHostname(hostname)) {
    throw new WebsiteBrandFetchError(
      "BLOCKED_ADDRESS",
      input,
      `Refusing to fetch internal hostname: ${hostname}`,
      hostname,
    );
  }

  if (isIP(hostname) !== 0) {
    if (isBlockedNetworkAddress(hostname)) {
      throw new WebsiteBrandFetchError(
        "BLOCKED_ADDRESS",
        input,
        `Refusing to fetch private/loopback/link-local address: ${hostname}`,
        hostname,
      );
    }
    return canonicalizeFetchUrl(url);
  }

  const lookupHost = options.lookupHost ?? defaultLookupHost;
  let addresses: readonly WebsiteBrandResolvedAddress[];
  try {
    addresses = await lookupHost(hostname);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WebsiteBrandFetchError(
      "BAD_HOSTNAME",
      input,
      `DNS lookup failed for ${hostname}: ${message}`,
      hostname,
    );
  }

  if (addresses.length === 0) {
    throw new WebsiteBrandFetchError(
      "BAD_HOSTNAME",
      input,
      `No addresses resolved for ${hostname}.`,
      hostname,
    );
  }

  for (const address of addresses) {
    if (isBlockedNetworkAddress(address.address)) {
      throw new WebsiteBrandFetchError(
        "BLOCKED_ADDRESS",
        input,
        `Hostname ${hostname} resolves to blocked address ${address.address}.`,
        address.address,
      );
    }
  }

  return canonicalizeFetchUrl(url);
}

export function isInternalHostname(hostname: string): boolean {
  const normalized = normalizeHostnameForChecks(hostname);
  if (normalized === "localhost") return true;
  return INTERNAL_HOSTNAME_SUFFIXES.some(
    (suffix) => normalized.endsWith(suffix) || normalized === suffix.slice(1),
  );
}

export function isBlockedNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedV4(address);
  if (version === 6) return isBlockedV6(address);
  return false;
}

export function extractWebsiteBrandFromHtml(
  html: string,
  pageUrl: string,
  options: ExtractWebsiteBrandFromHtmlOptions = {},
): WebsiteBrandExtractionResult {
  const finalUrl = canonicalizeContentUrl(pageUrl);
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const requestedUrl = options.requestedUrl ?? finalUrl;
  const normalizedUrl = options.normalizedUrl ?? finalUrl;
  const statusCode = options.statusCode ?? 200;
  const bytesRead = options.bytesRead ?? Buffer.byteLength(html, "utf-8");
  const elapsedMs = options.elapsedMs ?? 0;
  const redirects = options.redirects ?? [];
  const warnings = [...(options.warnings ?? [])];
  const manualOverrides = options.manualOverrides;
  const meta = readMeta(html, finalUrl);
  const jsonLd = readJsonLdBrandSignals(html, finalUrl);
  const headings = readHeadingTexts(html);
  const nameSource = applyManualFieldSource(
    inferNameSource(meta, jsonLd, headings, finalUrl),
    manualOverrides?.name,
    "manual",
  );
  const taglineSource = applyOptionalManualFieldSource(
    inferTaglineSource(meta, jsonLd, headings, nameSource.value, finalUrl),
    manualOverrides?.tagline,
  );
  const favicons = readFaviconAssets(html, finalUrl);
  const imageAssets = readImageAssets(html, finalUrl);
  const jsonLdLogo = makeJsonLdLogoAsset(jsonLd.logoUrl, finalUrl);
  const jsonLdImage = makeJsonLdOgImageAsset(jsonLd.imageUrl, finalUrl);
  const ogImages = dedupeAssets([
    ...readOgImageAssets(meta, finalUrl),
    ...(jsonLdImage === undefined ? [] : [jsonLdImage]),
  ]).filter((asset) => asset.kind === "og-image");
  const logos = dedupeAssets([
    ...(jsonLdLogo === undefined ? [] : [jsonLdLogo]),
    ...imageAssets.filter((asset) => asset.kind === "logo"),
  ]).filter((asset) => asset.kind === "logo");
  const assets = dedupeAssets([
    ...logos,
    ...favicons,
    ...ogImages,
    ...imageAssets.filter((asset) => asset.kind === "image"),
  ]).slice(0, MAX_ASSETS);
  const logoAsset = logos[0] ?? favicons[0] ?? ogImages[0];
  const logoUrlSource = applyOptionalManualFieldSource(
    logoAsset === undefined ? undefined : assetToFieldSource(logoAsset),
    manualOverrides?.logoUrl,
  );
  const colors = readColorCandidates(html, meta.themeColor).slice(0, MAX_COLORS);
  const palette = buildProposalPalette(colors, manualOverrides?.colors, finalUrl);
  const proposalBrand = buildProposalBrand({
    name: nameSource.value,
    finalUrl,
    jsonLd,
    palette: palette.colors,
    ...(taglineSource === undefined ? {} : { tagline: taglineSource.value }),
    ...(meta.canonicalUrl === undefined ? {} : { canonicalUrl: meta.canonicalUrl }),
    ...(manualOverrides === undefined ? {} : { manualOverrides }),
  });
  const source = {
    requestedUrl,
    normalizedUrl,
    finalUrl,
    fetchedAt,
    statusCode,
    bytesRead,
    elapsedMs,
    extractor: EXTRACTOR,
    extractorVersion: EXTRACTOR_VERSION,
    redirects,
    warnings,
    ...(options.contentType === undefined ? {} : { contentType: options.contentType }),
  } satisfies WebsiteBrandExtractionResult["source"];
  const sources = {
    name: nameSource,
    colors: palette.sources,
    ...(taglineSource === undefined ? {} : { tagline: taglineSource }),
    ...(logoUrlSource === undefined ? {} : { logoUrl: logoUrlSource }),
  } satisfies WebsiteBrandExtractionSources;

  return {
    proposalBrand,
    palette: palette.colors,
    meta,
    assets,
    favicons,
    logos,
    ogImages,
    colors,
    source,
    sources,
    name: nameSource.value,
    ...(taglineSource === undefined ? {} : { tagline: taglineSource.value }),
    ...(logoUrlSource === undefined ? {} : { logoUrl: logoUrlSource.value }),
    ...(manualOverrides === undefined ? {} : { manualOverrides }),
  } satisfies WebsiteBrandExtractionResult;
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, code: string) => {
      const valueCode = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isFinite(valueCode) ? String.fromCodePoint(valueCode) : "";
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'");
}

async function defaultLookupHost(
  hostname: string,
): Promise<readonly WebsiteBrandResolvedAddress[]> {
  const addresses = await dnsLookup(hostname, { all: true, verbatim: false });
  return addresses.map((address) => ({
    address: address.address,
    family: address.family === 6 ? 6 : 4,
  }));
}

function parseWebsiteUrl(input: string, baseUrl: URL | undefined): URL {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new WebsiteBrandFetchError("BAD_URL", input, "Website URL cannot be empty.");
  }
  try {
    if (baseUrl !== undefined) return new URL(trimmed, baseUrl);
    if (trimmed.startsWith("//")) return new URL(`https:${trimmed}`);
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return new URL(trimmed);
    return new URL(`https://${trimmed}`);
  } catch {
    throw new WebsiteBrandFetchError("BAD_URL", input, `Invalid website URL: ${input}`);
  }
}

function canonicalizeFetchUrl(input: URL): URL {
  const url = new URL(input.href);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = normalizeHostnameForChecks(url.hostname);
  if (url.port === "443") url.port = "";
  url.username = "";
  url.password = "";
  url.hash = "";
  if (url.pathname === "") url.pathname = "/";
  return url;
}

function canonicalizeContentUrl(input: string): string {
  try {
    const url = new URL(input);
    url.hash = "";
    if (url.port === "443") url.port = "";
    return url.href;
  } catch {
    return input;
  }
}

function normalizeHostnameForChecks(hostname: string): string {
  let normalized = hostname.trim().toLowerCase();
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  while (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  return normalized;
}

function isBlockedV4(address: string): boolean {
  const octets = address.split(".").map((part) => Number.parseInt(part, 10));
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const first = octets[0];
  const second = octets[1];
  const third = octets[2];
  if (first === undefined || second === undefined || third === undefined) return false;

  if (first === 0) return true;
  if (first === 10) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  if (first === 192 && second === 0 && third === 0) return true;
  if (first === 192 && second === 0 && third === 2) return true;
  if (first === 198 && (second === 18 || second === 19)) return true;
  if (first === 198 && second === 51 && third === 100) return true;
  if (first === 203 && second === 0 && third === 113) return true;
  if (first >= 224) return true;
  return false;
}

function isBlockedV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;

  const mappedV4 = extractMappedIPv4(lower);
  if (mappedV4 !== null) return isBlockedV4(mappedV4);
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  if (lower.startsWith("2001:db8") || lower.startsWith("2001:0db8")) return true;

  const first = lower.split(":")[0];
  if (first !== undefined && first.length === 4 && first >= "fe80" && first <= "febf") return true;
  return false;
}

function expandIPv6Groups(input: string): number[] | null {
  let address = input;
  const tailHextets: number[] = [];

  if (address.includes(".")) {
    const lastColon = address.lastIndexOf(":");
    if (lastColon < 0) return null;
    const v4 = address.slice(lastColon + 1);
    address = address.slice(0, lastColon);
    const octets = v4.split(".").map((part) => Number.parseInt(part, 10));
    if (
      octets.length !== 4 ||
      octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return null;
    }
    const first = octets[0];
    const second = octets[1];
    const third = octets[2];
    const fourth = octets[3];
    if (
      first === undefined ||
      second === undefined ||
      third === undefined ||
      fourth === undefined
    ) {
      return null;
    }
    tailHextets.push((first << 8) | second, (third << 8) | fourth);
  }

  const doubleColonIndex = address.indexOf("::");
  const headText = doubleColonIndex === -1 ? address : address.slice(0, doubleColonIndex);
  const tailText = doubleColonIndex === -1 ? "" : address.slice(doubleColonIndex + 2);
  const head = headText.length === 0 ? [] : headText.split(":");
  const tail = tailText.length === 0 ? [] : tailText.split(":");
  const targetLength = 8 - tailHextets.length;
  const fillLength = doubleColonIndex === -1 ? 0 : targetLength - head.length - tail.length;
  if (fillLength < 0) return null;
  const hexGroups = [...head, ...new Array<string>(fillLength).fill("0"), ...tail];
  if (hexGroups.length !== targetLength) return null;
  const parsed = hexGroups.map((group) => Number.parseInt(group, 16));
  if (parsed.some((group) => Number.isNaN(group) || group < 0 || group > 0xffff)) return null;
  parsed.push(...tailHextets);
  return parsed.length === 8 ? parsed : null;
}

function extractMappedIPv4(address: string): string | null {
  const groups = expandIPv6Groups(address);
  if (groups === null) return null;
  const g0 = groups[0];
  const g1 = groups[1];
  const g2 = groups[2];
  const g3 = groups[3];
  const g4 = groups[4];
  const g5 = groups[5];
  const hi = groups[6];
  const lo = groups[7];
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff &&
    hi !== undefined &&
    lo !== undefined
  ) {
    return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  }
  return null;
}

async function readLimitedBody(response: Response, url: string, maxBytes: number): Promise<Buffer> {
  const length = response.headers.get("content-length");
  if (length !== null) {
    const declared = Number(length);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new WebsiteBrandFetchError(
        "BODY_TOO_LARGE",
        url,
        `Declared body size ${declared} exceeds limit ${maxBytes}.`,
      );
    }
  }

  if (response.body === null) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new WebsiteBrandFetchError(
          "BODY_TOO_LARGE",
          url,
          `Body exceeded limit ${maxBytes} bytes while streaming.`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function decodeResponseBody(body: Buffer, contentType: string | undefined): string {
  const charset = contentType
    ?.match(/charset\s*=\s*([^;]+)/i)?.[1]
    ?.trim()
    .toLowerCase();
  if (charset !== undefined && charset !== "utf-8" && charset !== "utf8") {
    try {
      return new TextDecoder(charset).decode(body);
    } catch {
      return body.toString("utf-8");
    }
  }
  return body.toString("utf-8");
}

function isHtmlContent(contentType: string | undefined): boolean {
  if (contentType === undefined) return true;
  const lower = contentType.toLowerCase();
  return lower.includes("text/html") || lower.includes("application/xhtml+xml");
}

function readMeta(html: string, pageUrl: string): WebsiteBrandMeta {
  const title = readTitle(html);
  const description = readFirstMetaContent(html, [
    { attr: "name", value: "description" },
    { attr: "property", value: "description" },
  ]);
  const applicationName = readFirstMetaContent(html, [{ attr: "name", value: "application-name" }]);
  const ogSiteName = readFirstMetaContent(html, [{ attr: "property", value: "og:site_name" }]);
  const ogTitle = readFirstMetaContent(html, [{ attr: "property", value: "og:title" }]);
  const ogDescription = readFirstMetaContent(html, [{ attr: "property", value: "og:description" }]);
  const twitterTitle = readFirstMetaContent(html, [{ attr: "name", value: "twitter:title" }]);
  const twitterDescription = readFirstMetaContent(html, [
    { attr: "name", value: "twitter:description" },
  ]);
  const ogImage = readFirstMetaUrl(
    html,
    [
      { attr: "property", value: "og:image" },
      { attr: "property", value: "og:image:url" },
      { attr: "property", value: "og:image:secure_url" },
    ],
    pageUrl,
  );
  const twitterImage = readFirstMetaUrl(html, [{ attr: "name", value: "twitter:image" }], pageUrl);
  const themeColor = normalizeCssColor(
    readFirstMetaContent(html, [
      { attr: "name", value: "theme-color" },
      { attr: "name", value: "msapplication-tilecolor" },
    ]) ?? "",
  );
  const canonicalUrl = readCanonicalUrl(html, pageUrl);

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
    ...(canonicalUrl === undefined ? {} : { canonicalUrl }),
    ...(applicationName === undefined ? {} : { applicationName }),
    ...(ogSiteName === undefined ? {} : { ogSiteName }),
    ...(ogTitle === undefined ? {} : { ogTitle }),
    ...(ogDescription === undefined ? {} : { ogDescription }),
    ...(ogImage === undefined ? {} : { ogImage }),
    ...(twitterTitle === undefined ? {} : { twitterTitle }),
    ...(twitterDescription === undefined ? {} : { twitterDescription }),
    ...(twitterImage === undefined ? {} : { twitterImage }),
    ...(themeColor === undefined ? {} : { themeColor }),
  } satisfies WebsiteBrandMeta;
}

function readTitle(html: string): string | undefined {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const value = normalizeSpace(decodeHtmlEntities(stripTags(match?.[1] ?? "")));
  return value.length > 0 ? value : undefined;
}

function readFirstMetaContent(
  html: string,
  keys: readonly { readonly attr: "name" | "property" | "itemprop"; readonly value: string }[],
): string | undefined {
  for (const tag of readTags(html, "meta")) {
    for (const key of keys) {
      if (tag.attrs[key.attr]?.toLowerCase() !== key.value.toLowerCase()) continue;
      const content = normalizeSpace(decodeHtmlEntities(tag.attrs.content ?? ""));
      if (content.length > 0) return content;
    }
  }
  return undefined;
}

function readFirstMetaUrl(
  html: string,
  keys: readonly { readonly attr: "name" | "property" | "itemprop"; readonly value: string }[],
  pageUrl: string,
): string | undefined {
  const raw = readFirstMetaContent(html, keys);
  if (raw === undefined) return undefined;
  return makeAbsoluteHttpsUrl(raw, pageUrl);
}

function readCanonicalUrl(html: string, pageUrl: string): string | undefined {
  for (const tag of readTags(html, "link")) {
    const rel = tag.attrs.rel?.toLowerCase() ?? "";
    if (!rel.split(/\s+/).includes("canonical")) continue;
    const href = tag.attrs.href;
    if (href === undefined) continue;
    try {
      const url = new URL(href, pageUrl);
      if (url.protocol !== "https:") return undefined;
      url.hash = "";
      return url.href;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readHeadingTexts(html: string): string[] {
  const headings: string[] = [];
  const re = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  for (const match of html.matchAll(re)) {
    const text = normalizeSpace(decodeHtmlEntities(stripTags(match[1] ?? "")));
    if (text.length > 0) headings.push(text);
  }
  return uniqueStrings(headings, 24);
}

function inferNameSource(
  meta: WebsiteBrandMeta,
  jsonLd: JsonLdBrandSignals,
  headings: readonly string[],
  pageUrl: string,
): WebsiteBrandFieldSource {
  const hostName = hostnameBrandName(pageUrl);
  const titleName = meta.title === undefined ? undefined : brandNameFromTitle(meta.title, hostName);
  const ogTitleName =
    meta.ogTitle === undefined ? undefined : brandNameFromTitle(meta.ogTitle, hostName);
  const candidates: NameCandidate[] = [
    ...makeNameCandidate(jsonLd.name, "json-ld", 0.92),
    ...makeNameCandidate(meta.ogSiteName, "meta", 0.9, 'meta[property="og:site_name"]', "content"),
    ...makeNameCandidate(
      meta.applicationName,
      "meta",
      0.84,
      'meta[name="application-name"]',
      "content",
    ),
    ...makeNameCandidate(titleName, "title", 0.74, "title"),
    ...makeNameCandidate(ogTitleName, "meta", 0.68, 'meta[property="og:title"]', "content"),
    ...makeNameCandidate(headings[0], "heading", 0.5, "h1"),
    ...makeNameCandidate(hostName, "url", 0.42),
  ];
  const best = candidates.find((candidate) => candidate.value.length > 0);
  if (best !== undefined) return candidateToFieldSource(best, pageUrl);
  return { value: "Imported Brand", source: "fallback", confidence: 0.2 };
}

function inferTaglineSource(
  meta: WebsiteBrandMeta,
  jsonLd: JsonLdBrandSignals,
  headings: readonly string[],
  name: string,
  pageUrl: string,
): WebsiteBrandFieldSource | undefined {
  const titleTagline = meta.title === undefined ? undefined : taglineFromTitle(meta.title, name);
  const headingTagline = headings.find((heading) => !sameNormalizedText(heading, name));
  const candidates: NameCandidate[] = [
    ...makeNameCandidate(jsonLd.slogan, "json-ld", 0.9),
    ...makeNameCandidate(jsonLd.description, "json-ld", 0.84),
    ...makeNameCandidate(meta.description, "meta", 0.82, 'meta[name="description"]', "content"),
    ...makeNameCandidate(
      meta.ogDescription,
      "meta",
      0.78,
      'meta[property="og:description"]',
      "content",
    ),
    ...makeNameCandidate(
      meta.twitterDescription,
      "meta",
      0.72,
      'meta[name="twitter:description"]',
      "content",
    ),
    ...makeNameCandidate(titleTagline, "title", 0.58, "title"),
    ...makeNameCandidate(headingTagline, "heading", 0.48, "h1,h2"),
  ];
  const best = candidates.find(
    (candidate) => candidate.value.length > 0 && candidate.value.length <= 240,
  );
  return best === undefined ? undefined : candidateToFieldSource(best, pageUrl);
}

function makeNameCandidate(
  value: string | undefined,
  source: WebsiteBrandSignalSource,
  confidence: number,
  selector?: string,
  attribute?: string,
): NameCandidate[] {
  const normalized = normalizeSpace(value ?? "");
  if (normalized.length === 0) return [];
  return [
    {
      value: normalized.slice(0, 240),
      source,
      confidence,
      ...(selector === undefined ? {} : { selector }),
      ...(attribute === undefined ? {} : { attribute }),
    },
  ];
}

function candidateToFieldSource(
  candidate: NameCandidate,
  pageUrl: string,
): WebsiteBrandFieldSource {
  return {
    value: candidate.value,
    source: candidate.source,
    pageUrl,
    confidence: candidate.confidence,
    ...(candidate.selector === undefined ? {} : { selector: candidate.selector }),
    ...(candidate.attribute === undefined ? {} : { attribute: candidate.attribute }),
  };
}

function applyManualFieldSource(
  inferred: WebsiteBrandFieldSource,
  manualValue: string | undefined,
  source: WebsiteBrandSignalSource,
): WebsiteBrandFieldSource {
  const value = normalizeSpace(manualValue ?? "");
  if (value.length === 0) return inferred;
  return { value, source, confidence: 1 };
}

function applyOptionalManualFieldSource(
  inferred: WebsiteBrandFieldSource | undefined,
  manualValue: string | undefined,
): WebsiteBrandFieldSource | undefined {
  const value = normalizeSpace(manualValue ?? "");
  if (value.length > 0) return { value, source: "manual", confidence: 1 };
  return inferred;
}

function brandNameFromTitle(title: string, hostName: string): string | undefined {
  const parts = title
    .split(/\s+(?:[|•]|[-–—])\s+/)
    .map((part) => normalizeSpace(part))
    .filter(Boolean);
  if (parts.length === 0) return undefined;
  const hostKey = hostName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hostMatch = parts.find((part) =>
    part
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .includes(hostKey),
  );
  return hostMatch ?? parts[0];
}

function taglineFromTitle(title: string, name: string): string | undefined {
  const parts = title
    .split(/\s+(?:[|•]|[-–—])\s+/)
    .map((part) => normalizeSpace(part))
    .filter(Boolean);
  return parts.find((part) => !sameNormalizedText(part, name));
}

function hostnameBrandName(pageUrl: string): string {
  try {
    const hostname = new URL(pageUrl).hostname.replace(/^www\./i, "");
    const stem = hostname.split(".")[0] ?? "Imported Brand";
    return toTitleCase(stem.replace(/[-_]+/g, " "));
  } catch {
    return "Imported Brand";
  }
}

function sameNormalizedText(left: string, right: string): boolean {
  return (
    left.toLowerCase().replace(/[^a-z0-9]/g, "") === right.toLowerCase().replace(/[^a-z0-9]/g, "")
  );
}

function readFaviconAssets(html: string, pageUrl: string): WebsiteBrandAsset[] {
  const assets: WebsiteBrandAsset[] = [];
  for (const tag of readTags(html, "link")) {
    const rel = tag.attrs.rel?.toLowerCase() ?? "";
    const relValues = rel.split(/\s+/).filter(Boolean);
    const isIcon =
      relValues.includes("icon") ||
      relValues.includes("apple-touch-icon") ||
      rel.includes("mask-icon");
    if (!isIcon) continue;
    const href = tag.attrs.href;
    if (href === undefined) continue;
    const url = makeAbsoluteHttpsUrl(href, pageUrl);
    if (url === undefined) continue;
    assets.push({
      url,
      kind: "favicon",
      source: "link",
      sourcePageUrl: pageUrl,
      confidence: relValues.includes("apple-touch-icon") ? 0.82 : 0.76,
      selector: "link[rel~='icon']",
      rel,
      ...(tag.attrs.type === undefined ? {} : { mimeType: tag.attrs.type }),
      ...(tag.attrs.sizes === undefined ? {} : { sizes: tag.attrs.sizes }),
    });
  }
  return dedupeAssets(assets).filter((asset) => asset.kind === "favicon");
}

function readOgImageAssets(meta: WebsiteBrandMeta, pageUrl: string): WebsiteBrandAsset[] {
  const assets: WebsiteBrandAsset[] = [];
  if (meta.ogImage !== undefined) {
    assets.push({
      url: meta.ogImage,
      kind: "og-image",
      source: "meta",
      sourcePageUrl: pageUrl,
      confidence: 0.8,
      selector: 'meta[property="og:image"]',
    });
  }
  if (meta.twitterImage !== undefined) {
    assets.push({
      url: meta.twitterImage,
      kind: "og-image",
      source: "meta",
      sourcePageUrl: pageUrl,
      confidence: 0.72,
      selector: 'meta[name="twitter:image"]',
    });
  }
  return dedupeAssets(assets);
}

function readImageAssets(html: string, pageUrl: string): WebsiteBrandAsset[] {
  const assets: WebsiteBrandAsset[] = [];
  for (const tag of readTags(html, "img")) {
    const url = readBestImageSrc(tag.attrs, pageUrl);
    if (url === undefined) continue;
    const altText = normalizeSpace(decodeHtmlEntities(tag.attrs.alt ?? tag.attrs.title ?? ""));
    const width = readPositiveInt(tag.attrs.width);
    const height = readPositiveInt(tag.attrs.height);
    const kind = classifyImage(url, altText, tag.attrs) ? "logo" : "image";
    assets.push({
      url,
      kind,
      source: "image",
      sourcePageUrl: pageUrl,
      confidence: kind === "logo" ? 0.86 : 0.45,
      selector: "img",
      ...(altText.length === 0 ? {} : { altText }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
    });
  }
  return dedupeAssets(assets);
}

function makeJsonLdLogoAsset(
  url: string | undefined,
  pageUrl: string,
): WebsiteBrandAsset | undefined {
  if (url === undefined) return undefined;
  return {
    url,
    kind: "logo",
    source: "json-ld",
    sourcePageUrl: pageUrl,
    confidence: 0.9,
    selector: 'script[type="application/ld+json"]',
  };
}

function makeJsonLdOgImageAsset(
  url: string | undefined,
  pageUrl: string,
): WebsiteBrandAsset | undefined {
  if (url === undefined) return undefined;
  return {
    url,
    kind: "og-image",
    source: "json-ld",
    sourcePageUrl: pageUrl,
    confidence: 0.72,
    selector: 'script[type="application/ld+json"]',
  };
}

function assetToFieldSource(asset: WebsiteBrandAsset): WebsiteBrandFieldSource {
  return {
    value: asset.url,
    source: asset.source,
    pageUrl: asset.sourcePageUrl,
    attribute: assetAttribute(asset),
    confidence: asset.confidence,
    ...(asset.selector === undefined ? {} : { selector: asset.selector }),
  };
}

function assetAttribute(asset: WebsiteBrandAsset): string {
  switch (asset.source) {
    case "image":
      return "src";
    case "link":
      return "href";
    case "meta":
      return "content";
    case "json-ld":
      return asset.kind === "logo" ? "logo" : "image";
  }
}

function classifyImage(
  url: string,
  altText: string | undefined,
  attrs: Record<string, string>,
): boolean {
  const haystack =
    `${url} ${altText ?? ""} ${attrs.class ?? ""} ${attrs.id ?? ""} ${attrs.role ?? ""}`.toLowerCase();
  return /\b(logo|brandmark|wordmark|logotype)\b/.test(haystack) || haystack.includes("/logo");
}

function readBestImageSrc(attrs: Record<string, string>, pageUrl: string): string | undefined {
  const candidates = [
    makeImageSrcCandidate(attrs.src, 1),
    makeImageSrcCandidate(attrs["data-src"], 0.9),
    makeImageSrcCandidate(attrs["data-lazy-src"], 0.85),
    bestFromSrcset(attrs.srcset),
    bestFromSrcset(attrs["data-srcset"]),
  ].filter((candidate): candidate is ImageSrcCandidate => candidate !== undefined);
  candidates.sort((left, right) => right.score - left.score);
  for (const candidate of candidates) {
    const url = makeAbsoluteHttpsUrl(candidate.url, pageUrl);
    if (url !== undefined) return url;
  }
  return undefined;
}

function makeImageSrcCandidate(
  value: string | undefined,
  score: number,
): ImageSrcCandidate | undefined {
  const normalized = normalizeSpace(value ?? "");
  return normalized.length === 0 ? undefined : { url: normalized, score };
}

function bestFromSrcset(value: string | undefined): ImageSrcCandidate | undefined {
  if (value === undefined) return undefined;
  let best: ImageSrcCandidate | undefined;
  let order = 0;
  for (const rawPart of value.split(",")) {
    order += 1;
    const [rawUrl, descriptor] = rawPart.trim().split(/\s+/, 2);
    if (rawUrl === undefined || rawUrl.length === 0) continue;
    const score = descriptorScore(descriptor) + order / 1000;
    if (best === undefined || score > best.score) best = { url: rawUrl, score };
  }
  return best;
}

function descriptorScore(descriptor: string | undefined): number {
  if (descriptor === undefined) return 1;
  const numeric = Number.parseFloat(descriptor);
  if (!Number.isFinite(numeric)) return 1;
  if (descriptor.endsWith("w")) return numeric / 100;
  if (descriptor.endsWith("x")) return numeric * 10;
  return numeric;
}

function readPositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function dedupeAssets(assets: readonly WebsiteBrandAsset[]): WebsiteBrandAsset[] {
  const byUrl = new Map<string, WebsiteBrandAsset>();
  for (const asset of assets) {
    const existing = byUrl.get(asset.url);
    if (existing === undefined || assetKindScore(asset) > assetKindScore(existing)) {
      byUrl.set(asset.url, asset);
    }
  }
  return [...byUrl.values()].sort(
    (left, right) =>
      assetKindScore(right) - assetKindScore(left) || left.url.localeCompare(right.url),
  );
}

function assetKindScore(asset: WebsiteBrandAsset): number {
  const base =
    asset.kind === "logo" ? 4 : asset.kind === "favicon" ? 3 : asset.kind === "og-image" ? 2 : 1;
  return base + asset.confidence;
}

function readJsonLdBrandSignals(html: string, pageUrl: string): JsonLdBrandSignals {
  const objects: Readonly<Record<string, unknown>>[] = [];
  for (const tag of readPairedTags(html, "script")) {
    const type = tag.attrs.type?.toLowerCase() ?? "";
    if (!type.includes("ld+json")) continue;
    const raw = decodeHtmlEntities(tag.body ?? "").trim();
    if (raw.length === 0) continue;
    try {
      collectJsonLdObjects(JSON.parse(raw) as unknown, objects, 0);
    } catch {
      // Ignore malformed JSON-LD blocks; page metadata remains usable without them.
    }
  }

  for (const object of objects) {
    if (!isBrandLikeJsonLdObject(object)) continue;
    const name = readStringProperty(object, "name");
    const legalName = readStringProperty(object, "legalName");
    const description = readStringProperty(object, "description");
    const slogan = readStringProperty(object, "slogan");
    const logoUrl = readJsonLdUrl(object.logo, pageUrl);
    const imageUrl = readJsonLdUrl(object.image, pageUrl);
    return {
      ...(name === undefined ? {} : { name }),
      ...(legalName === undefined ? {} : { legalName }),
      ...(description === undefined ? {} : { description }),
      ...(slogan === undefined ? {} : { slogan }),
      ...(logoUrl === undefined ? {} : { logoUrl }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
    } satisfies JsonLdBrandSignals;
  }

  return {};
}

function collectJsonLdObjects(
  value: unknown,
  out: Readonly<Record<string, unknown>>[],
  depth: number,
): void {
  if (depth > 4) return;
  if (Array.isArray(value)) {
    for (const item of value) collectJsonLdObjects(item, out, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  out.push(value);
  const graph = value["@graph"];
  if (Array.isArray(graph)) {
    for (const item of graph) collectJsonLdObjects(item, out, depth + 1);
  }
}

function isBrandLikeJsonLdObject(value: Readonly<Record<string, unknown>>): boolean {
  const type = value["@type"];
  const types = Array.isArray(type) ? type.filter(isString) : isString(type) ? [type] : [];
  if (types.some((item) => /organization|localbusiness|corporation|website|brand/i.test(item))) {
    return true;
  }
  return isString(value.name) && (value.logo !== undefined || value.url !== undefined);
}

function readStringProperty(
  object: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = object[key];
  if (!isString(value)) return undefined;
  const normalized = normalizeSpace(value);
  return normalized.length === 0 ? undefined : normalized;
}

function readJsonLdUrl(value: unknown, pageUrl: string): string | undefined {
  if (isString(value)) return makeAbsoluteHttpsUrl(value, pageUrl);
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = readJsonLdUrl(item, pageUrl);
      if (url !== undefined) return url;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ["url", "contentUrl", "@id"] as const) {
    const urlValue = value[key];
    if (!isString(urlValue)) continue;
    const url = makeAbsoluteHttpsUrl(urlValue, pageUrl);
    if (url !== undefined) return url;
  }
  return undefined;
}

function readColorCandidates(
  html: string,
  themeColor: string | undefined,
): WebsiteBrandColorCandidate[] {
  const colors = new Map<string, ColorStats>();
  if (themeColor !== undefined) {
    addColor(colors, themeColor, "primary", "meta", 1, "theme-color", 'meta[name="theme-color"]');
  }

  for (const source of readCssSources(html)) {
    for (const declaration of source.css.matchAll(CSS_DECLARATION_RE)) {
      const property = (declaration[1] ?? "").toLowerCase();
      const value = declaration[2] ?? "";
      for (const color of readCssColors(value)) {
        addColor(
          colors,
          color,
          roleFromCssProperty(property, color),
          "css",
          1,
          property,
          source.selector,
        );
      }
    }
    for (const color of readCssColors(source.css)) {
      addColor(colors, color, "supporting", "css", 0.3, undefined, source.selector);
    }
  }

  return [...colors.entries()]
    .sort((left, right) => {
      const countDiff = right[1].count - left[1].count;
      if (countDiff !== 0) return countDiff;
      const roleDiff = rolePriority(right[1].role) - rolePriority(left[1].role);
      if (roleDiff !== 0) return roleDiff;
      return left[0].localeCompare(right[0]);
    })
    .map(([hex, stats]) => ({
      hex,
      role: stats.role,
      source: stats.source,
      count: stats.count,
      confidence: Math.min(0.96, stats.confidence + Math.min(stats.count, 10) * 0.04),
      ...(stats.selector === undefined ? {} : { selector: stats.selector }),
      ...(stats.property === undefined ? {} : { property: stats.property }),
    }));
}

function readCssSources(html: string): CssSource[] {
  const sources: CssSource[] = [];
  for (const tag of readPairedTags(html, "style")) {
    sources.push({ css: tag.body ?? "", selector: "style" });
  }
  for (const tagName of [
    "body",
    "header",
    "main",
    "section",
    "article",
    "footer",
    "div",
    "a",
    "button",
    "h1",
    "h2",
    "h3",
    "p",
    "span",
  ] as const) {
    for (const tag of readTags(html, tagName)) {
      const style = tag.attrs.style;
      if (style !== undefined && style.trim().length > 0) {
        sources.push({ css: style, selector: `${tagName}[style]` });
      }
    }
  }
  return sources;
}

function readCssColors(value: string): string[] {
  const colors: string[] = [];
  for (const match of value.matchAll(CSS_COLOR_TOKEN_RE)) {
    const normalized = normalizeCssColor(match[0] ?? "");
    if (normalized !== undefined) colors.push(normalized);
  }
  return colors;
}

function addColor(
  colors: Map<string, ColorStats>,
  hex: string,
  role: WebsiteBrandColorRole,
  source: WebsiteBrandColorSource,
  confidence: number,
  property: string | undefined,
  selector: string | undefined,
): void {
  const existing = colors.get(hex);
  if (existing === undefined) {
    colors.set(hex, {
      count: 1,
      role,
      source,
      confidence,
      ...(property === undefined ? {} : { property }),
      ...(selector === undefined ? {} : { selector }),
    });
    return;
  }
  existing.count += 1;
  existing.confidence = Math.max(existing.confidence, confidence);
  if (source === "meta" || (existing.source !== "meta" && source === "css"))
    existing.source = source;
  if (rolePriority(role) > rolePriority(existing.role)) existing.role = role;
  if (existing.property === undefined && property !== undefined) existing.property = property;
  if (existing.selector === undefined && selector !== undefined) existing.selector = selector;
}

function roleFromCssProperty(property: string, hex: string): WebsiteBrandColorRole {
  if (/primary/.test(property)) return "primary";
  if (/secondary/.test(property)) return "secondary";
  if (/accent|highlight|link|button|cta/.test(property)) return "accent";
  if (/background|bg/.test(property)) return isLightHex(hex) ? "background" : "accent";
  if (/surface|card|panel/.test(property)) return "surface";
  if (/text|foreground|fg/.test(property)) return "text";
  if (property === "color") return "text";
  if (/border|outline|stroke|fill/.test(property)) return "accent";
  if (/brand/.test(property)) return "primary";
  return "supporting";
}

function rolePriority(role: WebsiteBrandColorRole): number {
  switch (role) {
    case "primary":
      return 9;
    case "accent":
      return 8;
    case "secondary":
      return 7;
    case "text":
      return 6;
    case "background":
      return 5;
    case "surface":
      return 4;
    case "border":
      return 3;
    case "mutedText":
      return 2;
    case "supporting":
      return 1;
  }
}

function buildProposalPalette(
  candidates: readonly WebsiteBrandColorCandidate[],
  manualColors: Partial<ProposalBrandColors> | undefined,
  pageUrl: string,
): PaletteBuildResult {
  const primary = pickPaletteColor(
    readManualPaletteColor(manualColors, "primary"),
    firstByRole(candidates, "primary") ?? firstSaturated(candidates) ?? firstColor(candidates),
    DEFAULT_COLORS.primary,
    "primary",
  );
  const accent = pickPaletteColor(
    readManualPaletteColor(manualColors, "accent"),
    firstDistinct(
      candidates,
      primary.hex,
      (candidate) => candidate.role === "accent" || saturation(candidate.hex) >= 0.28,
    ),
    DEFAULT_COLORS.accent,
    "accent",
  );
  const secondary = pickPaletteColor(
    readManualPaletteColor(manualColors, "secondary"),
    firstDistinct(candidates, primary.hex, (candidate) => candidate.role === "secondary"),
    darkenHex(primary.hex, 0.18) ?? DEFAULT_COLORS.secondary,
    "secondary",
  );
  const background = pickPaletteColor(
    readManualPaletteColor(manualColors, "background"),
    firstByRole(candidates, "background") ??
      candidates.find((candidate) => isLightHex(candidate.hex)),
    DEFAULT_COLORS.background,
    "background",
  );
  const surface = pickPaletteColor(
    readManualPaletteColor(manualColors, "surface"),
    firstByRole(candidates, "surface") ??
      candidates.find((candidate) => isVeryLightHex(candidate.hex)),
    DEFAULT_COLORS.surface,
    "surface",
  );
  const textCandidate =
    firstByRole(candidates, "text") ??
    candidates
      .filter((candidate) => contrastRatio(candidate.hex, background.hex) >= 4.5)
      .sort(
        (left, right) =>
          contrastRatio(right.hex, background.hex) - contrastRatio(left.hex, background.hex),
      )[0];
  const text = pickPaletteColor(
    readManualPaletteColor(manualColors, "text"),
    textCandidate,
    contrastRatio(DEFAULT_COLORS.text, background.hex) >= 4.5 ? DEFAULT_COLORS.text : "#ffffff",
    "text",
  );
  const mutedText = pickPaletteColor(
    readManualPaletteColor(manualColors, "mutedText"),
    firstByRole(candidates, "mutedText"),
    mixHex(text.hex, background.hex, 0.62) ?? DEFAULT_COLORS.mutedText,
    "mutedText",
  );
  const border = pickPaletteColor(
    readManualPaletteColor(manualColors, "border"),
    firstByRole(candidates, "border"),
    mixHex(text.hex, background.hex, 0.15) ?? DEFAULT_COLORS.border,
    "border",
  );

  const picks = {
    primary,
    secondary,
    accent,
    background,
    surface,
    text,
    mutedText,
    border,
  } satisfies Record<keyof ProposalBrandColors, PalettePick>;
  const colors = {
    primary: primary.hex,
    secondary: secondary.hex,
    accent: accent.hex,
    background: background.hex,
    surface: surface.hex,
    text: text.hex,
    mutedText: mutedText.hex,
    border: border.hex,
  } satisfies ProposalBrandColors;
  const sources: Partial<Record<keyof ProposalBrandColors, WebsiteBrandFieldSource>> = {};
  for (const key of PALETTE_KEYS) {
    const pick = picks[key];
    sources[key] = {
      value: pick.hex,
      source: pick.source,
      pageUrl,
      confidence: pick.candidate?.confidence ?? (pick.source === "manual" ? 1 : 0.35),
      ...(pick.candidate?.selector === undefined ? {} : { selector: pick.candidate.selector }),
      ...(pick.candidate?.property === undefined ? {} : { attribute: pick.candidate.property }),
    };
  }
  return { colors, sources };
}

function readManualPaletteColor(
  manualColors: Partial<ProposalBrandColors> | undefined,
  key: keyof ProposalBrandColors,
): string | undefined {
  const value = manualColors?.[key];
  if (value === undefined) return undefined;
  return normalizeCssColor(value) ?? normalizeSpace(value);
}

function pickPaletteColor(
  manual: string | undefined,
  candidate: WebsiteBrandColorCandidate | undefined,
  fallback: string,
  role: WebsiteBrandColorRole,
): PalettePick {
  if (manual !== undefined && manual.length > 0) return { hex: manual, source: "manual" };
  if (candidate !== undefined) return { hex: candidate.hex, candidate, source: "css" };
  return {
    hex: fallback,
    candidate: { hex: fallback, role, source: "fallback", count: 0, confidence: 0.35 },
    source: "fallback",
  };
}

function firstByRole(
  candidates: readonly WebsiteBrandColorCandidate[],
  role: WebsiteBrandColorRole,
): WebsiteBrandColorCandidate | undefined {
  return candidates.find((candidate) => candidate.role === role);
}

function firstColor(
  candidates: readonly WebsiteBrandColorCandidate[],
): WebsiteBrandColorCandidate | undefined {
  return candidates[0];
}

function firstSaturated(
  candidates: readonly WebsiteBrandColorCandidate[],
): WebsiteBrandColorCandidate | undefined {
  return candidates.find(
    (candidate) => saturation(candidate.hex) >= 0.22 && !isVeryLightHex(candidate.hex),
  );
}

function firstDistinct(
  candidates: readonly WebsiteBrandColorCandidate[],
  existingHex: string,
  predicate: (candidate: WebsiteBrandColorCandidate) => boolean,
): WebsiteBrandColorCandidate | undefined {
  return candidates.find((candidate) => candidate.hex !== existingHex && predicate(candidate));
}

function buildProposalBrand(input: {
  readonly name: string;
  readonly tagline?: string;
  readonly finalUrl: string;
  readonly canonicalUrl?: string;
  readonly jsonLd: JsonLdBrandSignals;
  readonly manualOverrides?: WebsiteBrandManualOverrides;
  readonly palette: ProposalBrandColors;
}): ProposalBrand {
  const manual = input.manualOverrides;
  const name = normalizeSpace(manual?.name ?? input.name) || "Imported Brand";
  const tagline = normalizeSpace(manual?.tagline ?? input.tagline ?? "");
  const legalName = normalizeSpace(manual?.legalName ?? input.jsonLd.legalName ?? "");
  const website = normalizeSpace(manual?.website ?? input.canonicalUrl ?? input.finalUrl);
  const email = normalizeSpace(manual?.email ?? "");
  const phone = normalizeSpace(manual?.phone ?? "");
  const logoText = normalizeSpace(manual?.logoText ?? initialsForName(name));
  return {
    id: normalizeSpace(manual?.id ?? "") || slugify(name),
    name,
    logoText,
    colors: input.palette,
    ...(legalName.length === 0 ? {} : { legalName }),
    ...(tagline.length === 0 ? {} : { tagline }),
    ...(website.length === 0 ? {} : { website }),
    ...(email.length === 0 ? {} : { email }),
    ...(phone.length === 0 ? {} : { phone }),
  } satisfies ProposalBrand;
}

function normalizeCssColor(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === "transparent" || trimmed === "currentcolor")
    return undefined;
  if (trimmed.startsWith("#")) return normalizeHexColor(trimmed);
  if (trimmed.startsWith("rgb")) return normalizeRgbColor(trimmed);
  if (trimmed.startsWith("hsl")) return normalizeHslColor(trimmed);
  if (trimmed === "white") return "#ffffff";
  if (trimmed === "black") return "#000000";
  return undefined;
}

function normalizeHexColor(value: string): string | undefined {
  const hex = value.toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(hex)) {
    const chars = hex.slice(1).split("");
    const red = chars[0];
    const green = chars[1];
    const blue = chars[2];
    if (red === undefined || green === undefined || blue === undefined) return undefined;
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  if (/^#[0-9a-f]{4}$/.test(hex)) {
    const chars = hex.slice(1).split("");
    const red = chars[0];
    const green = chars[1];
    const blue = chars[2];
    const alpha = chars[3];
    if (red === undefined || green === undefined || blue === undefined || alpha === undefined) {
      return undefined;
    }
    if (alpha === "0") return undefined;
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  if (/^#[0-9a-f]{8}$/.test(hex)) {
    const alpha = Number.parseInt(hex.slice(7, 9), 16);
    if (alpha === 0) return undefined;
    return hex.slice(0, 7);
  }
  return undefined;
}

function normalizeRgbColor(value: string): string | undefined {
  const body = value
    .replace(/^rgba?\(/, "")
    .replace(/\)$/, "")
    .replace(/\//g, " ");
  const parts = body.split(/[\s,]+/).filter(Boolean);
  const red = parseCssRgbComponent(parts[0]);
  const green = parseCssRgbComponent(parts[1]);
  const blue = parseCssRgbComponent(parts[2]);
  const alpha = parseCssAlpha(parts[3]);
  if (red === undefined || green === undefined || blue === undefined || alpha === 0)
    return undefined;
  return rgbToHex({ red, green, blue });
}

function normalizeHslColor(value: string): string | undefined {
  const body = value
    .replace(/^hsla?\(/, "")
    .replace(/\)$/, "")
    .replace(/\//g, " ");
  const parts = body.split(/[\s,]+/).filter(Boolean);
  const hue = Number.parseFloat(parts[0] ?? "");
  const saturationPart = parsePercentage(parts[1]);
  const lightness = parsePercentage(parts[2]);
  const alpha = parseCssAlpha(parts[3]);
  if (
    !Number.isFinite(hue) ||
    saturationPart === undefined ||
    lightness === undefined ||
    alpha === 0
  ) {
    return undefined;
  }
  return rgbToHex(hslToRgb(hue, saturationPart, lightness));
}

function parseCssRgbComponent(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));
    if (!Number.isFinite(percent)) return undefined;
    return clampByte(Math.round((percent / 100) * 255));
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? clampByte(Math.round(parsed)) : undefined;
}

function parseCssAlpha(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value.endsWith("%")) {
    const percent = Number.parseFloat(value.slice(0, -1));
    return Number.isFinite(percent) ? Math.max(0, Math.min(1, percent / 100)) : undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : undefined;
}

function parsePercentage(value: string | undefined): number | undefined {
  if (value === undefined || !value.endsWith("%")) return undefined;
  const parsed = Number.parseFloat(value.slice(0, -1));
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed / 100)) : undefined;
}

function hslToRgb(hue: number, saturationValue: number, lightness: number): Rgb {
  const normalizedHue = (((hue % 360) + 360) % 360) / 360;
  if (saturationValue === 0) {
    const value = clampByte(Math.round(lightness * 255));
    return { red: value, green: value, blue: value };
  }
  const q =
    lightness < 0.5
      ? lightness * (1 + saturationValue)
      : lightness + saturationValue - lightness * saturationValue;
  const p = 2 * lightness - q;
  return {
    red: clampByte(Math.round(hueToRgb(p, q, normalizedHue + 1 / 3) * 255)),
    green: clampByte(Math.round(hueToRgb(p, q, normalizedHue) * 255)),
    blue: clampByte(Math.round(hueToRgb(p, q, normalizedHue - 1 / 3) * 255)),
  };
}

function hueToRgb(p: number, q: number, tInput: number): number {
  let t = tInput;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

function hexToRgb(hex: string): Rgb | undefined {
  const normalized = normalizeHexColor(hex);
  if (normalized === undefined) return undefined;
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  if ([red, green, blue].some((value) => Number.isNaN(value))) return undefined;
  return { red, green, blue };
}

function rgbToHex(rgb: Rgb): string {
  return `#${toHexByte(rgb.red)}${toHexByte(rgb.green)}${toHexByte(rgb.blue)}`;
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mixHex(
  foreground: string,
  background: string,
  foregroundWeight: number,
): string | undefined {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  if (fg === undefined || bg === undefined) return undefined;
  const weight = Math.max(0, Math.min(1, foregroundWeight));
  return rgbToHex({
    red: fg.red * weight + bg.red * (1 - weight),
    green: fg.green * weight + bg.green * (1 - weight),
    blue: fg.blue * weight + bg.blue * (1 - weight),
  });
}

function darkenHex(hex: string, amount: number): string | undefined {
  const rgb = hexToRgb(hex);
  if (rgb === undefined) return undefined;
  const factor = Math.max(0, Math.min(1, 1 - amount));
  return rgbToHex({ red: rgb.red * factor, green: rgb.green * factor, blue: rgb.blue * factor });
}

function isLightHex(hex: string): boolean {
  return relativeLuminance(hex) > 0.72;
}

function isVeryLightHex(hex: string): boolean {
  return relativeLuminance(hex) > 0.9;
}

function saturation(hex: string): number {
  const rgb = hexToRgb(hex);
  if (rgb === undefined) return 0;
  const red = rgb.red / 255;
  const green = rgb.green / 255;
  const blue = rgb.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  if (max === min) return 0;
  const lightness = (max + min) / 2;
  return lightness > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

function contrastRatio(left: string, right: string): number {
  const leftLum = relativeLuminance(left);
  const rightLum = relativeLuminance(right);
  const lighter = Math.max(leftLum, rightLum);
  const darker = Math.min(leftLum, rightLum);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (rgb === undefined) return 0;
  const channels = [rgb.red, rgb.green, rgb.blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (channels[0] ?? 0) * 0.2126 + (channels[1] ?? 0) * 0.7152 + (channels[2] ?? 0) * 0.0722;
}

function makeAbsoluteHttpsUrl(value: string, pageUrl: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /^data:|^blob:|^javascript:/i.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed, pageUrl);
    if (url.protocol !== "https:") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function readTags(html: string, tagName: string): AttributeMatch[] {
  const matches: AttributeMatch[] = [];
  const re = tagRegex(tagName);
  for (const match of html.matchAll(re)) {
    matches.push({
      tag: tagName,
      attrs: readAttributes(match[1] ?? ""),
      index: match.index ?? 0,
    });
  }
  return matches;
}

function readPairedTags(html: string, tagName: string): AttributeMatch[] {
  const matches: AttributeMatch[] = [];
  const re = new RegExp(`<${tagName}\\b([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  for (const match of html.matchAll(re)) {
    matches.push({
      tag: tagName,
      attrs: readAttributes(match[1] ?? ""),
      body: match[2] ?? "",
      index: match.index ?? 0,
    });
  }
  return matches;
}

function tagRegex(tagName: string): RegExp {
  const existing = TAG_RE_CACHE.get(tagName);
  if (existing !== undefined) return existing;
  const created = new RegExp(`<${tagName}\\b([^>]*)>`, "gi");
  TAG_RE_CACHE.set(tagName, created);
  return created;
}

function readAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of raw.matchAll(ATTR_RE)) {
    const key = (match[1] ?? "").toLowerCase();
    if (key.length === 0) continue;
    attrs[key] = decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ");
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueStrings(values: readonly string[], maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const normalized = normalizeSpace(value);
    const key = normalized.toLowerCase();
    if (normalized.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxCount) break;
  }
  return out;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length === 0 ? "website-brand" : slug;
}

function initialsForName(value: string): string {
  const words = value
    .replace(/&/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);
  const first = words[0];
  const second = words[1];
  if (first === undefined) return "WB";
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
