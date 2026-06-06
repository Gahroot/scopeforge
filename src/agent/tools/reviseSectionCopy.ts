import { z } from "zod";
import {
  replaceDraftNextSteps,
  updateDraftDetails,
  updateDraftPricing,
  updateDraftValueProposal,
} from "../../proposal/draftStore.js";
import { defineTool, snapshotResult, TOOL_COMMIT, type ResolvedToolDeps } from "./shared.js";
import type { ProposalDraftStoreState } from "../../proposal/draftStore.js";

const TEXT_SECTIONS = [
  "title",
  "subtitle",
  "recommendation",
  "valueHeadline",
  "valueNarrative",
  "pricingSummary",
] as const;

const LIST_SECTIONS = [
  "executiveSummary",
  "whatWeHeard",
  "unlocks",
  "nextSteps",
] as const;

type TextSection = (typeof TEXT_SECTIONS)[number];
type ListSection = (typeof LIST_SECTIONS)[number];

const sectionSchema = z.enum([...TEXT_SECTIONS, ...LIST_SECTIONS]);

function isListSection(section: string): section is ListSection {
  return (LIST_SECTIONS as readonly string[]).includes(section);
}

function applyText(
  store: ProposalDraftStoreState,
  section: TextSection,
  text: string,
): ProposalDraftStoreState {
  const commit = { ...TOOL_COMMIT, label: `Revise ${section}` };
  switch (section) {
    case "title":
      return updateDraftDetails(store, { title: text }, commit);
    case "subtitle":
      return updateDraftDetails(store, { subtitle: text }, commit);
    case "recommendation":
      return updateDraftDetails(store, { recommendation: text }, commit);
    case "valueHeadline":
      return updateDraftValueProposal(store, { headline: text }, commit);
    case "valueNarrative":
      return updateDraftValueProposal(store, { narrative: text }, commit);
    case "pricingSummary":
      return updateDraftPricing(store, { summary: text }, commit);
  }
}

function applyList(
  store: ProposalDraftStoreState,
  section: ListSection,
  items: readonly string[],
): ProposalDraftStoreState {
  const commit = { ...TOOL_COMMIT, label: `Revise ${section}` };
  switch (section) {
    case "executiveSummary":
      return updateDraftDetails(store, { executiveSummary: items }, commit);
    case "whatWeHeard":
      return updateDraftDetails(store, { whatWeHeard: items }, commit);
    case "unlocks":
      return updateDraftValueProposal(store, { unlocks: items }, commit);
    case "nextSteps":
      return replaceDraftNextSteps(store, items, commit);
  }
}

/**
 * Persist agent-authored copy into a named narrative section. The tool only
 * writes — it never fabricates numbers — and routes through the draft store so
 * history/versioning is preserved. Single-line sections take `text`; bulleted
 * sections take `items`.
 */
export function reviseSectionCopy(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "revise_section_copy",
    description:
      "Replace the copy of one narrative section. Single-line sections (title, subtitle, " +
      "recommendation, valueHeadline, valueNarrative, pricingSummary) take `text`; bulleted sections " +
      "(executiveSummary, whatWeHeard, unlocks, nextSteps) take `items`.",
    executionMode: "sequential",
    parameters: z.object({
      section: sectionSchema,
      text: z.string().min(1).optional(),
      items: z.array(z.string().min(1)).min(1).optional(),
    }),
    execute: (args) => {
      if (isListSection(args.section)) {
        if (args.items === undefined) {
          return snapshotResult(session, `Section "${args.section}" needs a non-empty \`items\` array.`);
        }
        session.store = applyList(session.store, args.section, args.items);
      } else {
        if (args.text === undefined) {
          return snapshotResult(session, `Section "${args.section}" needs a non-empty \`text\` value.`);
        }
        session.store = applyText(session.store, args.section as TextSection, args.text);
      }
      return snapshotResult(session, `Revised "${args.section}".`);
    },
  });
}
