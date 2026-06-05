import { describe, expect, it } from "vitest";
import type { WebsiteBrandLookup } from "./types.js";
import { acmeWebsiteHtml } from "./fixtures/acmeWebsite.js";
import {
  WebsiteBrandFetchError,
  extractWebsiteBrand,
  extractWebsiteBrandFromHtml,
  fetchWebsiteBrandPage,
  isBlockedNetworkAddress,
  validateWebsiteBrandFetchUrl,
} from "./websiteBrand.node.js";

const publicLookup: WebsiteBrandLookup = async (hostname) => {
  if (hostname === "acme.example" || hostname === "www.acme.example") {
    return [{ address: "93.184.216.34", family: 4 }];
  }
  if (hostname === "private.example") return [{ address: "10.0.0.7", family: 4 }];
  if (hostname === "metadata.example") return [{ address: "169.254.169.254", family: 4 }];
  return [{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }];
};

function htmlResponse(html: string, init: ResponseInit = {}): Response {
  return new Response(html, {
    status: 200,
    ...init,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...init.headers,
    },
  });
}

describe("website brand URL safety", () => {
  it("blocks localhost, private, link-local, and internal targets before fetching", async () => {
    await expect(
      validateWebsiteBrandFetchUrl("http://acme.example", { lookupHost: publicLookup }),
    ).rejects.toMatchObject({
      code: "BAD_SCHEME",
    });
    await expect(
      validateWebsiteBrandFetchUrl("https://localhost", { lookupHost: publicLookup }),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
    await expect(
      validateWebsiteBrandFetchUrl("https://printer.local", { lookupHost: publicLookup }),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
    await expect(
      validateWebsiteBrandFetchUrl("https://private.example", { lookupHost: publicLookup }),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });
    await expect(
      validateWebsiteBrandFetchUrl("https://metadata.example", { lookupHost: publicLookup }),
    ).rejects.toMatchObject({
      code: "BLOCKED_ADDRESS",
    });

    await expect(
      validateWebsiteBrandFetchUrl("acme.example", { lookupHost: publicLookup }),
    ).resolves.toMatchObject({
      href: "https://acme.example/",
    });
  });

  it("classifies blocked IP ranges including IPv4-mapped IPv6", () => {
    expect(isBlockedNetworkAddress("127.0.0.1")).toBe(true);
    expect(isBlockedNetworkAddress("10.1.2.3")).toBe(true);
    expect(isBlockedNetworkAddress("172.20.0.1")).toBe(true);
    expect(isBlockedNetworkAddress("192.168.1.2")).toBe(true);
    expect(isBlockedNetworkAddress("169.254.169.254")).toBe(true);
    expect(isBlockedNetworkAddress("::1")).toBe(true);
    expect(isBlockedNetworkAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedNetworkAddress("93.184.216.34")).toBe(false);
  });
});

describe("fetchWebsiteBrandPage", () => {
  it("fetches public HTML with normalized URL metadata", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      expect(String(input)).toBe("https://acme.example/");
      return htmlResponse(acmeWebsiteHtml);
    };

    const result = await fetchWebsiteBrandPage("acme.example", {
      fetchImpl,
      lookupHost: publicLookup,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.normalizedUrl).toBe("https://acme.example/");
    expect(result.finalUrl).toBe("https://acme.example/");
    expect(result.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.statusCode).toBe(200);
    expect(result.bytesRead).toBeGreaterThan(1_000);
    expect(result.contentType).toContain("text/html");
  });

  it("re-validates redirects and blocks redirects to private hosts", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://private.example/admin" },
      });

    await expect(
      fetchWebsiteBrandPage("https://acme.example", {
        fetchImpl,
        lookupHost: publicLookup,
      }),
    ).rejects.toMatchObject({ code: "BLOCKED_ADDRESS" });
  });

  it("enforces response byte limits from content-length", async () => {
    const fetchImpl: typeof fetch = async () =>
      htmlResponse("<html><body>too large</body></html>", {
        headers: { "content-length": "60000" },
      });

    await expect(
      fetchWebsiteBrandPage("https://acme.example", {
        fetchImpl,
        lookupHost: publicLookup,
        maxBytes: 50_000,
      }),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE" });
  });

  it("enforces request timeouts", async () => {
    const fetchImpl: typeof fetch = async (_input, init) => {
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };

    await expect(
      fetchWebsiteBrandPage("https://acme.example", {
        fetchImpl,
        lookupHost: publicLookup,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("extractWebsiteBrandFromHtml", () => {
  it("extracts meta, assets, CSS colors, and a ProposalBrand-compatible palette", () => {
    const result = extractWebsiteBrandFromHtml(acmeWebsiteHtml, "https://acme.example/", {
      fetchedAt: "2026-01-01T00:00:00.000Z",
      contentType: "text/html; charset=utf-8",
      bytesRead: 1234,
      elapsedMs: 42,
    });

    expect(result.name).toBe("Acme Growth Studio");
    expect(result.tagline).toBe("Book more premium clients without guessing.");
    expect(result.meta).toMatchObject({
      title: "Acme Growth Studio | Premium websites for local teams",
      description:
        "Premium websites and automation for local service teams that want more booked calls.",
      canonicalUrl: "https://acme.example/home",
      themeColor: "#123456",
      ogImage: "https://acme.example/og/acme-share.png",
    });
    expect(result.logoUrl).toBe("https://acme.example/assets/acme-logo.svg");
    expect(result.favicons.map((asset) => asset.url)).toEqual([
      "https://acme.example/apple-touch-icon.png",
      "https://acme.example/favicon.ico",
    ]);
    expect(result.logos[0]).toMatchObject({
      url: "https://acme.example/assets/acme-logo.svg",
      kind: "logo",
    });
    expect(result.ogImages.map((asset) => asset.url)).toEqual(
      expect.arrayContaining([
        "https://acme.example/assets/acme-office.jpg",
        "https://acme.example/og/acme-share.png",
        "https://cdn.acme.example/twitter-card.jpg",
      ]),
    );
    expect(result.colors.map((color) => color.hex)).toEqual(
      expect.arrayContaining(["#123456", "#334155", "#f97316", "#f8fafc", "#111827"]),
    );
    expect(result.palette).toMatchObject({
      primary: "#123456",
      secondary: "#334155",
      accent: "#f97316",
      background: "#f8fafc",
      surface: "#ffffff",
      text: "#111827",
    });
    expect(result.proposalBrand).toMatchObject({
      id: "acme-growth-studio",
      name: "Acme Growth Studio",
      legalName: "Acme Growth Studio LLC",
      tagline: "Book more premium clients without guessing.",
      website: "https://acme.example/home",
      logoText: "AG",
      colors: result.palette,
    });
    expect(result.source).toMatchObject({
      finalUrl: "https://acme.example/",
      extractor: "scopeforge.websiteBrand.node",
      extractorVersion: 1,
      bytesRead: 1234,
      elapsedMs: 42,
    });
    expect(result.sources.name.source).toBe("json-ld");
    expect(result.sources.logoUrl).toMatchObject({ source: "json-ld", attribute: "logo" });
    expect(result.sources.colors.primary?.value).toBe("#123456");
  });

  it("preserves source metadata and manual override fields", () => {
    const result = extractWebsiteBrandFromHtml(acmeWebsiteHtml, "https://acme.example/", {
      requestedUrl: "https://www.acme.example/?utm=1",
      normalizedUrl: "https://www.acme.example/?utm=1",
      fetchedAt: "2026-02-02T00:00:00.000Z",
      statusCode: 200,
      contentType: "text/html",
      bytesRead: 2222,
      elapsedMs: 99,
      redirects: [
        { from: "https://www.acme.example/", to: "https://acme.example/", statusCode: 301 },
      ],
      warnings: ["fixture warning"],
      manualOverrides: {
        id: "custom-brand",
        name: "Custom Brand",
        legalName: "Custom Brand Inc.",
        tagline: "Manual tagline.",
        website: "https://brand.example",
        email: "hello@brand.example",
        phone: "+1 555 0100",
        logoText: "CB",
        logoUrl: "https://brand.example/logo.png",
        colors: {
          primary: "#000000",
          accent: "rgb(255, 0, 0)",
        },
        source: "user-review",
        notes: ["approved manually"],
      },
    });

    expect(result.proposalBrand).toMatchObject({
      id: "custom-brand",
      name: "Custom Brand",
      legalName: "Custom Brand Inc.",
      tagline: "Manual tagline.",
      website: "https://brand.example",
      email: "hello@brand.example",
      phone: "+1 555 0100",
      logoText: "CB",
      colors: expect.objectContaining({ primary: "#000000", accent: "#ff0000" }),
    });
    expect(result.logoUrl).toBe("https://brand.example/logo.png");
    expect(result.sources.name).toMatchObject({ source: "manual", value: "Custom Brand" });
    expect(result.sources.logoUrl).toMatchObject({
      source: "manual",
      value: "https://brand.example/logo.png",
    });
    expect(result.sources.colors.primary).toMatchObject({ source: "manual", value: "#000000" });
    expect(result.manualOverrides).toMatchObject({
      source: "user-review",
      notes: ["approved manually"],
    });
    expect(result.source).toMatchObject({
      requestedUrl: "https://www.acme.example/?utm=1",
      normalizedUrl: "https://www.acme.example/?utm=1",
      finalUrl: "https://acme.example/",
      fetchedAt: "2026-02-02T00:00:00.000Z",
      redirects: [
        { from: "https://www.acme.example/", to: "https://acme.example/", statusCode: 301 },
      ],
      warnings: ["fixture warning"],
    });
  });
});

describe("extractWebsiteBrand", () => {
  it("fetches then extracts a ProposalBrand", async () => {
    const fetchImpl: typeof fetch = async () => htmlResponse(acmeWebsiteHtml);

    const result = await extractWebsiteBrand("https://acme.example", {
      fetchImpl,
      lookupHost: publicLookup,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(result.proposalBrand.name).toBe("Acme Growth Studio");
    expect(result.proposalBrand.colors.primary).toBe("#123456");
    expect(result.source.fetchedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("throws typed fetch errors for callers", async () => {
    await expect(
      extractWebsiteBrand("https://localhost", { lookupHost: publicLookup }),
    ).rejects.toBeInstanceOf(WebsiteBrandFetchError);
  });
});
