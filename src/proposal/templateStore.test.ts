import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { tritenExample } from "../data/defaults.js";
import { proposalIntakeToDraft } from "./draftStore.js";
import { createTemplateStore, type TemplateStore } from "./templateStore.js";
import type { ProposalDraft } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sampleDraft(): ProposalDraft {
  const intake = {
    project: tritenExample(),
    preparedFor: { companyName: "Test Corp" },
    details: {
      title: "Test Proposal",
      recommendation: "Build a pilot.",
      executiveSummary: ["We will build a pilot."],
      whatWeHeard: ["Client needs a pilot."],
    },
    scope: [
      {
        title: "Pilot build",
        description: "Build the first milestone.",
        deliverables: ["Working prototype"],
      },
    ],
    milestones: [
      {
        name: "Pilot milestone",
        timing: "Weeks 1–4",
        outcomes: ["Working prototype delivered"],
      },
    ],
    assumptions: ["Client provides access."],
    exclusions: ["Production hosting."],
    clientInputs: ["Technical lead available."],
    nextSteps: ["Sign agreement."],
  };

  return proposalIntakeToDraft(intake, {
    templateId: "generic/value-proposal",
    source: "test",
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("templateStore", () => {
  let tempDir: string;
  let store: TemplateStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "template-store-test-"));
    store = createTemplateStore({
      customDir: join(tempDir, "custom"),
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Built-in template loading
  // -----------------------------------------------------------------------

  describe("built-in templates", () => {
    it("lists all built-in templates", async () => {
      const templates = await store.list();
      expect(templates.length).toBeGreaterThanOrEqual(4);

      const ids = templates.map((t) => t.templateId);
      expect(ids).toContain("built-in/saas-dashboard");
      expect(ids).toContain("built-in/mobile-app");
      expect(ids).toContain("built-in/automation-pipeline");
      expect(ids).toContain("built-in/consulting-engagement");
    });

    it("marks built-in templates as read-only", async () => {
      const templates = await store.list();
      for (const template of templates) {
        if (template.templateId.startsWith("built-in/")) {
          expect(template.builtIn).toBe(true);
        }
      }
    });

    it("loads a built-in template with its draft", async () => {
      const template = await store.get("built-in/saas-dashboard");
      expect(template).not.toBeNull();
      expect(template?.templateId).toBe("built-in/saas-dashboard");
      expect(template?.name).toBe("SaaS Dashboard / Data Platform");
      expect(template?.builtIn).toBe(true);
      expect(template?.draft).toBeDefined();
      expect(template?.draft.project.project).toBe("{{PROJECT_NAME}}");
    });

    it("returns null for non-existent template", async () => {
      const template = await store.get("built-in/non-existent");
      expect(template).toBeNull();
    });

    it("each built-in template has required fields", async () => {
      const templates = await store.list();
      const builtIns = templates.filter((t) => t.builtIn);
      expect(builtIns.length).toBeGreaterThanOrEqual(4);

      for (const template of builtIns) {
        expect(template.templateId.length).toBeGreaterThan(0);
        expect(template.name.length).toBeGreaterThan(0);
        expect(template.description.length).toBeGreaterThan(0);
        expect(template.category.length).toBeGreaterThan(0);
        expect(template.tags.length).toBeGreaterThan(0);
        expect(template.builtIn).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Custom template CRUD
  // -----------------------------------------------------------------------

  describe("save and load custom templates", () => {
    it("saves a new custom template", async () => {
      const draft = sampleDraft();
      const template = await store.save({
        name: "My Custom Template",
        description: "A custom template for testing.",
        category: "Custom",
        tags: ["test", "custom"],
        draft,
        author: "Test Author",
      });

      expect(template.templateId).toMatch(/^custom\//);
      expect(template.name).toBe("My Custom Template");
      expect(template.description).toBe("A custom template for testing.");
      expect(template.category).toBe("Custom");
      expect(template.builtIn).toBe(false);
      expect(template.createdAt).toBeDefined();
      expect(template.author).toBe("Test Author");
      expect(template.tags).toEqual(["test", "custom"]);
    });

    it("loads a saved custom template with draft", async () => {
      const draft = sampleDraft();
      const saved = await store.save({
        name: "Loadable Template",
        description: "For load testing.",
        category: "Test",
        tags: ["load"],
        draft,
      });

      const loaded = await store.get(saved.templateId);
      expect(loaded).not.toBeNull();
      expect(loaded?.templateId).toBe(saved.templateId);
      expect(loaded?.name).toBe("Loadable Template");
      expect(loaded?.builtIn).toBe(false);
      expect(loaded?.draft).toBeDefined();
      expect(loaded?.draft.project.project).toBe(tritenExample().project);
    });

    it("custom template appears in list", async () => {
      const draft = sampleDraft();
      const saved = await store.save({
        name: "Listed Template",
        description: "Should appear in list.",
        category: "Test",
        tags: ["list"],
        draft,
      });

      const all = await store.list();
      const found = all.find((t) => t.templateId === saved.templateId);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Listed Template");
    });

    it("does not include draft in list results", async () => {
      const draft = sampleDraft();
      const saved = await store.save({
        name: "No Draft In List",
        description: "Draft should not be in list.",
        category: "Test",
        tags: [],
        draft,
      });

      const all = await store.list();
      const found = all.find((t) => t.templateId === saved.templateId);
      expect(found).toBeDefined();
      expect("draft" in (found ?? {})).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  describe("delete templates", () => {
    it("deletes a custom template", async () => {
      const draft = sampleDraft();
      const saved = await store.save({
        name: "To Delete",
        description: "Will be deleted.",
        category: "Test",
        tags: [],
        draft,
      });

      const deleted = await store.delete(saved.templateId);
      expect(deleted).toBe(true);

      const loaded = await store.get(saved.templateId);
      expect(loaded).toBeNull();
    });

    it("cannot delete a built-in template", async () => {
      const deleted = await store.delete("built-in/saas-dashboard");
      expect(deleted).toBe(false);

      // Still exists.
      const template = await store.get("built-in/saas-dashboard");
      expect(template).not.toBeNull();
    });

    it("returns false for non-existent template", async () => {
      const deleted = await store.delete("custom/non-existent-id");
      expect(deleted).toBe(false);
    });

    it("deleted template no longer appears in list", async () => {
      const draft = sampleDraft();
      const saved = await store.save({
        name: "Gone Soon",
        description: "Disappear.",
        category: "Test",
        tags: ["gone"],
        draft,
      });

      let all = await store.list();
      expect(all.some((t) => t.templateId === saved.templateId)).toBe(true);

      await store.delete(saved.templateId);

      all = await store.list();
      expect(all.some((t) => t.templateId === saved.templateId)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Search and filter
  // -----------------------------------------------------------------------

  describe("search and filter", () => {
    it("filters by category", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "Mobile Template",
        description: "A mobile thing.",
        category: "Mobile",
        tags: [],
        draft,
      });

      const mobile = await store.list({ category: "Mobile" });
      expect(mobile.length).toBeGreaterThanOrEqual(1);
      expect(mobile.every((t) => t.category === "Mobile")).toBe(true);

      const saas = await store.list({ category: "SaaS" });
      expect(saas.every((t) => t.category === "SaaS")).toBe(true);
      expect(saas.some((t) => t.templateId === "built-in/saas-dashboard")).toBe(true);
    });

    it("filters by tags", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "AI Template",
        description: "For AI stuff.",
        category: "Test",
        tags: ["ai", "machine-learning"],
        draft,
      });

      const ai = await store.list({ tags: ["ai"] });
      expect(ai.some((t) => t.name === "AI Template")).toBe(true);

      const nonAi = await store.list({ tags: ["mobile"] });
      expect(nonAi.every((t) => !t.tags.includes("ai"))).toBe(true);
    });

    it("filters by text query in name", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "Zebra Analytics Suite",
        description: "Analytics for zebras.",
        category: "Test",
        tags: [],
        draft,
      });

      const results = await store.list({ query: "zebra" });
      expect(results.some((t) => t.name === "Zebra Analytics Suite")).toBe(true);
    });

    it("filters by text query in description", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "Custom Tool",
        description: "Specialized for fintech compliance workflows.",
        category: "Test",
        tags: [],
        draft,
      });

      const results = await store.list({ query: "fintech" });
      expect(results.some((t) => t.name === "Custom Tool")).toBe(true);
    });

    it("combines multiple filters", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "SaaS Mobile Template",
        description: "SaaS app with mobile focus.",
        category: "SaaS",
        tags: ["mobile", "saas"],
        draft,
      });
      await store.save({
        name: "SaaS Web Template",
        description: "SaaS web platform.",
        category: "SaaS",
        tags: ["web", "saas"],
        draft,
      });

      const combined = await store.list({ category: "SaaS", tags: ["mobile"] });
      expect(combined.length).toBe(1);
      expect(combined[0]?.name).toBe("SaaS Mobile Template");
    });

    it("returns all templates with empty search", async () => {
      const all = await store.list({});
      const none = await store.list();
      expect(all.length).toBe(none.length);
    });

    it("search is case-insensitive", async () => {
      const draft = sampleDraft();
      await store.save({
        name: "Analytics Dashboard",
        description: "Real-time analytics.",
        category: "Test",
        tags: [],
        draft,
      });

      const upper = await store.list({ query: "ANALYTICS" });
      expect(upper.some((t) => t.name === "Analytics Dashboard")).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Caching behavior
  // -----------------------------------------------------------------------

  describe("caching", () => {
    it("returns consistent results across multiple list calls", async () => {
      const first = await store.list();
      const second = await store.list();
      expect(first.length).toBe(second.length);
    });

    it("returns the same draft content on repeated gets", async () => {
      const first = await store.get("built-in/consulting-engagement");
      const second = await store.get("built-in/consulting-engagement");
      expect(first?.draft.metadata.draftId).toBe(second?.draft.metadata.draftId);
    });
  });

  // -----------------------------------------------------------------------
  // Template categories and tags
  // -----------------------------------------------------------------------

  describe("template metadata", () => {
    it("has diverse categories across built-in templates", async () => {
      const templates = await store.list();
      const categories = new Set(templates.filter((t) => t.builtIn).map((t) => t.category));
      expect(categories.size).toBeGreaterThanOrEqual(4);
    });

    it("built-in templates have meaningful tags", async () => {
      const templates = await store.list();
      const builtIns = templates.filter((t) => t.builtIn);
      for (const template of builtIns) {
        expect(template.tags.length).toBeGreaterThanOrEqual(2);
        for (const tag of template.tags) {
          expect(tag.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
