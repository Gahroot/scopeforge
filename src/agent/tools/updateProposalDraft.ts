import { z } from "zod";
import {
  updateDraftDetails,
  updateDraftPreparedFor,
  updateDraftPricing,
  updateDraftTerms,
  updateDraftValueProposal,
  replaceDraftNextSteps,
} from "../../proposal/draftStore.js";
import type { ProposalPricingPhase } from "../../proposal/types.js";
import {
  cleanPatch,
  defineTool,
  rangeSchema,
  snapshotResult,
  toRange,
  TOOL_COMMIT,
  type ResolvedToolDeps,
} from "./shared.js";

const phasePatchSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive().nullable(),
  note: z.string().min(1).optional(),
});

const preparedForSchema = z
  .object({
    companyName: z.string().min(1).optional(),
    buyerName: z.string().min(1).optional(),
    buyerTitle: z.string().min(1).optional(),
    website: z.string().min(1).optional(),
    logoText: z.string().min(1).optional(),
    accentColor: z.string().min(1).optional(),
  })
  .optional();

const detailsSchema = z
  .object({
    title: z.string().min(1).optional(),
    subtitle: z.string().min(1).optional(),
    date: z.string().min(1).optional(),
    recommendation: z.string().min(1).optional(),
    executiveSummary: z.array(z.string().min(1)).min(1).optional(),
    whatWeHeard: z.array(z.string().min(1)).min(1).optional(),
    investmentSummary: z.string().min(1).optional(),
    timelineSummary: z.string().min(1).optional(),
  })
  .optional();

const valueProposalSchema = z
  .object({
    headline: z.string().min(1).optional(),
    narrative: z.string().min(1).optional(),
    unlocks: z.array(z.string().min(1)).min(1).optional(),
    annualValueTarget: z.number().positive().optional(),
    sixMonthSavings: rangeSchema.optional(),
  })
  .optional();

const pricingSchema = z
  .object({
    summary: z.string().min(1).optional(),
    phases: z.array(phasePatchSchema).min(1).optional(),
  })
  .optional();

const termsSchema = z
  .object({
    paymentTerms: z.string().min(1).optional(),
    startConditions: z.array(z.string().min(1)).min(1).optional(),
    assumptions: z.array(z.string().min(1)).min(1).optional(),
    exclusions: z.array(z.string().min(1)).min(1).optional(),
    clientResponsibilities: z.array(z.string().min(1)).min(1).optional(),
    changeControl: z.string().min(1).optional(),
    expiration: z.string().min(1).optional(),
  })
  .optional();

function toPhase(input: z.infer<typeof phasePatchSchema>): ProposalPricingPhase {
  return {
    name: input.name,
    price: input.price,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

/**
 * Apply a structured patch to the narrative slices of the draft (prepared-for,
 * details, value proposition, pricing summary/phases, terms, next steps). Each
 * present slice is committed in order through the draft store so history and
 * versioning stay intact. Economic engine inputs are set separately.
 */
export function updateProposalDraft(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "update_proposal_draft",
    description:
      "Patch the proposal narrative: prepared-for, headline details, value proposition, pricing " +
      "summary/phases, terms, and next steps. Only include the fields you are changing.",
    executionMode: "sequential",
    parameters: z.object({
      preparedFor: preparedForSchema,
      details: detailsSchema,
      valueProposal: valueProposalSchema,
      pricing: pricingSchema,
      terms: termsSchema,
      nextSteps: z.array(z.string().min(1)).min(1).optional(),
    }),
    execute: (args) => {
      const changed: string[] = [];

      if (args.preparedFor !== undefined) {
        session.store = updateDraftPreparedFor(session.store, cleanPatch(args.preparedFor), {
          ...TOOL_COMMIT,
          label: "Update prepared-for",
        });
        changed.push("prepared-for");
      }

      if (args.details !== undefined) {
        session.store = updateDraftDetails(session.store, cleanPatch(args.details), {
          ...TOOL_COMMIT,
          label: "Update details",
        });
        changed.push("details");
      }

      if (args.valueProposal !== undefined) {
        const vp = args.valueProposal;
        session.store = updateDraftValueProposal(
          session.store,
          {
            ...(vp.headline === undefined ? {} : { headline: vp.headline }),
            ...(vp.narrative === undefined ? {} : { narrative: vp.narrative }),
            ...(vp.unlocks === undefined ? {} : { unlocks: vp.unlocks }),
            ...(vp.annualValueTarget === undefined
              ? {}
              : { annualValueTarget: vp.annualValueTarget }),
            ...(vp.sixMonthSavings === undefined
              ? {}
              : { sixMonthSavings: toRange(vp.sixMonthSavings) }),
          },
          { ...TOOL_COMMIT, label: "Update value proposition" },
        );
        changed.push("value proposition");
      }

      if (args.pricing !== undefined) {
        const pricing = args.pricing;
        session.store = updateDraftPricing(
          session.store,
          {
            ...(pricing.summary === undefined ? {} : { summary: pricing.summary }),
            ...(pricing.phases === undefined ? {} : { phases: pricing.phases.map(toPhase) }),
          },
          { ...TOOL_COMMIT, label: "Update pricing" },
        );
        changed.push("pricing");
      }

      if (args.terms !== undefined) {
        session.store = updateDraftTerms(session.store, cleanPatch(args.terms), {
          ...TOOL_COMMIT,
          label: "Update terms",
        });
        changed.push("terms");
      }

      if (args.nextSteps !== undefined) {
        session.store = replaceDraftNextSteps(session.store, args.nextSteps, {
          ...TOOL_COMMIT,
          label: "Set next steps",
        });
        changed.push("next steps");
      }

      const message =
        changed.length === 0
          ? "No fields provided; draft unchanged."
          : `Updated: ${changed.join(", ")}.`;
      return snapshotResult(session, message);
    },
  });
}
