const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

describe("Escrow Contract Address & Funding Invariants", function () {
  const escrowSource = fs.readFileSync(path.join(__dirname, "../lib/escrow.ts"), "utf8");
  const fundPanelSource = fs.readFileSync(path.join(__dirname, "../components/marketplace/escrow-fund-panel.tsx"), "utf8");
  const taskDetailPageSource = fs.readFileSync(path.join(__dirname, "../app/tasks/[id]/page.tsx"), "utf8");
  const actionsSource = fs.readFileSync(path.join(__dirname, "../app/tasks/actions.ts"), "utf8");

  // Extract canonical constants directly from lib/escrow.ts
  const extractConst = (name) => {
    const match = escrowSource.match(new RegExp(`export const ${name} =\\s*["']([^"']+)["']`));
    return match ? match[1] : null;
  };

  const ESCROW_V0_CONTRACT_ADDRESS = extractConst("ESCROW_V0_CONTRACT_ADDRESS");
  const ESCROW_V1_CONTRACT_ADDRESS = extractConst("ESCROW_V1_CONTRACT_ADDRESS");
  const ESCROW_V2_CONTRACT_ADDRESS = extractConst("ESCROW_V2_CONTRACT_ADDRESS");

  it("exports valid canonical contract addresses in lib/escrow.ts", function () {
    expect(ESCROW_V0_CONTRACT_ADDRESS).to.equal("0x89FAF386c052B55363fdEe45B04c48fcDcb5A692");
    expect(ESCROW_V1_CONTRACT_ADDRESS).to.equal("0x81AcFAbb2D7f99fC68d764f720c731a0fA5C0995");
    expect(ESCROW_V2_CONTRACT_ADDRESS).to.equal("0xdf680c699B705eB0e301fD83cA4A066F97a70f31");
  });

  it("verifies EscrowFundPanel routes FCFS reward mode to ESCROW_V2_CONTRACT_ADDRESS", function () {
    expect(fundPanelSource).to.include("ESCROW_V2_CONTRACT_ADDRESS");
    expect(fundPanelSource).to.include('rewardMode === "fcfs"');
    expect(fundPanelSource).to.include("targetEscrowAddress");
  });

  it("verifies TaskDetailPage passes rewardMode to EscrowFundPanel without dropping fcfs", function () {
    expect(taskDetailPageSource).to.include("rewardMode={dbTask.reward_mode}");
    expect(taskDetailPageSource).to.not.include('rewardMode={dbTask.reward_mode === "raffle" ? "raffle" : "fixed"}');
  });

  it("verifies actions.ts records ESCROW_V2_CONTRACT_ADDRESS for fcfs tasks", function () {
    expect(actionsSource).to.include('row.reward_mode === "fcfs"');
    expect(actionsSource).to.include("ESCROW_V2_CONTRACT_ADDRESS");
  });

  // Pure logic mirror of escrowContractForTask in lib/escrow.ts
  function escrowContractForTask(input) {
    if (input.rewardMode === "fcfs") return ESCROW_V2_CONTRACT_ADDRESS;
    if (input.escrowContractAddress) return input.escrowContractAddress;
    return input.escrowTxHash ? ESCROW_V0_CONTRACT_ADDRESS : ESCROW_V1_CONTRACT_ADDRESS;
  }

  // Pure logic mirror of target contract resolution in EscrowFundPanel
  function resolveFundingContract(rewardMode) {
    return rewardMode === "fcfs" ? ESCROW_V2_CONTRACT_ADDRESS : ESCROW_V1_CONTRACT_ADDRESS;
  }

  // Pure logic mirror of uuidToBytes32 in lib/escrow.ts
  function uuidToBytes32(uuid) {
    const hex = uuid.replace(/-/g, "").toLowerCase();
    if (hex.length !== 32 || /[^0-9a-f]/.test(hex)) {
      throw new Error(`Invalid task UUID for escrow: ${uuid}`);
    }
    return `0x${hex.padEnd(64, "0")}`;
  }

  describe("Funding contract routing", function () {
    it("routes fcfs reward mode to BountixEscrowV2 address", function () {
      const contract = resolveFundingContract("fcfs");
      expect(contract.toLowerCase()).to.equal(ESCROW_V2_CONTRACT_ADDRESS.toLowerCase());
    });

    it("routes fixed and raffle reward modes to BountixEscrowV1 address", function () {
      expect(resolveFundingContract("fixed").toLowerCase()).to.equal(
        ESCROW_V1_CONTRACT_ADDRESS.toLowerCase()
      );
      expect(resolveFundingContract("raffle").toLowerCase()).to.equal(
        ESCROW_V1_CONTRACT_ADDRESS.toLowerCase()
      );
    });
  });

  describe("escrowContractForTask resolution", function () {
    it("resolves FCFS tasks to BountixEscrowV2 regardless of legacy fallback", function () {
      const resolved = escrowContractForTask({
        escrowContractAddress: null,
        escrowTxHash: "0x123",
        rewardMode: "fcfs",
      });
      expect(resolved).to.equal(ESCROW_V2_CONTRACT_ADDRESS);
    });

    it("uses recorded escrowContractAddress when explicitly stored", function () {
      const customAddress = "0x1111111111111111111111111111111111111111";
      const resolved = escrowContractForTask({
        escrowContractAddress: customAddress,
        escrowTxHash: "0xabc",
        rewardMode: "fixed",
      });
      expect(resolved).to.equal(customAddress);
    });

    it("falls back to BountixEscrowV0 for legacy funded tasks missing recorded address", function () {
      const resolved = escrowContractForTask({
        escrowContractAddress: null,
        escrowTxHash: "0xoldhash",
        rewardMode: "fixed",
      });
      expect(resolved).to.equal(ESCROW_V0_CONTRACT_ADDRESS);
    });

    it("defaults to active BountixEscrowV1 when not yet funded", function () {
      const resolved = escrowContractForTask({
        escrowContractAddress: null,
        escrowTxHash: null,
        rewardMode: "fixed",
      });
      expect(resolved).to.equal(ESCROW_V1_CONTRACT_ADDRESS);
    });
  });

  describe("UUID to bytes32 deterministic formatting", function () {
    it("converts standard RFC 4122 UUID to right-padded 32-byte hex", function () {
      const uuid = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";
      const bytes32 = uuidToBytes32(uuid);
      expect(bytes32.startsWith("0x")).to.be.true;
      expect(bytes32.length).to.equal(66); // 0x + 64 hex characters
      expect(bytes32).to.equal(
        "0xa1b2c3d4e5f67a8b9c0d1e2f3a4b5c6d00000000000000000000000000000000"
      );
    });

    it("rejects invalid UUID formats", function () {
      expect(() => uuidToBytes32("not-a-valid-uuid")).to.throw(/Invalid task UUID/);
      expect(() => uuidToBytes32("12345")).to.throw(/Invalid task UUID/);
    });
  });
});

