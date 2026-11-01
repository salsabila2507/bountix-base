// Regression test for the single-winner raffle escrow wedge.
//
// Bug: EscrowFundPanel funded every raffle task via fundRaffleEscrow
// (Raffle-kind escrow), but the release flow for single-winner raffle
// tasks uses assignWorker + releaseEscrow, which the contract only
// allows for Single-kind escrows ("Not single escrow"). Result: every
// single-winner escrow raffle task could be funded but never released.
//
// This test pins the funding-kind decision so the kinds stay paired
// with the release flow in components/marketplace/escrow-release-panel.tsx.
//
// Runs with: node test/escrow-fund-kind.test.cjs
// Zero new dependencies — compiles the TS helper with the repo's
// typescript devDependency and uses node's built-in test runner.
const { execFileSync } = require("node:child_process");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");

const repoRoot = path.join(__dirname, "..");
const testRequire = createRequire(__filename);

let typescript;
try {
  typescript = testRequire("typescript");
} catch {
  console.error("typescript is not installed; run `npm install` first.");
  process.exit(1);
}

const outDir = mkdtempSync(path.join(tmpdir(), "escrow-fund-kind-"));

execFileSync(
  path.join(repoRoot, "node_modules", ".bin", "tsc"),
  [
    "--ignoreConfig",
    "--outDir",
    outDir,
    path.join(repoRoot, "lib", "escrow-fund-kind.ts"),
  ],
  { stdio: "inherit" },
);

const { escrowFundKind } = require(path.join(outDir, "escrow-fund-kind.js"));

/** Node's built-in mini test harness (no dependency needed). */
const checks = [
  ["fixed task -> Single", ["fixed", 1], "single"],
  ["fixed task with odd count -> Single", ["fixed", 3], "single"],
  ["single-winner raffle -> Single", ["raffle", 1], "single"],
  ["multi-winner raffle -> Raffle", ["raffle", 2], "raffle"],
  ["fcfs -> Single", ["fcfs", 1], "single"],
];

let failures = 0;
for (const [label, [mode, count], expected] of checks) {
  const actual = escrowFundKind(mode, count);
  if (actual !== expected) {
    failures++;
    console.error(
      `FAIL ${label}: escrowFundKind(${mode}, ${count}) = ${actual}, expected ${expected}`,
    );
  } else {
    console.log(`ok  ${label}`);
  }
}

if (failures > 0) {
  process.exit(1);
}
console.log(`${checks.length} checks passed`);
