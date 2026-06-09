import { describe, expect, it } from "vitest";
import type { StylePreset } from "./stylePreset.js";
import {
  BUILT_IN_STYLE_PRESET_IDS,
  GENERIC_STYLE_PRESET,
  TRITEN_STYLE_PRESET,
  getBuiltInStylePresets,
  isBuiltInStylePresetId,
  resolveStylePreset,
} from "./presets.js";

describe("built-in style presets", () => {
  it("triten preset has 5 sections covering the full proposal layout", () => {
    expect(TRITEN_STYLE_PRESET.id).toBe("triten");
    expect(TRITEN_STYLE_PRESET.sections.length).toBe(5);
    expect(TRITEN_STYLE_PRESET.layout.pageCount).toBe(5);
    expect(TRITEN_STYLE_PRESET.layout.coverLayout).toBe("full-bleed");
    expect(TRITEN_STYLE_PRESET.tone.dataDensity).toBe("high");
  });

  it("generic preset has 5 sections with centered cover", () => {
    expect(GENERIC_STYLE_PRESET.id).toBe("generic");
    expect(GENERIC_STYLE_PRESET.sections.length).toBe(5);
    expect(GENERIC_STYLE_PRESET.layout.coverLayout).toBe("centered");
    expect(GENERIC_STYLE_PRESET.tone.formality).toBe("formal");
  });

  it("all built-in presets have required fields", () => {
    const presets = getBuiltInStylePresets();
    expect(presets.length).toBe(2);
    for (const preset of presets) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.sections.length).toBeGreaterThan(0);
      expect(preset.css.coverGradient.length).toBeGreaterThan(0);
      expect(preset.css.fontFamily.length).toBeGreaterThan(0);
    }
  });

  it("section orders are contiguous", () => {
    for (const preset of getBuiltInStylePresets()) {
      const orders = preset.sections.map((s) => s.order);
      expect(orders).toEqual([...orders].sort((a, b) => a - b));
    }
  });
});

describe("isBuiltInStylePresetId", () => {
  it("returns true for known IDs", () => {
    expect(isBuiltInStylePresetId("triten")).toBe(true);
    expect(isBuiltInStylePresetId("generic")).toBe(true);
  });

  it("returns false for unknown IDs", () => {
    expect(isBuiltInStylePresetId("custom")).toBe(false);
    expect(isBuiltInStylePresetId("")).toBe(false);
  });
});

describe("resolveStylePreset", () => {
  it("resolves a built-in ID to the corresponding preset", () => {
    const triten = resolveStylePreset("triten");
    expect(triten?.id).toBe("triten");
    expect(triten?.name).toBe("Triten Value Proposal");
  });

  it("returns null for unknown IDs", () => {
    expect(resolveStylePreset("nonexistent")).toBeNull();
  });

  it("passes through a StylePreset object unchanged", () => {
    const preset: StylePreset = {
      ...TRITEN_STYLE_PRESET,
      id: "passthrough",
      name: "Passthrough",
    };
    expect(resolveStylePreset(preset)).toBe(preset);
  });
});
