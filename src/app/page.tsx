"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Coins,
  Database,
  DollarSign,
  Lock,
  Loader2,
  LogOut,
  Shield,
  TrendingUp,
  Wallet
} from "lucide-react";
import { BrowserProvider, Contract, JsonRpcProvider, formatEther, formatUnits, parseEther, parseUnits } from "ethers";
import { DEPLOYMENT, LENDING_POOL_ABI, MOCK_USDT_ABI, hasDeployment } from "@/lib/contracts";

type View = "home" | "lending" | "staking";

type BorrowHistory = {
  id: number;
  walletAddress: string;
  collateralAmount: string;
  borrowAmount: string;
  txHash: string;
  createdAt: string;
};

type StakingHistory = {
  id: number;
  walletAddress: string;
  action: string;
  amount: string;
  rewardAmount: string;
  txHash: string;
  createdAt: string;
};

const HARDHAT_CHAIN_ID = 31337;
const LOCAL_RPC_URL = "http://127.0.0.1:8545";
const PRICE_USDT_PER_ETH = 100;
const MAX_LTV = 0.7;
const INTEREST_RATE = 4;
const STAKING_APY = 12;
const GAS_BUFFER_ETH = 0.01;

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [account, setAccount] = useState("");
  const [ethBalance, setEthBalance] = useState("0");
  const [usdtBalance, setUsdtBalance] = useState("0");
  const [allowance, setAllowance] = useState("0");
  const [poolLiquidity, setPoolLiquidity] = useState("0");
  const [poolCollateral, setPoolCollateral] = useState("0");
  const [totalBorrowed, setTotalBorrowed] = useState("0");
  const [totalStaked, setTotalStaked] = useState("0");
  const [protocolStatus, setProtocolStatus] = useState("Connect Hardhat node to load protocol data.");
  const [position, setPosition] = useState({ collateral: "0", borrowed: "0", staked: "0", pendingReward: "0" });
  const [collateralAmount, setCollateralAmount] = useState("0.01");
  const [borrowAmount, setBorrowAmount] = useState("0.7");
  const [stakeAmount, setStakeAmount] = useState("100");
  const [unstakeAmount, setUnstakeAmount] = useState("100");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [borrowHistory, setBorrowHistory] = useState<BorrowHistory[]>([]);
  const [stakingHistory, setStakingHistory] = useState<StakingHistory[]>([]);

  const deploymentReady = hasDeployment();
  const collateralValue = useMemo(() => toNumber(collateralAmount) * PRICE_USDT_PER_ETH, [collateralAmount]);
  const maxBorrow = useMemo(() => collateralValue * MAX_LTV, [collateralValue]);
  const healthFactor = useMemo(() => {
    const borrow = toNumber(borrowAmount);
    return borrow > 0 ? maxBorrow / borrow : 0;
  }, [borrowAmount, maxBorrow]);
  const canShowSepoliaEth = toNumber(ethBalance) > 0;
  const needsApproval = toNumber(stakeAmount) > toNumber(allowance);
  const dailyReward = (toNumber(stakeAmount) * STAKING_APY) / 100 / 365;
  const yearlyReward = (toNumber(stakeAmount) * STAKING_APY) / 100;
  const portfolioValue = toNumber(ethBalance) * PRICE_USDT_PER_ETH + toNumber(usdtBalance);

  const getBrowserProvider = useCallback(async () => {
    if (!window.ethereum) {
      throw new Error("MetaMask is not available. Please install MetaMask first.");
    }

    return new BrowserProvider(window.ethereum);
  }, []);

  const refreshBorrowHistory = useCallback(async () => {
    const response = await fetch("/api/borrow-history", { cache: "no-store" });
    if (response.ok) setBorrowHistory(await response.json());
  }, []);

  const refreshStakingHistory = useCallback(async () => {
    const response = await fetch("/api/staking-history", { cache: "no-store" });
    if (response.ok) setStakingHistory(await response.json());
  }, []);

  const refreshProtocol = useCallback(async () => {
    if (!deploymentReady) return;

    try {
      const provider = new JsonRpcProvider(LOCAL_RPC_URL);
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, provider);
      const [liquidityRaw, poolEth, borrowedRaw, stakedRaw] = await Promise.all([
        pool.getPoolLiquidityUsdt(),
        provider.getBalance(DEPLOYMENT.lendingPool),
        pool.totalBorrowedUsdt(),
        pool.totalStakedUsdt()
      ]);

      setPoolLiquidity(Number(formatUnits(liquidityRaw, 6)).toFixed(2));
      setPoolCollateral(Number(formatEther(poolEth)).toFixed(4));
      setTotalBorrowed(Number(formatUnits(borrowedRaw, 6)).toFixed(2));
      setTotalStaked(Number(formatUnits(stakedRaw, 6)).toFixed(2));
      setProtocolStatus("Protocol data loaded from Hardhat local chain.");
    } catch {
      setProtocolStatus("Hardhat node is not reachable. Run npm.cmd run hardhat:node and npm.cmd run deploy:local.");
    }
  }, [deploymentReady]);

  const refreshBalances = useCallback(
    async (walletAddress = account) => {
      if (!walletAddress || !deploymentReady) return;

      const provider = await getBrowserProvider();
      const usdt = new Contract(DEPLOYMENT.mockUsdt, MOCK_USDT_ABI, provider);
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, provider);

      const [eth, usdtRaw, allowanceRaw, loan, stakedRaw, pendingRaw] = await Promise.all([
        provider.getBalance(walletAddress),
        usdt.balanceOf(walletAddress),
        usdt.allowance(walletAddress, DEPLOYMENT.lendingPool),
        pool.positions(walletAddress),
        pool.stakedUsdt(walletAddress),
        pool.pendingRewardUsdt(walletAddress)
      ]);

      setEthBalance(Number(formatEther(eth)).toFixed(4));
      setUsdtBalance(Number(formatUnits(usdtRaw, 6)).toFixed(2));
      setAllowance(Number(formatUnits(allowanceRaw, 6)).toFixed(2));
      setPosition({
        collateral: Number(formatEther(loan.collateralWei)).toFixed(4),
        borrowed: Number(formatUnits(loan.borrowedUsdt, 6)).toFixed(2),
        staked: Number(formatUnits(stakedRaw, 6)).toFixed(2),
        pendingReward: Number(formatUnits(pendingRaw, 6)).toFixed(4)
      });
      await refreshProtocol();
    },
    [account, deploymentReady, getBrowserProvider, refreshProtocol]
  );

  const connectWallet = async () => {
    try {
      setError("");
      setStatus("Connecting MetaMask...");
      const provider = await getBrowserProvider();
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();

      if (Number(network.chainId) !== HARDHAT_CHAIN_ID && window.ethereum) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x7a69",
              chainName: "Hardhat Local",
              nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [LOCAL_RPC_URL],
              blockExplorerUrls: []
            }
          ]
        });
      }

      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setAccount(address);
      setStatus("Wallet connected successfully.");
      await refreshBalances(address);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to connect wallet.");
      setStatus("");
    }
  };

  const requireWallet = () => {
    if (!account) throw new Error("Please connect your MetaMask wallet first.");
    if (!deploymentReady) throw new Error("Contracts are not deployed yet. Run npm.cmd run deploy:local first.");
  };

  const validateBorrow = () => {
    requireWallet();
    const collateral = toNumber(collateralAmount);
    const borrow = toNumber(borrowAmount);
    const maxSpendableEth = Math.max(toNumber(ethBalance) - GAS_BUFFER_ETH, 0);

    if (collateral <= 0) throw new Error("Collateral amount must be greater than 0.");
    if (collateral > maxSpendableEth) throw new Error(`Collateral exceeds wallet balance after gas buffer. Max: ${maxSpendableEth.toFixed(4)} ETH.`);
    if (borrow <= 0) throw new Error("Borrow amount must be greater than 0.");
    if (borrow > maxBorrow) throw new Error("Borrow amount exceeds the 70% max LTV.");
    if (borrow > toNumber(poolLiquidity)) throw new Error("Borrow amount exceeds protocol mUSDT liquidity.");
  };

  const validateStake = () => {
    requireWallet();
    const stake = toNumber(stakeAmount);
    if (stake <= 0) throw new Error("Stake amount must be greater than 0.");
    if (stake > toNumber(usdtBalance)) throw new Error("Stake amount exceeds your wallet mUSDT balance.");
  };

  const borrow = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateBorrow();

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.borrowWithEthCollateral(parseUnits(borrowAmount, 6), {
        value: parseEther(collateralAmount)
      });

      setStatus("Borrow transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();

      await fetch("/api/borrow-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: await signer.getAddress(),
          collateralAmount,
          borrowAmount,
          txHash: receipt.hash
        })
      });

      setStatus("Borrow successful. Wallet and protocol balances refreshed.");
      await refreshBalances(await signer.getAddress());
      await refreshBorrowHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Borrow transaction failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const approveStake = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateStake();

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const usdt = new Contract(DEPLOYMENT.mockUsdt, MOCK_USDT_ABI, signer);
      const tx = await usdt.approve(DEPLOYMENT.lendingPool, parseUnits(stakeAmount, 6));

      setStatus("Approval submitted. Waiting for confirmation...");
      await tx.wait();
      setStatus("mUSDT approved. You can now stake.");
      await refreshBalances(await signer.getAddress());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Approval failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const stake = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateStake();
      if (needsApproval) throw new Error("Please approve mUSDT before staking.");

      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.stakeUsdt(parseUnits(stakeAmount, 6));

      setStatus("Stake transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();

      await fetch("/api/staking-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: await signer.getAddress(),
          action: "STAKE",
          amount: stakeAmount,
          rewardAmount: "0",
          txHash: receipt.hash
        })
      });

      setStatus("Stake successful. Your mUSDT is now earning rewards.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stake failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const claimRewards = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      requireWallet();
      if (toNumber(position.pendingReward) <= 0) throw new Error("No rewards available to claim yet.");

      const rewardBefore = position.pendingReward;
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.claimRewards();

      setStatus("Claim transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();

      await fetch("/api/staking-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: await signer.getAddress(),
          action: "CLAIM",
          amount: "0",
          rewardAmount: rewardBefore,
          txHash: receipt.hash
        })
      });

      setStatus("Rewards claimed successfully.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Claim failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const unstake = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      requireWallet();
      const amount = toNumber(unstakeAmount);
      if (amount <= 0) throw new Error("Unstake amount must be greater than 0.");
      if (amount > toNumber(position.staked)) throw new Error("Unstake amount exceeds your staked mUSDT.");

      const rewardBefore = position.pendingReward;
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.unstakeUsdt(parseUnits(unstakeAmount, 6));

      setStatus("Unstake transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();

      await fetch("/api/staking-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: await signer.getAddress(),
          action: "UNSTAKE",
          amount: unstakeAmount,
          rewardAmount: rewardBefore,
          txHash: receipt.hash
        })
      });

      setStatus("Unstake successful. Principal and rewards returned.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unstake failed.");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    refreshBorrowHistory().catch(() => undefined);
    refreshStakingHistory().catch(() => undefined);
    refreshProtocol().catch(() => undefined);
  }, [refreshBorrowHistory, refreshProtocol, refreshStakingHistory]);

  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccount = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setAccount(nextAccount);
      if (nextAccount) refreshBalances(nextAccount).catch(() => undefined);
    };

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    return () => window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [refreshBalances]);

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <button onClick={() => setView("home")} className="flex items-center gap-4 text-left">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-night text-white">
              <Coins className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-ink">CryptoLend</h1>
              <p className="text-sm text-slate-500">Decentralized Lending & Staking</p>
            </div>
          </button>

          {account ? (
            <div className="flex items-center gap-3 rounded-lg border border-line bg-slate-50 px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-mint" />
              <span className="font-medium text-slate-700">{shortAddress(account)}</span>
              <button onClick={() => setAccount("")} className="text-rose-500" aria-label="Disconnect wallet">
                <LogOut className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <button
              onClick={connectWallet}
              className="inline-flex items-center gap-2 rounded-lg bg-night px-5 py-3 font-semibold text-white"
            >
              <Wallet className="h-5 w-5" />
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        {!deploymentReady && (
          <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            Contracts are not deployed yet. Start Hardhat node and run <strong>npm.cmd run deploy:local</strong>.
          </div>
        )}

        {(status || error) && (
          <div className="mb-6 grid gap-3">
            {status && <Alert tone="success" text={status} />}
            {error && <Alert tone="error" text={error} />}
          </div>
        )}

        {view === "home" && (
          <HomeView
            account={account}
            portfolioValue={portfolioValue}
            position={position}
            poolLiquidity={poolLiquidity}
            totalStaked={totalStaked}
            onLending={() => setView("lending")}
            onStaking={() => setView("staking")}
          />
        )}
        {view === "lending" && (
          <LendingView
            account={account}
            canShowSepoliaEth={canShowSepoliaEth}
            ethBalance={ethBalance}
            usdtBalance={usdtBalance}
            collateralAmount={collateralAmount}
            setCollateralAmount={setCollateralAmount}
            borrowAmount={borrowAmount}
            setBorrowAmount={setBorrowAmount}
            collateralValue={collateralValue}
            maxBorrow={maxBorrow}
            healthFactor={healthFactor}
            poolLiquidity={poolLiquidity}
            poolCollateral={poolCollateral}
            protocolStatus={protocolStatus}
            totalBorrowed={totalBorrowed}
            totalStaked={totalStaked}
            position={position}
            borrowHistory={borrowHistory}
            isBusy={isBusy}
            onBack={() => setView("home")}
            onBorrow={borrow}
          />
        )}
        {view === "staking" && (
          <StakingView
            account={account}
            usdtBalance={usdtBalance}
            allowance={allowance}
            stakeAmount={stakeAmount}
            setStakeAmount={setStakeAmount}
            unstakeAmount={unstakeAmount}
            setUnstakeAmount={setUnstakeAmount}
            position={position}
            poolLiquidity={poolLiquidity}
            totalStaked={totalStaked}
            dailyReward={dailyReward}
            yearlyReward={yearlyReward}
            needsApproval={needsApproval}
            stakingHistory={stakingHistory}
            isBusy={isBusy}
            onBack={() => setView("home")}
            onApprove={approveStake}
            onStake={stake}
            onClaim={claimRewards}
            onUnstake={unstake}
          />
        )}
      </section>
    </main>
  );
}

