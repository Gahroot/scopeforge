import { describe, expect, it } from "vitest";
import { BUILT_IN_BRANDS } from "../proposal/brands.js";
import { createProposalAuthorMetadata } from "../project/state.js";
import {
  DEFAULT_SESSION_AUTHOR,
  applyClientBrandToSession,
  buildSessionSnapshot,
  createSessionStore,
  resolveSessionVendorBrand,
  type AgentSession,
} from "./session.node.js";

function newSession(): AgentSession {
  return createSessionStore({ idFactory: () => "test-session" }).create();
}

describe("createSessionStore", () => {
  it("uses a safe local collaborator label when no author is provided", () => {
    const session = newSession();
    const snapshot = buildSessionSnapshot(session);

    expect(session.createdBy).toEqual(DEFAULT_SESSION_AUTHOR);
    expect(snapshot.author.displayName).toBe("Local collaborator");
    expect(snapshot.author.kind).toBe("human");
  });

  it("records a provided collaborator as the session author", () => {
    const author = createProposalAuthorMetadata({
      authorId: "human-riley",
      displayName: "Riley Chen",
      kind: "human",
    });
    const session = createSessionStore({ idFactory: () => "named-session" }).create({ author });

    expect(session.createdBy).toEqual(author);
    expect(buildSessionSnapshot(session).author).toEqual(author);
  });
});

describe("applyClientBrandToSession", () => {
  it("seeds preparedFor from the client brand", () => {
    const session = newSession();
    applyClientBrandToSession(session, BUILT_IN_BRANDS.partners);

    const preparedFor = session.store.current.preparedFor;
    expect(preparedFor.companyName).toBe(BUILT_IN_BRANDS.partners.name);
    expect(preparedFor.website).toBe(BUILT_IN_BRANDS.partners.website);
    expect(preparedFor.logoText).toBe(BUILT_IN_BRANDS.partners.logoText);
    expect(preparedFor.accentColor).toBe(BUILT_IN_BRANDS.partners.colors.accent);
    expect(session.clientBrand).toEqual(BUILT_IN_BRANDS.partners);
  });
});

describe("resolveSessionVendorBrand", () => {
  it("prefers the imported vendor brand over the built-in", () => {
    const session = newSession();
    expect(resolveSessionVendorBrand(session)?.id).toBe(session.brandId);

    session.vendorBrand = BUILT_IN_BRANDS.partners;
    expect(resolveSessionVendorBrand(session)).toEqual(BUILT_IN_BRANDS.partners);
  });
});
