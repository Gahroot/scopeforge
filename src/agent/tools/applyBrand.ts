import { z } from "zod";
import { resolveBrand, validateProposalBrand } from "../../proposal/brands.js";
import type { ProposalBrand } from "../../proposal/types.js";
import { applyClientBrandToSession } from "../session.node.js";
import { defineTool, snapshotResult, type ResolvedToolDeps } from "./shared.js";

const colorsSchema = z.object({
  primary: z.string().min(1),
  secondary: z.string().min(1),
  accent: z.string().min(1),
  background: z.string().min(1),
  surface: z.string().min(1),
  text: z.string().min(1),
  mutedText: z.string().min(1),
  border: z.string().min(1),
});

const brandSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  legalName: z.string().min(1).optional(),
  tagline: z.string().min(1).optional(),
  website: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  logoText: z.string().min(1),
  colors: colorsSchema,
});

/**
 * Apply a brand to the session. `target: "vendor"` (default) styles the rendered
 * proposal; `target: "client"` seeds the prepared-for block. Either a built-in
 * `brandId` or a full custom `brand` object may be supplied. Custom brands are
 * validated through the existing brand validator before they are accepted.
 */
export function applyBrand(deps: ResolvedToolDeps) {
  const { session } = deps;
  return defineTool({
    name: "apply_brand",
    description:
      "Apply a brand to the proposal. Use brandId for a built-in ('nolan' or 'partners') or pass a " +
      "full custom brand. target 'vendor' styles the document; 'client' seeds the prepared-for block.",
    executionMode: "sequential",
    parameters: z
      .object({
        brandId: z.string().min(1).optional(),
        brand: brandSchema.optional(),
        target: z.enum(["vendor", "client"]).optional(),
      })
      .refine((value) => value.brandId !== undefined || value.brand !== undefined, {
        message: "Provide either brandId or a full brand object.",
      }),
    execute: (args) => {
      const target = args.target ?? "vendor";

      let brand: ProposalBrand;
      if (args.brand !== undefined) {
        const validated = validateProposalBrand(args.brand);
        if (!validated.ok) {
          const issues = validated.errors.map((e) => `${e.path}: ${e.message}`).join("; ");
          return snapshotResult(session, `Brand rejected: ${issues}`);
        }
        brand = validated.value;
      } else if (args.brandId !== undefined) {
        const resolved = resolveBrand(args.brandId);
        if (resolved === null) {
          return snapshotResult(
            session,
            `Unknown brandId "${args.brandId}". Use 'nolan', 'partners', or pass a full brand object.`,
          );
        }
        brand = resolved;
      } else {
        return snapshotResult(session, "Provide either brandId or a full brand object.");
      }

      if (target === "client") {
        applyClientBrandToSession(session, brand);
        return snapshotResult(session, `Seeded prepared-for from client brand "${brand.name}".`);
      }

      session.vendorBrand = brand;
      session.brandId = brand.id;
      return snapshotResult(session, `Applied vendor brand "${brand.name}" to the proposal.`);
    },
  });
}