function HomeView({
  account,
  portfolioValue,
  position,
  poolLiquidity,
  totalStaked,
  onLending,
  onStaking
}: {
  account: string;
  portfolioValue: number;
  position: { collateral: string; borrowed: string; staked: string; pendingReward: string };
  poolLiquidity: string;
  totalStaked: string;
  onLending: () => void;
  onStaking: () => void;
}) {
  return (
    <div className="py-8">
      <div className="mb-10 text-center">
        <h2 className="text-3xl font-semibold text-ink">Choose Your DeFi Strategy</h2>
        <p className="mx-auto mt-4 max-w-3xl text-lg leading-8 text-slate-500">
          Select lending to borrow mUSDT against your crypto, or staking to earn rewards by supplying mUSDT liquidity.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-7 md:grid-cols-2">
        <StrategyCard
          icon={<DollarSign className="h-9 w-9 text-blue-600" />}
          title="Lending"
          description="Use SepoliaETH as collateral to borrow mUSDT instantly while keeping your crypto exposure."
          rows={[
            ["Interest Rate", "4%"],
            ["Max LTV", "70%"],
            ["Available Liquidity", `${poolLiquidity} mUSDT`]
          ]}
          onClick={onLending}
        />
        <StrategyCard
          icon={<TrendingUp className="h-9 w-9 text-violet-600" />}
          title="Staking"
          description="Stake mUSDT into the protocol liquidity pool and claim demo rewards from smart contract reserves."
          rows={[
            ["APY", "12%"],
            ["Rewards", "Claimable"],
            ["Total Staked", `${totalStaked} mUSDT`]
          ]}
          onClick={onStaking}
        />
      </div>

      <section className="mx-auto mt-8 max-w-5xl rounded-lg border border-violet-200 bg-violet-50 p-6">
        <div className="mb-5 flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white">
            <Wallet className="h-7 w-7 text-ink" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-ink">Your Portfolio Overview</h3>
            <p className="text-slate-500">
              {account ? "Connected wallet positions are shown below." : "Connect your wallet to load your positions."}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <SummaryMetric label="Total Balance" value={`$${portfolioValue.toFixed(2)}`} />
          <SummaryMetric label="Borrowed" value={`${position.borrowed} mUSDT`} />
          <SummaryMetric label="Staked" value={`${position.staked} mUSDT`} />
          <SummaryMetric label="Pending Rewards" value={`${position.pendingReward} mUSDT`} />
        </div>
      </section>
    </div>
  );
}

