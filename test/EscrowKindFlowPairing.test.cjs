// Regression tests for escrow kind <-> release flow pairing.
//
// Bug context (escrow-fund-panel / escrow-release-panel mismatch): the app
// funded single-winner raffle tasks via fundRaffleEscrow (Raffle-kind
// escrow) but released them with assignWorker + releaseEscrow, which the
// contract only permits for Single-kind escrows. The failed pairing left
// funded tasks permanently stuck in Funded state ("Not single escrow").
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const ONE_USDC = 1_000_000n;

describe("Escrow kind / release flow pairing", function () {
  async function deployFixture() {
    const [owner, resolver, treasury, payer, worker, winner2] =
      await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const token = await MockUSDC.deploy();
    await token.waitForDeployment();

    const Escrow = await ethers.getContractFactory("BountixEscrowV1");
    const escrow = await Escrow.deploy(
      await token.getAddress(),
      resolver.address,
      treasury.address,
    );
    await escrow.waitForDeployment();

    await token.mint(payer.address, ONE_USDC * 10_000n);
    await token
      .connect(payer)
      .approve(await escrow.getAddress(), ONE_USDC * 10_000n);

    return { escrow, token, owner, resolver, treasury, payer, worker, winner2 };
  }

  it("documents the wedge: a Raffle-kind escrow cannot be released through the single flow", async function () {
    const { escrow, resolver, payer, worker } = await loadFixture(deployFixture);
    const taskId = ethers.id("pairing-raffle-task");

    // What EscrowFundPanel did for every raffle task (incl. 1 winner).
    await escrow.connect(payer).fundRaffleEscrow(taskId, ONE_USDC * 10n);

    // What EscrowReleasePanel does for single-winner raffle tasks.
    await expect(
      escrow.connect(resolver).assignWorker(taskId, worker.address),
    ).to.be.revertedWith("Not single escrow");
    await expect(escrow.connect(resolver).releaseEscrow(taskId)).to.be
      .revertedWith("Not single escrow");

    // Funds stay stranded in Funded state.
    const escrowRow = await escrow.getEscrow(taskId);
    expect(escrowRow.state).to.equal(1n); // Funded
    expect(escrowRow.kind).to.equal(2n); // Raffle
  });

  it("single-winner raffle payout works when funding pairs with the single release flow", async function () {
    const { escrow, token, resolver, treasury, payer, worker } =
      await loadFixture(deployFixture);
    const taskId = ethers.id("pairing-single-winner-task");

    // Corrected funding: single-winner raffles fund as Single-kind.
    await escrow.connect(payer).fundEscrow(taskId, ONE_USDC * 10n);

    // The release flow the app uses for single winners now succeeds.
    await escrow.connect(resolver).assignWorker(taskId, worker.address);
    await escrow.connect(resolver).releaseEscrow(taskId);

    const amount = ONE_USDC * 10n;
    const fee = (amount * 250n) / 10_000n; // default 2.5%
    expect(await token.balanceOf(worker.address)).to.equal(amount - fee);
    expect(await token.balanceOf(treasury.address)).to.equal(fee);

    const escrowRow = await escrow.getEscrow(taskId);
    expect(escrowRow.state).to.equal(2n); // Released
  });

  it("multi-winner raffle payout works when funding pairs with the raffle release flow", async function () {
    const { escrow, token, resolver, treasury, payer, worker, winner2 } =
      await loadFixture(deployFixture);
    const taskId = ethers.id("pairing-multi-winner-task");

    // Raffle-kind funding is only correct for multi-winner raffles.
    await escrow.connect(payer).fundRaffleEscrow(taskId, ONE_USDC * 20n);

    const reward = ONE_USDC * 10n;
    await escrow
      .connect(resolver)
      .assignRaffleWinners(
        taskId,
        [worker.address, winner2.address],
        [reward, reward],
      );
    await escrow.connect(resolver).releaseRaffleEscrow(taskId);

    const feePer = (reward * 250n) / 10_000n;
    expect(await token.balanceOf(worker.address)).to.equal(reward - feePer);
    expect(await token.balanceOf(winner2.address)).to.equal(reward - feePer);
    expect(await token.balanceOf(treasury.address)).to.equal(feePer * 2n);

    const escrowRow = await escrow.getEscrow(taskId);
    expect(escrowRow.state).to.equal(2n); // Released
  });
});
