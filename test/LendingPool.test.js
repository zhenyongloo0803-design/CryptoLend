const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LendingPool", function () {
  async function deployFixture() {
    const [deployer, borrower] = await ethers.getSigners();
    const parseUsdt = (value) => ethers.parseUnits(value, 6);

    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    const mockUsdt = await MockUSDT.deploy();

    const LendingPool = await ethers.getContractFactory("LendingPool");
    const lendingPool = await LendingPool.deploy(await mockUsdt.getAddress());

    await mockUsdt.mint(deployer.address, parseUsdt("25000"));
    await mockUsdt.mint(borrower.address, parseUsdt("10000"));
    await mockUsdt.transfer(await lendingPool.getAddress(), parseUsdt("5000"));
    await deployer.sendTransaction({
      to: await lendingPool.getAddress(),
      value: ethers.parseEther("1000")
    });

    return { deployer, borrower, mockUsdt, lendingPool, parseUsdt };
  }

  it("deploys MockUSDT and LendingPool with funded liquidity", async function () {
    const { lendingPool, mockUsdt, parseUsdt } = await deployFixture();

    expect(await mockUsdt.balanceOf(await lendingPool.getAddress())).to.equal(parseUsdt("5000"));
    expect(await lendingPool.getPoolLiquidityUsdt()).to.equal(parseUsdt("5000"));
    expect(await ethers.provider.getBalance(await lendingPool.getAddress())).to.equal(ethers.parseEther("1000"));
  });

  it("lets account2 borrow within 70% LTV using ETH collateral", async function () {
    const { borrower, mockUsdt, lendingPool, parseUsdt } = await deployFixture();
    const collateral = ethers.parseEther("0.01");
    const borrowAmount = parseUsdt("0.7");

    await expect(
      lendingPool.connect(borrower).borrowWithEthCollateral(borrowAmount, { value: collateral })
    ).to.emit(lendingPool, "Borrowed");

    const position = await lendingPool.positions(borrower.address);
    expect(position.collateralWei).to.equal(collateral);
    expect(position.borrowedUsdt).to.equal(borrowAmount);
    expect(await mockUsdt.balanceOf(borrower.address)).to.equal(parseUsdt("10000.7"));
    expect(await ethers.provider.getBalance(await lendingPool.getAddress())).to.equal(ethers.parseEther("1000.01"));
    expect(await lendingPool.totalBorrowedUsdt()).to.equal(borrowAmount);
  });

  it("rejects borrow requests above max LTV", async function () {
    const { borrower, lendingPool, parseUsdt } = await deployFixture();

    await expect(
      lendingPool.connect(borrower).borrowWithEthCollateral(parseUsdt("0.71"), {
        value: ethers.parseEther("0.01")
      })
    ).to.be.revertedWith("Exceeds max LTV");
  });

  it("rejects borrow when pool has insufficient MockUSDT liquidity", async function () {
    const { borrower, lendingPool, parseUsdt } = await deployFixture();

    await expect(
      lendingPool.connect(borrower).borrowWithEthCollateral(parseUsdt("7000"), {
        value: ethers.parseEther("1000")
      })
    ).to.be.revertedWith("Pool liquidity low");
  });

  it("lets an investor stake mUSDT after approving the pool", async function () {
    const { borrower, mockUsdt, lendingPool, parseUsdt } = await deployFixture();
    const stakeAmount = parseUsdt("100");

    await mockUsdt.connect(borrower).approve(await lendingPool.getAddress(), stakeAmount);

    await expect(lendingPool.connect(borrower).stakeUsdt(stakeAmount))
      .to.emit(lendingPool, "Staked")
      .withArgs(borrower.address, stakeAmount);

    expect(await lendingPool.stakedUsdt(borrower.address)).to.equal(stakeAmount);
    expect(await lendingPool.totalStakedUsdt()).to.equal(stakeAmount);
    expect(await mockUsdt.balanceOf(borrower.address)).to.equal(parseUsdt("9900"));
  });

  it("rejects staking more mUSDT than the wallet balance", async function () {
    const { borrower, mockUsdt, lendingPool, parseUsdt } = await deployFixture();
    const stakeAmount = parseUsdt("10001");

    await mockUsdt.connect(borrower).approve(await lendingPool.getAddress(), stakeAmount);

    await expect(lendingPool.connect(borrower).stakeUsdt(stakeAmount)).to.be.revertedWith("Balance too low");
  });

  it("lets an investor claim rewards", async function () {
    const { borrower, mockUsdt, lendingPool, parseUsdt } = await deployFixture();
    const stakeAmount = parseUsdt("1000");

    await mockUsdt.connect(borrower).approve(await lendingPool.getAddress(), stakeAmount);
    await lendingPool.connect(borrower).stakeUsdt(stakeAmount);
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const reward = await lendingPool.pendingRewardUsdt(borrower.address);
    expect(reward).to.be.greaterThanOrEqual(parseUsdt("120"));
    expect(reward).to.be.lessThan(parseUsdt("120.01"));

    await expect(lendingPool.connect(borrower).claimRewards()).to.emit(lendingPool, "RewardClaimed");

    const borrowerBalance = await mockUsdt.balanceOf(borrower.address);
    expect(borrowerBalance).to.be.greaterThanOrEqual(parseUsdt("9120"));
    expect(borrowerBalance).to.be.lessThan(parseUsdt("9120.01"));
  });

  it("lets an investor unstake principal and rewards", async function () {
    const { borrower, mockUsdt, lendingPool, parseUsdt } = await deployFixture();
    const stakeAmount = parseUsdt("1000");

    await mockUsdt.connect(borrower).approve(await lendingPool.getAddress(), stakeAmount);
    await lendingPool.connect(borrower).stakeUsdt(stakeAmount);
    await ethers.provider.send("evm_increaseTime", [365 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(lendingPool.connect(borrower).unstakeUsdt(stakeAmount)).to.emit(lendingPool, "Unstaked");

    expect(await lendingPool.stakedUsdt(borrower.address)).to.equal(0);
    expect(await lendingPool.totalStakedUsdt()).to.equal(0);
    const borrowerBalance = await mockUsdt.balanceOf(borrower.address);
    expect(borrowerBalance).to.be.greaterThanOrEqual(parseUsdt("10120"));
    expect(borrowerBalance).to.be.lessThan(parseUsdt("10120.01"));
  });
});