function LendingView(props: {
  account: string;
  canShowSepoliaEth: boolean;
  ethBalance: string;
  usdtBalance: string;
  collateralAmount: string;
  setCollateralAmount: (value: string) => void;
  borrowAmount: string;
  setBorrowAmount: (value: string) => void;
  collateralValue: number;
  maxBorrow: number;
  healthFactor: number;
  poolLiquidity: string;
  poolCollateral: string;
  protocolStatus: string;
  totalBorrowed: string;
  totalStaked: string;
  position: { collateral: string; borrowed: string; staked: string; pendingReward: string };
  borrowHistory: BorrowHistory[];
  isBusy: boolean;
  onBack: () => void;
  onBorrow: () => void;
}) {
  return (
    <div>
      <PageTitle onBack={props.onBack} title="Borrow USDT" subtitle="Use SepoliaETH as collateral to borrow MockUSDT." />
      <div className="grid gap-7 lg:grid-cols-[1fr_420px]">
        <div className="space-y-7">
          <Panel title="Select Collateral">
            {props.account && props.canShowSepoliaEth ? (
              <div className="rounded-lg border-2 border-slate-900 bg-slate-50 p-5">
                <div className="mb-5 flex items-start justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white">
                      <Shield className="h-6 w-6 text-slate-700" />
                    </div>
                    <div>
                      <p className="text-xl font-semibold text-ink">SepoliaETH</p>
                      <p className="text-sm text-slate-500">Hardhat native ETH simulation</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-slate-500">Wallet Balance</p>
                    <p className="font-semibold text-ink">{props.ethBalance} ETH</p>
                  </div>
                </div>
                <div className="grid gap-3 text-sm text-slate-600 sm:grid-cols-3">
                  <p>Price: <strong className="text-ink">$100</strong></p>
                  <p>Max LTV: <strong className="text-mint">70%</strong></p>
                  <p>Interest: <strong className="text-ink">4%</strong></p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500">
                {props.account ? "No supported collateral with positive balance was found." : "Connect wallet to load supported collateral."}
              </div>
            )}
          </Panel>

          <Panel title="Collateral Details">
            <Input label="Collateral Amount (SepoliaETH)" value={props.collateralAmount} onChange={props.setCollateralAmount} />
            <p className="mb-5 text-sm text-slate-500">Approx. ${props.collateralValue.toFixed(2)}</p>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
              <div className="mb-4 flex items-center gap-3">
                <Shield className="h-5 w-5 text-blue-600" />
                <p className="font-semibold text-ink">Collateral Value</p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <SummaryMetric label="Total Value" value={`$${props.collateralValue.toFixed(2)}`} />
                <SummaryMetric label="Max Loan (LTV 70%)" value={`${props.maxBorrow.toFixed(2)} USDT`} positive />
              </div>
            </div>
          </Panel>

          <History title="Borrow History" rows={props.borrowHistory.map((item) => ({
            id: item.id,
            title: shortAddress(item.walletAddress),
            detail: `Collateral ${item.collateralAmount} ETH - Borrowed ${item.borrowAmount} mUSDT`,
            txHash: item.txHash,
            createdAt: item.createdAt
          }))} />
        </div>

        <aside className="h-fit space-y-5">
          <Panel title="Loan Details">
            <Input label="Loan Amount (MockUSDT)" value={props.borrowAmount} onChange={props.setBorrowAmount} />
            <p className="mb-5 text-sm text-slate-500">Max: {props.maxBorrow.toFixed(2)} USDT</p>
            <div className="space-y-3">
              <Metric label="Interest Rate" value="4%" />
              <Metric label="Health Factor" value={props.healthFactor ? props.healthFactor.toFixed(2) : "-"} positive={props.healthFactor >= 1} />
              <Metric label="Pool Liquidity" value={`${props.poolLiquidity} mUSDT`} />
              <Metric label="Wallet mUSDT" value={`${props.usdtBalance} mUSDT`} />
              <Metric label="Your Collateral" value={`${props.position.collateral} ETH`} />
              <Metric label="Your Borrowed" value={`${props.position.borrowed} mUSDT`} />
            </div>
            <PrimaryButton disabled={!props.account || props.isBusy} onClick={props.onBorrow} busy={props.isBusy}>
              Borrow USDT
            </PrimaryButton>
          </Panel>
          <ProtocolPanel
            protocolStatus={props.protocolStatus}
            poolCollateral={props.poolCollateral}
            poolLiquidity={props.poolLiquidity}
            totalBorrowed={props.totalBorrowed}
            totalStaked={props.totalStaked}
          />
        </aside>
      </div>
    </div>
  );
}

