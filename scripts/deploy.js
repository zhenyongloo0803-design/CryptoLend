const fs = require("node:fs");
const path = require("node:path");
const hre = require("hardhat");

async function main() {
  const [deployer, borrower, ...demoUsers] = await hre.ethers.getSigners();
  const parseUsdt = (value) => hre.ethers.parseUnits(value, 6);

  const MockUSDT = await hre.ethers.getContractFactory("MockUSDT");
  const mockUsdt = await MockUSDT.deploy();
  await mockUsdt.waitForDeployment();

  const LendingPool = await hre.ethers.getContractFactory("LendingPool");
  const lendingPool = await LendingPool.deploy(await mockUsdt.getAddress());
  await lendingPool.waitForDeployment();

  await (await mockUsdt.mint(deployer.address, parseUsdt("25000"))).wait();
  await (await mockUsdt.mint(borrower.address, parseUsdt("10000"))).wait();
  for (const demoUser of demoUsers.slice(0, 8)) {
    await (await mockUsdt.mint(demoUser.address, parseUsdt("10000"))).wait();
  }
  await (await mockUsdt.transfer(await lendingPool.getAddress(), parseUsdt("5000"))).wait();
  await (
    await deployer.sendTransaction({
      to: await lendingPool.getAddress(),
      value: hre.ethers.parseEther("1000")
    })
  ).wait();

  const deployment = {
    chainId: 31337,
    networkName: "Hardhat Local",
    deployer: deployer.address,
    demoBorrower: borrower.address,
    demoUsers: [borrower.address, ...demoUsers.slice(0, 8).map((signer) => signer.address)],
    mockUsdt: await mockUsdt.getAddress(),
    lendingPool: await lendingPool.getAddress(),
    constants: {
      ethPriceUsdt: "100",
      maxLtvBps: "7000",
      interestBps: "400",
      stakingApyBps: "1200",
      usdtDecimals: 6
    }
  };

  const outputPath = path.join(__dirname, "..", "src", "lib", "deployment.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(deployment, null, 2)}\n`);

  console.log("CryptoLend deployed");
  console.log(deployment);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
