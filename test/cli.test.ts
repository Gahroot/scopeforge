import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const TSX_BIN = join(process.cwd(), "node_modules", ".bin", "tsx");
const CLI_ENTRY = join(process.cwd(), "src", "cli", "main.ts");

describe("scopeforge CLI", () => {
  let workDir: string | null = null;

  afterEach(async () => {
    if (workDir !== null) {
      await rm(workDir, { recursive: true, force: true });
      workDir = null;
    }
  });

  it("renders an HTML proposal file via the --example path", async () => {
    // Arrange
    workDir = await mkdtemp(join(tmpdir(), "scopeforge-cli-"));
    const outputPath = join(workDir, "proposal.html");

    // Act
    const { stdout } = await run(TSX_BIN, [CLI_ENTRY, "--example", "--out", outputPath], {
      cwd: process.cwd(),
    });
    const html = await readFile(outputPath, "utf8");

    // Assert
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("Black Mountain Solutions");
    expect(stdout).toContain("ScopeForge proposal");
    expect(stdout).toContain("Year-one value:");
  }, 60_000);
});