function StakingView(props: {
  account: string;
  usdtBalance: string;
  allowance: string;
  stakeAmount: string;
  setStakeAmount: (value: string) => void;
  unstakeAmount: string;
  setUnstakeAmount: (value: string) => void;
  position: { collateral: string; borrowed: string; staked: string; pendingReward: string };
  poolLiquidity: string;
  totalStaked: string;
  dailyReward: number;
  yearlyReward: number;
  needsApproval: boolean;
  stakingHistory: StakingHistory[];
  isBusy: boolean;
  onBack: () => void;
  onApprove: () => void;
  onStake: () => void;
  onClaim: () => void;
  onUnstake: () => void;
}) {
  return (
    <div>
      <PageTitle onBack={props.onBack} title="Stake mUSDT" subtitle="Supply liquidity to the protocol and claim demo rewards." />
      <div className="grid gap-7 lg:grid-cols-[1fr_420px]">
        <div className="space-y-7">
          <Panel title="Investor Staking">
            <div className="mb-5 grid gap-4 md:grid-cols-3">
              <SummaryMetric label="Wallet mUSDT" value={`${props.usdtBalance} mUSDT`} />
              <SummaryMetric label="Staked mUSDT" value={`${props.position.staked} mUSDT`} />
              <SummaryMetric label="Pending Reward" value={`${props.position.pendingReward} mUSDT`} positive />
            </div>
            <Input label="Stake Amount (mUSDT)" value={props.stakeAmount} onChange={props.setStakeAmount} />
            <div className="mb-5 rounded-lg border border-violet-200 bg-violet-50 p-5">
              <div className="grid gap-5 sm:grid-cols-3">
                <SummaryMetric label="APY" value="12%" positive />
                <SummaryMetric label="Est. Daily Reward" value={`${props.dailyReward.toFixed(4)} mUSDT`} />
                <SummaryMetric label="Est. Yearly Reward" value={`${props.yearlyReward.toFixed(2)} mUSDT`} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PrimaryButton disabled={!props.account || props.isBusy || !props.needsApproval} onClick={props.onApprove} busy={props.isBusy && props.needsApproval}>
                Approve mUSDT
              </PrimaryButton>
              <PrimaryButton disabled={!props.account || props.isBusy || props.needsApproval} onClick={props.onStake} busy={props.isBusy && !props.needsApproval}>
                Stake mUSDT
              </PrimaryButton>
            </div>
            <p className="mt-3 text-sm text-slate-500">Current allowance: {props.allowance} mUSDT</p>
          </Panel>

          <Panel title="Manage Staked Assets">
            <Input label="Unstake Amount (mUSDT)" value={props.unstakeAmount} onChange={props.setUnstakeAmount} />
            <div className="grid gap-3 sm:grid-cols-2">
              <PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.pendingReward) <= 0} onClick={props.onClaim} busy={props.isBusy}>
                Claim Rewards
              </PrimaryButton>
              <PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.staked) <= 0} onClick={props.onUnstake} busy={props.isBusy}>
                Unstake
              </PrimaryButton>
            </div>
          </Panel>

          <History title="Staking History" rows={props.stakingHistory.map((item) => ({
            id: item.id,
            title: `${item.action} - ${shortAddress(item.walletAddress)}`,
            detail: `Amount ${item.amount} mUSDT - Reward ${item.rewardAmount} mUSDT`,
            txHash: item.txHash,
            createdAt: item.createdAt
          }))} />
        </div>

        <aside className="h-fit">
          <Panel title="Staking Pool">
            <div className="space-y-3">
              <Metric label="APY" value="12%" positive />
              <Metric label="Total Staked" value={`${props.totalStaked} mUSDT`} />
              <Metric label="Pool Liquidity" value={`${props.poolLiquidity} mUSDT`} />
              <Metric label="Your Stake" value={`${props.position.staked} mUSDT`} />
              <Metric label="Pending Reward" value={`${props.position.pendingReward} mUSDT`} positive />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function StrategyCard({ icon, title, description, rows, onClick }: { icon: React.ReactNode; title: string; description: string; rows: string[][]; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-lg border border-line bg-white p-7 text-left shadow-soft transition hover:border-slate-900">
      <div className="mb-10 flex items-start justify-between">
        <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100">{icon}</div>
        <ArrowRight className="h-6 w-6 text-slate-500" />
      </div>
      <h3 className="mb-4 text-2xl font-semibold text-ink">{title}</h3>
      <p className="mb-6 leading-7 text-slate-500">{description}</p>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <Metric key={label} label={label} value={value} positive={value.includes("%") || value.includes("Claimable")} />
        ))}
      </div>
    </button>
  );
}

