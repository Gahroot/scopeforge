import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EnabledAgentConfig } from "../agent/config.node.js";
import { buildSessionSnapshot } from "../agent/session.node.js";
import type { WebsiteBrandExtractionResult } from "../brand/types.js";
import { tritenExample } from "../data/defaults.js";
import {
  createLocalProposalProjectStore,
  type LocalProposalProjectStore,
} from "../project/store.node.js";
import type { ProposalProjectId, ProposalProjectVersionId } from "../project/types.js";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
import { proposalIntakeToDraft, updateDraftDetails } from "../proposal/draftStore.js";
import type { ProposalBrand, ProposalDraft, ProposalIntake } from "../proposal/types.js";
import type { AgentStreamFrame, SessionSnapshot } from "../ui/lib/types.js";
import type { ProposalAgentStreamRunner } from "./agentStream.node.js";
import { startAppServer, type RunningAppServer } from "./appServer.js";
import type { ProposalPdfRenderer, WebsiteBrandExtractor } from "./routes.js";

const CREATED_AT = "2026-06-07T12:00:00.000Z";
const VENDOR_IMPORTED_AT = "2026-06-07T12:05:00.000Z";
const CLIENT_IMPORTED_AT = "2026-06-07T12:10:00.000Z";
const PARTNER_A_SAVED_AT = "2026-06-07T12:20:00.000Z";
const PARTNER_B_SAVED_AT = "2026-06-07T12:30:00.000Z";
const PREVIEW_SAVED_AT = "2026-06-07T12:40:00.000Z";
const EXPORT_HTML_SAVED_AT = "2026-06-07T12:50:00.000Z";
const EXPORT_PDF_SAVED_AT = "2026-06-07T12:51:00.000Z";
const GENERATED_AT = "2026-06-07T13:00:00.000Z";

const PARTNER_A_TITLE = "Partner A saved operating pilot";
const PARTNER_B_RECOMMENDATION =
  "Partner B tightened the latest recommendation from Partner A's draft.";

const FAKE_AGENT_CONFIG = {
  enabled: true,
  provider: "openai",
  model: "fake-collaboration-agent",
  apiKey: "test-key",
  apiKeyEnvVar: "SCOPEFORGE_AGENT_API_KEY",
} satisfies EnabledAgentConfig;

const vendorBrand = {
  id: "forge-collective",
  name: "Forge Collective",
  legalName: "Forge Collective LLC",
  tagline: "Senior operators for practical AI systems.",
  website: "https://vendor.example/",
  email: "hello@vendor.example",
  logoText: "FC",
  colors: {
    primary: "#3b0764",
    secondary: "#581c87",
    accent: "#f59e0b",
    background: "#faf5ff",
    surface: "#ffffff",
    text: "#111827",
    mutedText: "#6b7280",
    border: "#e9d5ff",
  },
} satisfies ProposalBrand;

const clientBrand = {
  id: "atlas-client-ops",
  name: "Atlas Client Ops",
  legalName: "Atlas Client Ops Inc.",
  tagline: "Premium field operations without guesswork.",
  website: "https://client.example/",
  logoText: "ACO",
  colors: {
    primary: "#0f172a",
    secondary: "#1e293b",
    accent: "#14b8a6",
    background: "#f0fdfa",
    surface: "#ffffff",
    text: "#111827",
    mutedText: "#64748b",
    border: "#ccfbf1",
  },
} satisfies ProposalBrand;

interface JsonHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
}

interface BinaryHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
}

interface AgentMessageHttpResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly frames: readonly AgentStreamFrame[];
  readonly body: unknown;
}

interface FakeAgentCall {
  readonly message: string;
  readonly sessionId: string;
  readonly author: string;
  readonly projectVersionId?: string;
}

