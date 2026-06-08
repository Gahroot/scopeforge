import { z } from "zod";
import type {
  AgentTool,
  StructuredToolResult,
  ToolContext,
  ToolExecuteResult,
  ToolExecutionMode,
} from "@kenkaiiii/gg-agent";
import { analyzeProject } from "../core/index.js";
import { leadPrice } from "../core/pricing.js";
import {
  MAX_SOURCE_MATERIAL_TEXT_CHARS,
  applyProposalDraftCandidatePatch,
  createProposalDraftCandidate,
  extractSourceMaterialFromText,
  formatMissingInputs,
} from "../ingest/index.js";
import type { NamedRange, Project, Range, TriEstimate, Workstream } from "../core/types.js";
import { formatMoney, formatMoneyRange, formatMonths } from "../proposal/format.js";
import {
  replaceDraftNextSteps,
  updateDraftDetails,
  updateDraftPreparedFor,
  updateDraftPricing,
  updateDraftTerms,
  updateDraftValueProposal,
  updateProposalDraft,
} from "../proposal/draftStore.js";
import { proposalDraftToIntake, validateProposalDraft } from "../proposal/schema.js";
import type {
  ProposalActualDeliverable,
  ProposalBuildPlanStep,
  ProposalPricingPhase,
} from "../proposal/types.js";
import { buildSessionSnapshot, type AgentSession } from "./session.node.js";

const COMMIT = { source: "agent" } as const;

interface ToolDefinition<T extends z.ZodType> {
  readonly name: string;
  readonly description: string;
  readonly executionMode?: ToolExecutionMode;
  readonly parameters: T;
  readonly execute: (
    args: z.infer<T>,
    context: ToolContext,
  ) => ToolExecuteResult | Promise<ToolExecuteResult>;
}

/** Infers zod-typed execute args while erasing to the library's AgentTool surface. */
function defineTool<T extends z.ZodType>(definition: ToolDefinition<T>): AgentTool {
  return definition as unknown as AgentTool;
}

const triSchema = z.object({
  optimistic: z.number().positive(),
  likely: z.number().positive(),
  pessimistic: z.number().positive(),
});

const rangeSchema = z.object({ low: z.number(), high: z.number() });

const sourceMaterialKindSchema = z.enum([
  "meeting_notes",
  "transcript_summary",
  "text",
  "json",
  "pdf",
]);

const workstreamSchema = z.object({
  name: z.string().min(1),
  hours: triSchema.describe("Three-point hour estimate for this workstream."),
  aiFactor: z
    .number()
    .min(0)
    .max(1)
    .describe("Fraction of hours remaining AFTER AI assistance (0-1]. Use 1 for judgment work."),
  judgment: z
    .boolean()
    .describe("True for work AI does not meaningfully accelerate (modeling, QA)."),
});

const segmentSchema = z.object({
  role: z.string().min(1),
  headcount: z.number().positive(),
  hoursPerWeek: z.number().positive(),
  loadedRate: z.number().positive().describe("Fully loaded hourly cost in USD."),
});

const namedRangeSchema = z.object({
  name: z.string().min(1),
  low: z.number(),
  high: z.number(),
  note: z
    .string()
    .optional()
    .describe("Optional label, e.g. 'later phase' for future-only upside."),
});

const tierSchema = z.object({
  name: z.string().min(1),
  price: z
    .number()
    .positive()
    .nullable()
    .describe("USD price, or null for an intentionally unpriced phase."),
  note: z.string().optional(),
});

const buildStepSchema = z.object({
  name: z.string().min(1),
  timing: z.string().min(1).describe("When this step happens, e.g. 'Weeks 1-2'."),
  description: z.string().min(1),
  activities: z.array(z.string().min(1)).min(1),
  outcomes: z.array(z.string().min(1)).min(1),
});

const deliverableSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  included: z.array(z.string().min(1)).min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1).optional(),
});

function toTri(input: z.infer<typeof triSchema>): TriEstimate {
  return { optimistic: input.optimistic, likely: input.likely, pessimistic: input.pessimistic };
}

function toRange(input: z.infer<typeof rangeSchema>): Range {
  return { low: input.low, high: input.high };
}