function PageTitle({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle: string }) {
  return (
    <div className="mb-7 flex items-center gap-4">
      <button onClick={onBack} aria-label="Back to strategy page">
        <ArrowLeft className="h-6 w-6 text-ink" />
      </button>
      <div>
        <h2 className="text-2xl font-semibold text-ink">{title}</h2>
        <p className="text-slate-500">{subtitle}</p>
      </div>
    </div>
  );
}

function ProtocolPanel({ protocolStatus, poolCollateral, poolLiquidity, totalBorrowed, totalStaked }: { protocolStatus: string; poolCollateral: string; poolLiquidity: string; totalBorrowed: string; totalStaked: string }) {
  return (
    <Panel title="Protocol Dashboard">
      <p className="mb-4 text-sm text-slate-500">{protocolStatus}</p>
      <div className="space-y-3">
        <Metric label="Pool ETH Collateral" value={`${poolCollateral} ETH`} />
        <Metric label="Pool mUSDT Liquidity" value={`${poolLiquidity} mUSDT`} />
        <Metric label="Total Borrowed" value={`${totalBorrowed} mUSDT`} />
        <Metric label="Total Staked" value={`${totalStaked} mUSDT`} />
        <Metric label="Available Liquidity" value={`${poolLiquidity} mUSDT`} />
      </div>
      <div className="mt-4 space-y-3 text-sm">
        <AddressLine label="LendingPool" value={DEPLOYMENT.lendingPool || "Not deployed"} />
        <AddressLine label="MockUSDT" value={DEPLOYMENT.mockUsdt || "Not deployed"} />
      </div>
    </Panel>
  );
}

