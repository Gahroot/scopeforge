import type { ProposalBrand, ProposalBrandColors } from "../proposal/types.js";

export type WebsiteBrandAssetKind = "favicon" | "logo" | "og-image" | "image";

export type WebsiteBrandAssetSource = "link" | "meta" | "image" | "json-ld";

export type WebsiteBrandColorRole =
  | "primary"
  | "secondary"
  | "accent"
  | "background"
  | "surface"
  | "text"
  | "mutedText"
  | "border"
  | "supporting";

export type WebsiteBrandColorSource = "meta" | "css" | "manual" | "fallback";

export type WebsiteBrandSignalSource =
  | "manual"
  | "meta"
  | "title"
  | "heading"
  | "json-ld"
  | "link"
  | "image"
  | "css"
  | "url"
  | "fallback";

export interface WebsiteBrandFieldSource {
  readonly value: string;
  readonly source: WebsiteBrandSignalSource;
  readonly pageUrl?: string;
  readonly selector?: string;
  readonly attribute?: string;
  readonly confidence?: number;
}

export interface WebsiteBrandResolvedAddress {
  readonly address: string;
  readonly family: 4 | 6;
}

export type WebsiteBrandLookup = (
  hostname: string,
) => Promise<readonly WebsiteBrandResolvedAddress[]>;

export interface WebsiteBrandRedirect {
  readonly from: string;
  readonly to: string;
  readonly statusCode: number;
}

export interface WebsiteBrandSourceMetadata {
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly statusCode: number;
  readonly bytesRead: number;
  readonly elapsedMs: number;
  readonly extractor: "scopeforge.websiteBrand.node";
  readonly extractorVersion: 1;
  readonly redirects: readonly WebsiteBrandRedirect[];
  readonly warnings: readonly string[];
  readonly contentType?: string;
}

export interface WebsiteBrandMeta {
  readonly title?: string;
  readonly description?: string;
  readonly canonicalUrl?: string;
  readonly applicationName?: string;
  readonly ogSiteName?: string;
  readonly ogTitle?: string;
  readonly ogDescription?: string;
  readonly ogImage?: string;
  readonly twitterTitle?: string;
  readonly twitterDescription?: string;
  readonly twitterImage?: string;
  readonly themeColor?: string;
}

export interface WebsiteBrandAsset {
  readonly url: string;
  readonly kind: WebsiteBrandAssetKind;
  readonly source: WebsiteBrandAssetSource;
  readonly sourcePageUrl: string;
  readonly confidence: number;
  readonly selector?: string;
  readonly rel?: string;
  readonly mimeType?: string;
  readonly sizes?: string;
  readonly width?: number;
  readonly height?: number;
  readonly altText?: string;
}

export interface WebsiteBrandColorCandidate {
  readonly hex: string;
  readonly role: WebsiteBrandColorRole;
  readonly source: WebsiteBrandColorSource;
  readonly count: number;
  readonly confidence: number;
  readonly selector?: string;
  readonly property?: string;
}

export interface WebsiteBrandManualOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly legalName?: string;
  readonly tagline?: string;
  readonly website?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly logoText?: string;
  readonly logoUrl?: string;
  readonly colors?: Partial<ProposalBrandColors>;
  readonly source?: string;
  readonly notes?: readonly string[];
}

export interface WebsiteBrandExtractionSources {
  readonly name: WebsiteBrandFieldSource;
  readonly tagline?: WebsiteBrandFieldSource;
  readonly logoUrl?: WebsiteBrandFieldSource;
  readonly colors: Readonly<Partial<Record<keyof ProposalBrandColors, WebsiteBrandFieldSource>>>;
}

export interface WebsiteBrandExtractionResult {
  readonly proposalBrand: ProposalBrand;
  readonly palette: ProposalBrandColors;
  readonly meta: WebsiteBrandMeta;
  readonly assets: readonly WebsiteBrandAsset[];
  readonly favicons: readonly WebsiteBrandAsset[];
  readonly logos: readonly WebsiteBrandAsset[];
  readonly ogImages: readonly WebsiteBrandAsset[];
  readonly colors: readonly WebsiteBrandColorCandidate[];
  readonly source: WebsiteBrandSourceMetadata;
  readonly sources: WebsiteBrandExtractionSources;
  readonly manualOverrides?: WebsiteBrandManualOverrides;
  readonly name?: string;
  readonly tagline?: string;
  readonly logoUrl?: string;
}

export interface WebsiteBrandFetchOptions {
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly maxRedirects?: number;
  readonly fetchImpl?: typeof fetch;
  readonly lookupHost?: WebsiteBrandLookup;
}

export interface ExtractWebsiteBrandOptions extends WebsiteBrandFetchOptions {
  readonly now?: () => Date;
  readonly manualOverrides?: WebsiteBrandManualOverrides;
}

export interface ExtractWebsiteBrandFromHtmlOptions {
  readonly requestedUrl?: string;
  readonly normalizedUrl?: string;
  readonly fetchedAt?: string;
  readonly statusCode?: number;
  readonly contentType?: string;
  readonly bytesRead?: number;
  readonly elapsedMs?: number;
  readonly redirects?: readonly WebsiteBrandRedirect[];
  readonly warnings?: readonly string[];
  readonly manualOverrides?: WebsiteBrandManualOverrides;
}

export interface WebsiteBrandFetchedPage {
  readonly html: string;
  readonly requestedUrl: string;
  readonly normalizedUrl: string;
  readonly finalUrl: string;
  readonly fetchedAt: string;
  readonly statusCode: number;
  readonly bytesRead: number;
  readonly elapsedMs: number;
  readonly redirects: readonly WebsiteBrandRedirect[];
  readonly warnings: readonly string[];
  readonly contentType?: string;
}