function toNamedRange(input: z.infer<typeof namedRangeSchema>): NamedRange {
  return {
    name: input.name,
    low: input.low,
    high: input.high,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

function toWorkstream(input: z.infer<typeof workstreamSchema>): Workstream {
  return {
    name: input.name,
    hours: toTri(input.hours),
    aiFactor: input.aiFactor,
    judgment: input.judgment,
  };
}

function toPricingPhase(input: z.infer<typeof tierSchema>): ProposalPricingPhase {
  return {
    name: input.name,
    price: input.price,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

function toBuildStep(input: z.infer<typeof buildStepSchema>): ProposalBuildPlanStep {
  return {
    name: input.name,
    timing: input.timing,
    description: input.description,
    activities: input.activities,
    outcomes: input.outcomes,
  };
}

function toDeliverable(input: z.infer<typeof deliverableSchema>): ProposalActualDeliverable {
  return {
    title: input.title,
    description: input.description,
    included: input.included,
    ...(input.acceptanceCriteria === undefined
      ? {}
      : { acceptanceCriteria: input.acceptanceCriteria }),
  };
}

function snapshotResult(session: AgentSession, message: string): StructuredToolResult {
  return { content: message, details: buildSessionSnapshot(session) };
}

/** Builds the agent toolset bound to one in-memory session's draft store. */
export function createProposalTools(session: AgentSession): AgentTool[] {
  const setProjectInputs = defineTool({
    name: "set_project_inputs",
    description:
      "Set the economic engine inputs (cost workstreams, value segments/workflows, pricing tiers). " +
      "These drive the deterministic cost floor, year-one value, and payback math. Required before analysis is meaningful.",
    executionMode: "sequential",
    parameters: z.object({
      projectName: z.string().min(1).optional(),
      client: z
        .object({
          sizeHeadcount: z.number().positive(),
          buyerRole: z.string().min(1),
          workingWeeks: z.number().positive().optional(),
        })
        .optional(),
      margin: z.number().min(0).max(0.95).optional().describe("Target gross margin in [0,1)."),
      blendedRate: triSchema.optional().describe("Blended $/hr three-point estimate."),
      workstreams: z.array(workstreamSchema).min(1),
      valueRealizationFactor: rangeSchema
        .optional()
        .describe("Fraction of saved time captured in year one, as [low, high]."),
      valueSegments: z.array(segmentSchema).optional(),
      valueWorkflows: z.array(namedRangeSchema).optional(),
      futureUpside: z
        .array(namedRangeSchema)
        .optional()
        .describe("Upside shown but never in payback."),
      valueFraction: rangeSchema
        .optional()
        .describe("Price anchor band as fraction of value, e.g. [0.1, 0.2]."),
      tiers: z.array(tierSchema).min(1),
    }),
    execute: (args) => {
      const current = session.store.current.project;
      const project: Project = {
        project: args.projectName ?? current.project,
        client:
          args.client === undefined
            ? current.client
            : {
                sizeHeadcount: args.client.sizeHeadcount,
                buyerRole: args.client.buyerRole,
                workingWeeks: args.client.workingWeeks ?? current.client.workingWeeks,
              },
        cost: {
          blendedRate:
            args.blendedRate === undefined ? current.cost.blendedRate : toTri(args.blendedRate),
          margin: args.margin ?? current.cost.margin,
          workstreams: args.workstreams.map(toWorkstream),
        },
        value: {
          realizationFactor:
            args.valueRealizationFactor === undefined
              ? current.value.realizationFactor
              : toRange(args.valueRealizationFactor),
          segments: args.valueSegments ?? current.value.segments,
          workflows:
            args.valueWorkflows === undefined
              ? current.value.workflows
              : args.valueWorkflows.map(toNamedRange),
          futureUpside:
            args.futureUpside === undefined
              ? current.value.futureUpside
              : args.futureUpside.map(toNamedRange),
        },
        pricing: {
          valueFraction:
            args.valueFraction === undefined
              ? current.pricing.valueFraction
              : toRange(args.valueFraction),
          tiers: args.tiers.map((tier) => ({
            name: tier.name,
            price: tier.price,
            ...(tier.note === undefined ? {} : { note: tier.note }),
          })),
        },
      };

      const phases = args.tiers.map(toPricingPhase);
      session.store = updateProposalDraft(
        session.store,
        (draft) => ({ ...draft, project, pricing: { ...draft.pricing, phases } }),
        { ...COMMIT, label: "Set project inputs" },
      );
      return snapshotResult(
        session,
        `Set ${args.workstreams.length} workstream(s) and ${args.tiers.length} pricing tier(s). Run analysis to refresh economics.`,
      );
    },
  });

  const patchPreparedFor = defineTool({
    name: "patch_prepared_for",
    description: "Update who the proposal is prepared for (company, buyer, branding hints).",
    executionMode: "sequential",
    parameters: z.object({
      companyName: z.string().min(1).optional(),
      buyerName: z.string().min(1).optional(),
      buyerTitle: z.string().min(1).optional(),
      website: z.string().min(1).optional(),
      logoText: z.string().min(1).optional(),
      accentColor: z.string().min(1).optional(),
    }),
    execute: (args) => {
      session.store = updateDraftPreparedFor(session.store, cleanPatch(args), {
        ...COMMIT,
        label: "Update prepared-for",
      });
      return snapshotResult(
        session,
        `Updated client details for ${session.store.current.preparedFor.companyName}.`,
      );
    },
  });

  const patchDetails = defineTool({
    name: "patch_details",
    description:
      "Update headline proposal details: title, recommendation, executive summary, what we heard.",
    executionMode: "sequential",
    parameters: z.object({
      title: z.string().min(1).optional(),
      subtitle: z.string().min(1).optional(),
      date: z.string().min(1).optional(),
      recommendation: z.string().min(1).optional(),
      executiveSummary: z.array(z.string().min(1)).min(1).optional(),
      whatWeHeard: z.array(z.string().min(1)).min(1).optional(),
      investmentSummary: z.string().min(1).optional(),
      timelineSummary: z.string().min(1).optional(),
    }),
    execute: (args) => {
      session.store = updateDraftDetails(session.store, cleanPatch(args), {
        ...COMMIT,
        label: "Update details",
      });
      return snapshotResult(session, "Updated proposal details.");
    },
  });

  const patchValueProposal = defineTool({
    name: "patch_value_proposal",
    description:
      "Update the value proposition: headline, narrative, unlocks, value target, six-month savings.",
    executionMode: "sequential",
    parameters: z.object({
      headline: z.string().min(1).optional(),
      narrative: z.string().min(1).optional(),
      unlocks: z.array(z.string().min(1)).min(1).optional(),
      annualValueTarget: z.number().positive().optional(),
      sixMonthSavings: rangeSchema.optional(),
    }),
    execute: (args) => {
      session.store = updateDraftValueProposal(
        session.store,
        {
          ...(args.headline === undefined ? {} : { headline: args.headline }),
          ...(args.narrative === undefined ? {} : { narrative: args.narrative }),
          ...(args.unlocks === undefined ? {} : { unlocks: args.unlocks }),
          ...(args.annualValueTarget === undefined
            ? {}
            : { annualValueTarget: args.annualValueTarget }),
          ...(args.sixMonthSavings === undefined
            ? {}
            : { sixMonthSavings: toRange(args.sixMonthSavings) }),
        },
        { ...COMMIT, label: "Update value proposition" },
      );
      return snapshotResult(session, "Updated the value proposition.");
    },
  });

  const setBuildPlan = defineTool({
    name: "set_build_plan",
    description:
      "Replace the build plan steps (each with name, timing, description, activities, outcomes).",
    executionMode: "sequential",
    parameters: z.object({ steps: z.array(buildStepSchema).min(1) }),
    execute: (args) => {
      const buildPlan = args.steps.map(toBuildStep);
      session.store = updateProposalDraft(session.store, (draft) => ({ ...draft, buildPlan }), {
        ...COMMIT,
        label: "Set build plan",
      });
      return snapshotResult(session, `Set ${buildPlan.length} build-plan step(s).`);
    },
  });

  const setDeliverables = defineTool({
    name: "set_deliverables",
    description:
      "Replace the concrete deliverables (each with title, description, what's included, acceptance criteria).",
    executionMode: "sequential",
    parameters: z.object({ deliverables: z.array(deliverableSchema).min(1) }),
    execute: (args) => {
      const actualDeliverables = args.deliverables.map(toDeliverable);
      session.store = updateProposalDraft(
        session.store,
        (draft) => ({ ...draft, actualDeliverables }),
        { ...COMMIT, label: "Set deliverables" },
      );
      return snapshotResult(session, `Set ${actualDeliverables.length} deliverable(s).`);
    },
  });

  const patchPricing = defineTool({
    name: "patch_pricing",
    description:
      "Update the pricing summary and phases. Phases drive the lead price and payback math.",
    executionMode: "sequential",
    parameters: z.object({
      summary: z.string().min(1).optional(),
      phases: z.array(tierSchema).min(1).optional(),
    }),
    execute: (args) => {
      session.store = updateDraftPricing(
        session.store,
        {
          ...(args.summary === undefined ? {} : { summary: args.summary }),
          ...(args.phases === undefined ? {} : { phases: args.phases.map(toPricingPhase) }),
        },
        { ...COMMIT, label: "Update pricing" },
      );
      return snapshotResult(session, "Updated pricing.");
    },
  });

  const setTerms = defineTool({
    name: "set_terms",
    description:
      "Update proposal terms: payment terms, start conditions, assumptions, exclusions, client responsibilities.",
    executionMode: "sequential",
    parameters: z.object({
      paymentTerms: z.string().min(1).optional(),
      startConditions: z.array(z.string().min(1)).min(1).optional(),
      assumptions: z.array(z.string().min(1)).min(1).optional(),
      exclusions: z.array(z.string().min(1)).min(1).optional(),
      clientResponsibilities: z.array(z.string().min(1)).min(1).optional(),
      changeControl: z.string().min(1).optional(),
      expiration: z.string().min(1).optional(),
    }),
    execute: (args) => {
      session.store = updateDraftTerms(session.store, cleanPatch(args), {
        ...COMMIT,
        label: "Update terms",
      });
      return snapshotResult(session, "Updated proposal terms.");
    },
  });

  const setNextSteps = defineTool({
    name: "set_next_steps",
    description: "Replace the next steps the client should take to move forward.",
    executionMode: "sequential",
    parameters: z.object({ nextSteps: z.array(z.string().min(1)).min(1) }),
    execute: (args) => {
      session.store = replaceDraftNextSteps(session.store, args.nextSteps, {
        ...COMMIT,
        label: "Set next steps",
      });
      return snapshotResult(session, `Set ${args.nextSteps.length} next step(s).`);
    },
  });

  const ingestSourceMaterial = defineTool({
    name: "ingest_source_material",
    description:
      "Convert pasted meeting notes, transcript summaries, extracted text/JSON, or PDF text into a ProposalDraft candidate. " +
      "This tool only applies observed non-economic facts and always lists missing cost/value/pricing inputs instead of inventing numbers.",
    executionMode: "sequential",
    parameters: z.object({
      material: z.string().min(1).max(MAX_SOURCE_MATERIAL_TEXT_CHARS),
      sourceKind: sourceMaterialKindSchema.optional(),
      sourceName: z.string().min(1).optional(),
      applySafePatch: z
        .boolean()
        .optional()
        .describe(
          "When true, apply only safe observed narrative/client fields to the draft. Never sets workstream hours, value ranges, realization, or prices.",
        ),
    }),
    execute: (args) => {
      const extracted = extractSourceMaterialFromText({
        text: args.material,
        ...(args.sourceKind === undefined ? {} : { sourceKind: args.sourceKind }),
        ...(args.sourceName === undefined ? {} : { sourceName: args.sourceName }),
        origin: "tool",
      });
      if (!extracted.ok) {
        return snapshotResult(
          session,
          `Could not ingest source material: ${extracted.error.message}`,
        );
      }

      const candidate = createProposalDraftCandidate(extracted.document);
      const applied = args.applySafePatch === true;
      if (applied) {
        session.store = updateProposalDraft(
          session.store,
          (draft) => applyProposalDraftCandidatePatch(draft, candidate),
          {
            ...COMMIT,
            label: "Ingest source material",
            notes: [
              "Applied observed non-economic fields from source material. Cost, value, realization, and pricing numbers still require confirmation.",
            ],
          },
        );
      }

      const missing = formatMissingInputs(candidate.missingInputs);
      return {
        content: [
          candidate.summary,
          applied
            ? "Applied safe observed fields to the draft; no economic estimates or prices were invented."
            : "Draft unchanged; review the candidate before applying any fields.",
          `Still needed:\n${missing}`,
        ].join("\n\n"),
        details: {
          ...buildSessionSnapshot(session),
          sourceMaterial: { document: extracted.document, candidate, applied },
        },
      } satisfies StructuredToolResult;
    },
  });

  const runAnalysis = defineTool({
    name: "run_analysis",
    description:
      "Run the deterministic three-lens analysis on the current draft and return the cost floor, " +
      "year-one value, target price band, lead price, and payback. The AI must never compute these itself.",
    parameters: z.object({}),
    execute: () => {
      const draft = session.store.current;
      if (draft.project.cost.workstreams.length === 0) {
        return {
          content:
            "Cannot run analysis yet: no cost workstreams set. Call set_project_inputs first.",
          details: buildSessionSnapshot(session),
        } satisfies StructuredToolResult;
      }
      const intake = proposalDraftToIntake(draft);
      const analysis = analyzeProject(intake.project);
      const price = leadPrice(intake.project.pricing.tiers);
      const summary = [
        `Lead price: ${price === null ? "scoped later" : formatMoney(price)}.`,
        `Year-one value: ${formatMoneyRange(analysis.value.yearOne)}.`,
        `Target price band: ${formatMoneyRange(analysis.pricing.targetBand)}.`,
        `Payback: ${formatMonths(analysis.pricing.paybackMonths)}.`,
        `Cost floor P50: ${formatMoney(analysis.cost.priceFloor.p50)}.`,
        analysis.warnings.length === 0
          ? "No guardrail warnings."
          : `Guardrails: ${analysis.warnings.map((w) => `${w.severity}:${w.rule}`).join(", ")}.`,
      ].join(" ");
      return snapshotResult(session, summary);
    },
  });

  const validateDraft = defineTool({
    name: "validate_draft",
    description:
      "Validate the current draft and report what is still missing before it can be sent.",
    parameters: z.object({}),
    execute: () => {
      const result = validateProposalDraft(session.store.current);
      if (result.ok) {
        return snapshotResult(session, "Draft is valid and ready for preview/export.");
      }
      const issues = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
      return snapshotResult(session, `Draft is not valid yet. Missing or invalid: ${issues}`);
    },
  });

  const getDraftSummary = defineTool({
    name: "get_draft_summary",
    description: "Get a structured summary of the current draft so you only ask for missing facts.",
    parameters: z.object({}),
    execute: () => {
      const snapshot = buildSessionSnapshot(session);
      const draft = snapshot.draft;
      const summary = [
        `Company: ${draft.companyName}.`,
        `Title: ${draft.title}.`,
        `Phases: ${draft.phases.length === 0 ? "none" : draft.phases.map((p) => `${p.name}=${p.price === null ? "TBD" : formatMoney(p.price)}`).join(", ")}.`,
        `Workstreams set: ${session.store.current.project.cost.workstreams.length}.`,
        snapshot.validation.ok
          ? "Validation: ready."
          : `Validation: ${snapshot.validation.errors.length} issue(s).`,
      ].join(" ");
      return snapshotResult(session, summary);
    },
  });

  return [
    setProjectInputs,
    patchPreparedFor,
    patchDetails,
    patchValueProposal,
    setBuildPlan,
    setDeliverables,
    patchPricing,
    setTerms,
    setNextSteps,
    ingestSourceMaterial,
    runAnalysis,
    validateDraft,
    getDraftSummary,
  ];
}

type DefinedPartial<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

function cleanPatch<T extends Record<string, unknown>>(input: T): DefinedPartial<T> {
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    const value = input[key];
    if (value !== undefined) output[key] = value;
  }
  return output as DefinedPartial<T>;
}