function History({ title, rows }: { title: string; rows: Array<{ id: number; title: string; detail: string; txHash: string; createdAt: string }> }) {
  return (
    <Panel title={title} icon={<Database className="h-5 w-5 text-slate-700" />}>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No records yet.</p>
        ) : (
          rows.map((item) => (
            <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-4 text-sm">
              <div className="mb-2 flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{item.title}</span>
                <span className="text-slate-500">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-slate-600">{item.detail}</p>
              <p className="mt-1 truncate text-slate-400">Tx: {item.txHash}</p>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-6 shadow-soft">
      <div className="mb-5 flex items-center gap-3">
        {icon}
        <h3 className="text-lg font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="mb-3 block">
      <span className="mb-2 block text-sm font-medium text-slate-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-line bg-slate-50 px-4 py-4 text-lg outline-none focus:border-slate-900"
        inputMode="decimal"
      />
    </label>
  );
}

function PrimaryButton({ children, disabled, busy, onClick }: { children: React.ReactNode; disabled: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-night px-5 py-4 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
    >
      {busy && <Loader2 className="h-5 w-5 animate-spin" />}
      {children}
    </button>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-4">
      <span className="text-slate-500">{label}</span>
      <span className={positive ? "font-semibold text-mint" : "font-semibold text-ink"}>{value}</span>
    </div>
  );
}

function SummaryMetric({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div>
      <p className="text-sm text-slate-500">{label}</p>
      <p className={positive ? "text-2xl font-semibold text-mint" : "text-2xl font-semibold text-ink"}>{value}</p>
    </div>
  );
}

function AddressLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="break-all font-mono text-xs text-slate-700">{value}</p>
    </div>
  );
}

function Alert({ tone, text }: { tone: "success" | "error"; text: string }) {
  const isSuccess = tone === "success";
  return (
    <div className={`flex items-center gap-2 rounded-lg border p-4 text-sm ${isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
      <CheckCircle2 className="h-5 w-5" />
      {text}
    </div>
  );
}