describe("collaborative proposal workflow over local APIs", () => {
  it("persists fresh project-backed agent chats, rejects stale bases, and renders the newest branded draft", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "scopeforge-collab-workflow-"));
    const agentCalls: FakeAgentCall[] = [];
    const sessionIds = ["partner-a-chat", "partner-b-chat"];
    const pdfBytes = new Uint8Array(Buffer.from("%PDF-collaborative-workflow-test"));

    let exportedHtml = "";
    let server: RunningAppServer | null = null;

    try {
      server = await startWorkflowServer({
        dataDir,
        runProposalAgentStream: fakeProposalAgentRunner(agentCalls),
        sessionIdFactory: () => nextQueuedValue(sessionIds, "session id"),
        renderPdf: async (request) => {
          exportedHtml = request.html;
          return { bytes: pdfBytes, format: request.format };
        },
      });

      const createJson = await postJson(server.url, "/api/proposal-projects", {
        draft: workflowDraft(),
        brand: BUILT_IN_BRANDS.nolan,
        clientBrand: BUILT_IN_BRANDS.partners,
        title: "Collaborative workflow workspace",
        displayName: "Workspace Owner",
        createdAt: CREATED_AT,
      });
      const createdProject = readRecordField(createJson.body, "project");
      const projectId = readStringField(createdProject, "projectId");
      const initialVersionId = readStringField(createdProject, "currentVersionId");

      expect(createJson.status).toBe(201);
      expect(projectId).toBe("workflow-project-1");
      expect(initialVersionId).toBe("workflow-version-1-1");

      const vendorImportJson = await postJson(
        server.url,
        `/api/proposal-projects/${projectId}/brands/import`,
        {
          role: "vendor",
          url: "vendor.example",
          baseVersionId: initialVersionId,
          displayName: "Brand Partner",
          createdAt: VENDOR_IMPORTED_AT,
        },
      );
      const vendorImportedVersion = readRecordField(vendorImportJson.body, "currentVersion");
      const vendorVersionId = readStringField(vendorImportedVersion, "versionId");
      const vendorSource = readRecordField(vendorImportJson.body, "sourceOfTruth");

      expect(vendorImportJson.status).toBe(200);
      expect(vendorVersionId).toBe("workflow-version-2-2");
      expect(readStringField(readRecordField(vendorSource, "vendorBrand"), "id")).toBe(
        "forge-collective",
      );

      const clientImportJson = await postJson(
        server.url,
        `/api/proposal-projects/${projectId}/brands/import`,
        {
          role: "client",
          url: "client.example",
          baseVersionId: vendorVersionId,
          displayName: "Brand Partner",
          createdAt: CLIENT_IMPORTED_AT,
        },
      );
      const clientImportedVersion = readRecordField(clientImportJson.body, "currentVersion");
      const brandedBaseVersionId = readStringField(clientImportedVersion, "versionId");
      const clientSource = readRecordField(clientImportJson.body, "sourceOfTruth");
      const clientDraft = readRecordField(clientSource, "draft");
      const preparedFor = readRecordField(clientDraft, "preparedFor");

      expect(clientImportJson.status).toBe(200);
      expect(brandedBaseVersionId).toBe("workflow-version-3-3");
      expect(readStringField(readRecordField(clientSource, "clientBrand"), "id")).toBe(
        "atlas-client-ops",
      );
      expect(readStringField(preparedFor, "companyName")).toBe("Atlas Client Ops");
      expect(readStringField(preparedFor, "accentColor")).toBe("#14b8a6");

      const partnerAChat = await postAgentMessage(server.url, {
        message: "Partner A: save the stronger proposal title.",
        projectId,
        baseVersion: brandedBaseVersionId,
        displayName: "Partner A",
      });
      const partnerASessionId = readSessionId(partnerAChat.frames);
      const partnerASnapshot = readSnapshot(partnerAChat.frames);
      const partnerAVersionId = readRequiredString(
        partnerASnapshot.projectVersionId,
        "partner A project version",
      );

      expect(partnerAChat.status).toBe(200);
      expect(partnerASessionId).toBe("partner-a-chat");
      expect(partnerAVersionId).toBe("workflow-version-4-4");
      expect(partnerASnapshot.fullDraft.details.title).toBe(PARTNER_A_TITLE);
      expect(partnerASnapshot.fullDraft.details.recommendation).not.toBe(PARTNER_B_RECOMMENDATION);

      const partnerBChat = await postAgentMessage(server.url, {
        message: "Partner B: start fresh from latest and save the recommendation.",
        projectId,
        sessionId: partnerASessionId,
        baseVersion: brandedBaseVersionId,
        newChatFromLatestProject: true,
        displayName: "Partner B",
      });
      const partnerBSessionId = readSessionId(partnerBChat.frames);
      const partnerBSnapshot = readSnapshot(partnerBChat.frames);
      const newestVersionId = readRequiredString(
        partnerBSnapshot.projectVersionId,
        "partner B project version",
      );

      expect(partnerBChat.status).toBe(200);
      expect(partnerBSessionId).toBe("partner-b-chat");
      expect(partnerBSessionId).not.toBe(partnerASessionId);
      expect(newestVersionId).toBe("workflow-version-5-5");
      expect(partnerBSnapshot.fullDraft.details.title).toBe(PARTNER_A_TITLE);
      expect(partnerBSnapshot.fullDraft.details.recommendation).toBe(PARTNER_B_RECOMMENDATION);
      expect(agentCalls).toEqual([
        {
          message: "Partner A: save the stronger proposal title.",
          sessionId: "partner-a-chat",
          author: "Partner A",
          projectVersionId: brandedBaseVersionId,
        },
        {
          message: "Partner B: start fresh from latest and save the recommendation.",
          sessionId: "partner-b-chat",
          author: "Partner B",
          projectVersionId: partnerAVersionId,
        },
      ]);

      const staleChat = await postAgentMessage(server.url, {
        message: "Partner C: try to overwrite from the stale branded base.",
        projectId,
        baseVersion: brandedBaseVersionId,
        displayName: "Partner C",
      });
      const staleError = readRecordField(staleChat.body, "error");
      const staleLatestProject = readRecordField(staleError, "latestProject");

      expect(staleChat.status).toBe(409);
      expect(staleChat.frames).toEqual([]);
      expect(readStringField(staleError, "code")).toBe("base_version_conflict");
      expect(readStringField(staleLatestProject, "currentVersionId")).toBe(newestVersionId);
      expect(readNumberField(staleLatestProject, "currentVersionNumber")).toBe(5);
      expect(agentCalls).toHaveLength(2);

      const previewJson = await postJson(
        server.url,
        `/api/proposal-projects/${projectId}/preview`,
        {
          baseVersionId: newestVersionId,
          audience: "client",
          brand: BUILT_IN_BRANDS.nolan,
          iterations: 500,
          generatedAt: GENERATED_AT,
          displayName: "Preview Partner",
        },
      );
      const previewHtml = readStringField(previewJson.body, "html");
      const previewBrand = readRecordField(previewJson.body, "brand");
      const previewArtifact = readRecordField(previewJson.body, "artifact");

      expect(previewJson.status).toBe(200);
      expect(readStringField(previewJson.body, "currentVersionId")).toBe(newestVersionId);
      expect(readStringField(previewBrand, "id")).toBe("forge-collective");
      expect(readStringField(previewArtifact, "sourceVersionId")).toBe(newestVersionId);
      expect(previewHtml).toContain(PARTNER_A_TITLE);
      expect(previewHtml).toContain("Partner B tightened the latest recommendation");
      expect(previewHtml).toContain("Forge Collective");
      expect(previewHtml).toContain("Atlas Client Ops");
      expect(previewHtml).not.toContain("Nolan Grout");

      const exportBinary = await postBinary(
        server.url,
        `/api/proposal-projects/${projectId}/export-pdf`,
        {
          baseVersionId: newestVersionId,
          audience: "client",
          brand: BUILT_IN_BRANDS.nolan,
          iterations: 500,
          fileName: "../Collab Workflow.pdf",
          displayName: "Export Partner",
        },
      );

      expect(exportBinary.status).toBe(200);
      expect(exportBinary.body).toEqual(pdfBytes);
      expect(exportBinary.headers.get("Content-Disposition")).toBe(
        'attachment; filename="Collab Workflow.pdf"',
      );
      expect(exportedHtml).toContain(PARTNER_A_TITLE);
      expect(exportedHtml).toContain("Partner B tightened the latest recommendation");
      expect(exportedHtml).toContain("Forge Collective");
      expect(exportedHtml).toContain("Atlas Client Ops");
      expect(exportedHtml).not.toContain("Nolan Grout");

      await server.close();
      server = null;

      server = await startWorkflowServer({ dataDir });
      const reloadedStateJson = await getJson(server.url, `/api/proposal-projects/${projectId}`);
      const reloadedProject = readRecordField(reloadedStateJson.body, "project");
      const reloadedSource = readRecordField(reloadedStateJson.body, "sourceOfTruth");
      const reloadedDraft = readRecordField(reloadedSource, "draft");
      const reloadedDetails = readRecordField(reloadedDraft, "details");
      const reloadedPreparedFor = readRecordField(reloadedDraft, "preparedFor");
      const reloadedVersions = readArrayField(reloadedProject, "versions");
      const reloadedArtifacts = readArrayField(reloadedProject, "artifacts");

      expect(reloadedStateJson.status).toBe(200);
      expect(readStringField(reloadedProject, "currentVersionId")).toBe(newestVersionId);
      expect(reloadedVersions).toHaveLength(5);
      expect(reloadedArtifacts).toHaveLength(3);
      expect(readStringField(reloadedDetails, "title")).toBe(PARTNER_A_TITLE);
      expect(readStringField(reloadedDetails, "recommendation")).toBe(PARTNER_B_RECOMMENDATION);
      expect(readStringField(readRecordField(reloadedSource, "vendorBrand"), "id")).toBe(
        "forge-collective",
      );
      expect(readStringField(readRecordField(reloadedSource, "clientBrand"), "id")).toBe(
        "atlas-client-ops",
      );
      expect(readStringField(reloadedPreparedFor, "companyName")).toBe("Atlas Client Ops");
    } finally {
      if (server !== null) await server.close();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

interface StartWorkflowServerOptions {
  readonly dataDir: string;
  readonly runProposalAgentStream?: ProposalAgentStreamRunner;
  readonly renderPdf?: ProposalPdfRenderer;
  readonly sessionIdFactory?: () => string;
}

async function startWorkflowServer(options: StartWorkflowServerOptions): Promise<RunningAppServer> {
  return startAppServer({
    port: 0,
    agentConfig: FAKE_AGENT_CONFIG,
    ...(options.sessionIdFactory === undefined
      ? {}
      : { sessionIdFactory: options.sessionIdFactory }),
    routes: {
      proposalProjectStore: workflowStore(options.dataDir),
      extractWebsiteBrand: fakeWebsiteBrandExtractor,
      ...(options.renderPdf === undefined ? {} : { renderPdf: options.renderPdf }),
      ...(options.runProposalAgentStream === undefined
        ? {}
        : { runProposalAgentStream: options.runProposalAgentStream }),
    },
  });
}

function workflowStore(dataDir: string): LocalProposalProjectStore {
  let projectCounter = 0;
  let versionCounter = 0;
  let timeIndex = 0;
  const times = [
    PARTNER_A_SAVED_AT,
    PARTNER_B_SAVED_AT,
    PREVIEW_SAVED_AT,
    EXPORT_HTML_SAVED_AT,
    EXPORT_PDF_SAVED_AT,
  ];

  return createLocalProposalProjectStore({
    dataDir,
    now: () => {
      const fallback = times[times.length - 1] ?? EXPORT_PDF_SAVED_AT;
      const value = times[timeIndex] ?? fallback;
      timeIndex += 1;
      return value;
    },
    projectIdFactory: () => {
      projectCounter += 1;
      return `workflow-project-${projectCounter}` as ProposalProjectId;
    },
    versionIdFactory: ({ versionNumber }) => {
      versionCounter += 1;
      return `workflow-version-${versionNumber}-${versionCounter}` as ProposalProjectVersionId;
    },
  });
}

function fakeProposalAgentRunner(agentCalls: FakeAgentCall[]): ProposalAgentStreamRunner {
  return async function* runFakeProposalAgent(options) {
    agentCalls.push({
      message: options.message,
      sessionId: options.session.id,
      author: options.session.createdBy.displayName,
      ...(options.session.projectVersionId === undefined
        ? {}
        : { projectVersionId: options.session.projectVersionId }),
    });

    if (options.message.includes("Partner A")) {
      options.session.store = updateDraftDetails(
        options.session.store,
        { title: PARTNER_A_TITLE },
        {
          label: "Partner A fake agent edit",
          updatedAt: PARTNER_A_SAVED_AT,
          author: options.session.createdBy.displayName,
          source: "fake-agent",
        },
      );
      yield { type: "text_delta", text: "Partner A title saved." };
    } else if (options.message.includes("Partner B")) {
      options.session.store = updateDraftDetails(
        options.session.store,
        { recommendation: PARTNER_B_RECOMMENDATION },
        {
          label: "Partner B fake agent edit",
          updatedAt: PARTNER_B_SAVED_AT,
          author: options.session.createdBy.displayName,
          source: "fake-agent",
        },
      );
      yield { type: "text_delta", text: "Partner B recommendation saved." };
    } else {
      yield { type: "text_delta", text: "No fake edit configured for this message." };
    }

    if (options.beforeSnapshot !== undefined) await options.beforeSnapshot();
    yield { type: "snapshot", snapshot: buildSessionSnapshot(options.session) };
    yield { type: "done", totalTurns: 1 };
  };
}

const fakeWebsiteBrandExtractor: WebsiteBrandExtractor = async (url) => {
  if (url.includes("vendor")) return brandExtractionResult(url, vendorBrand, VENDOR_IMPORTED_AT);
  if (url.includes("client")) return brandExtractionResult(url, clientBrand, CLIENT_IMPORTED_AT);
  throw new Error(`Unexpected test brand URL: ${url}`);
};

function brandExtractionResult(
  requestedUrl: string,
  brand: ProposalBrand,
  fetchedAt: string,
): WebsiteBrandExtractionResult {
  const finalUrl = brand.website ?? `https://${requestedUrl}/`;
  return {
    proposalBrand: brand,
    palette: brand.colors,
    meta: {
      title: brand.name,
      ...(brand.tagline === undefined ? {} : { description: brand.tagline }),
      themeColor: brand.colors.primary,
    },
    assets: [],
    favicons: [],
    logos: [],
    ogImages: [],
    colors: [
      {
        hex: brand.colors.primary,
        role: "primary",
        source: "manual",
        count: 1,
        confidence: 1,
      },
      {
        hex: brand.colors.accent,
        role: "accent",
        source: "manual",
        count: 1,
        confidence: 1,
      },
    ],
    source: {
      requestedUrl,
      normalizedUrl: finalUrl,
      finalUrl,
      fetchedAt,
      statusCode: 200,
      bytesRead: 128,
      elapsedMs: 1,
      extractor: "scopeforge.websiteBrand.node",
      extractorVersion: 1,
      redirects: [],
      warnings: [],
      contentType: "text/html; charset=utf-8",
    },
    sources: {
      name: { value: brand.name, source: "manual", pageUrl: finalUrl, confidence: 1 },
      ...(brand.tagline === undefined
        ? {}
        : {
            tagline: { value: brand.tagline, source: "manual", pageUrl: finalUrl, confidence: 1 },
          }),
      colors: {
        primary: {
          value: brand.colors.primary,
          source: "manual",
          pageUrl: finalUrl,
          confidence: 1,
        },
        accent: {
          value: brand.colors.accent,
          source: "manual",
          pageUrl: finalUrl,
          confidence: 1,
        },
      },
    },
    name: brand.name,
    ...(brand.tagline === undefined ? {} : { tagline: brand.tagline }),
  } satisfies WebsiteBrandExtractionResult;
}

function workflowDraft(): ProposalDraft {
  return proposalIntakeToDraft(workflowIntake(), {
    draftId: "workflow-draft-1",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    author: "Workspace Owner",
    source: "collaborative-workflow-test",
    footerContact: "hello@scopeforge.local",
    paymentTerms: "50% to start, 50% at pilot handoff.",
  });
}

function workflowIntake(): ProposalIntake {
  return {
    project: tritenExample(),
    preparedFor: {
      companyName: "Initial Client",
      buyerName: "Jordan Client",
      buyerTitle: "COO",
      website: "https://initial-client.example/",
      logoText: "IC",
      accentColor: "#2563eb",
    },
    details: {
      title: "Initial collaborative proposal",
      subtitle: "A deterministic local workflow test",
      date: "2026-06-07",
      recommendation: "Start with a focused pilot that validates weekly operating leverage.",
      executiveSummary: [
        "The team needs a trusted operating layer before broader workflow automation.",
        "The first pilot keeps scope narrow enough to validate payback.",
      ],
      whatWeHeard: [
        "Reporting still depends on manual reconciliation.",
        "Leadership wants client-safe visibility into the first automation milestone.",
      ],
      investmentSummary: "The recommended pilot is priced at $40K.",
      timelineSummary: "Pilot delivery is expected across four focused phases.",
    },
    scope: [
      {
        title: "Reporting foundation",
        description: "Build the core data and workflow layer for the pilot.",
        deliverables: ["Data model", "Pilot dashboard", "Handoff notes"],
        outcomes: ["Reduced weekly reporting drag"],
      },
    ],
    milestones: [
      {
        name: "Pilot build",
        timing: "Weeks 1-4",
        outcomes: ["Validated data model", "Working preview"],
      },
    ],
    assumptions: ["The client provides source-system access."],
    exclusions: ["Production integrations outside the pilot are scoped later."],
    clientInputs: ["One business owner joins acceptance review."],
    nextSteps: ["Confirm source access", "Schedule kickoff"],
  } satisfies ProposalIntake;
}

async function getJson(baseUrl: string, path: string): Promise<JsonHttpResponse> {
  return jsonRequest(baseUrl, "GET", path);
}

async function postJson(baseUrl: string, path: string, body: unknown): Promise<JsonHttpResponse> {
  return jsonRequest(baseUrl, "POST", path, body);
}

async function jsonRequest(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<JsonHttpResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const text = await response.text();
  const parsed: unknown = text.length === 0 ? null : JSON.parse(text);
  return { status: response.status, headers: response.headers, body: parsed };
}

async function postBinary(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<BinaryHttpResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: new Uint8Array(await response.arrayBuffer()),
  };
}

async function postAgentMessage(baseUrl: string, body: unknown): Promise<AgentMessageHttpResponse> {
  const response = await fetch(`${baseUrl}/api/agent/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    return {
      status: response.status,
      headers: response.headers,
      frames: [],
      body: text.length === 0 ? null : JSON.parse(text),
    };
  }

  return {
    status: response.status,
    headers: response.headers,
    frames: parseSseFrames(text),
    body: null,
  };
}

function parseSseFrames(text: string): readonly AgentStreamFrame[] {
  const frames: AgentStreamFrame[] = [];
  for (const block of text.split("\n\n")) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => line.slice("data: ".length))
      .join("\n");
    if (data.length === 0) continue;
    const parsed: unknown = JSON.parse(data);
    if (!isRecord(parsed) || typeof parsed.type !== "string") {
      throw new Error(`Invalid SSE frame: ${data}`);
    }
    frames.push(parsed as AgentStreamFrame);
  }
  return frames;
}

function readSessionId(frames: readonly AgentStreamFrame[]): string {
  const frame = frames.find(
    (candidate): candidate is Extract<AgentStreamFrame, { type: "session" }> =>
      candidate.type === "session",
  );
  if (frame === undefined) throw new Error("Expected a session SSE frame.");
  return frame.sessionId;
}

function readSnapshot(frames: readonly AgentStreamFrame[]): SessionSnapshot {
  const frame = frames.find(
    (candidate): candidate is Extract<AgentStreamFrame, { type: "snapshot" }> =>
      candidate.type === "snapshot",
  );
  if (frame === undefined) {
    throw new Error(`Expected a snapshot SSE frame, got ${JSON.stringify(frames)}.`);
  }
  return frame.snapshot;
}

function nextQueuedValue(values: string[], label: string): string {
  const value = values.shift();
  if (value === undefined) throw new Error(`No queued ${label} left.`);
  return value;
}

function readRequiredString(input: string | undefined, label: string): string {
  if (input === undefined) throw new Error(`Expected ${label}.`);
  return input;
}

function readRecordField(input: unknown, key: string): Readonly<Record<string, unknown>> {
  if (!isRecord(input) || !isRecord(input[key])) {
    throw new Error(`Expected ${key} to be an object.`);
  }
  return input[key];
}

function readStringField(input: unknown, key: string): string {
  if (!isRecord(input) || typeof input[key] !== "string") {
    throw new Error(`Expected ${key} to be a string.`);
  }
  return input[key];
}

function readNumberField(input: unknown, key: string): number {
  if (!isRecord(input) || typeof input[key] !== "number") {
    throw new Error(`Expected ${key} to be a number.`);
  }
  return input[key];
}

function readArrayField(input: unknown, key: string): readonly unknown[] {
  if (!isRecord(input) || !Array.isArray(input[key])) {
    throw new Error(`Expected ${key} to be an array.`);
  }
  return input[key];
}

function isRecord(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
