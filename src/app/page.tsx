"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Coins,
  Database,
  DollarSign,
  Loader2,
  LogOut,
  Moon,
  Search,
  Shield,
  Sun,
  TrendingUp,
  Wallet
} from "lucide-react";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  encodeBytes32String,
  formatEther,
  formatUnits,
  parseEther,
  parseUnits
} from "ethers";
import { DEPLOYMENT, LENDING_POOL_ABI, MOCK_USDT_ABI, hasDeployment } from "@/lib/contracts";

type View = "home" | "lending" | "staking";
type AssetKind = "native" | "erc20";

type Asset = {
  id: string;
  name: string;
  symbol: string;
  coingeckoId: string;
  type: AssetKind;
  address?: string;
  decimals: number;
  ltvBps: number;
  fallbackPrice: string;
};

type BorrowHistory = {
  id: number;
  walletAddress: string;
  collateralSymbol?: string;
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

type RepayHistory = {
  id: number;
  walletAddress: string;
  amount: string;
  interestPaid: string;
  principalPaid: string;
  txHash: string;
  createdAt: string;
};

const HARDHAT_CHAIN_ID = 31337;
const LOCAL_RPC_URL = "http://127.0.0.1:8545";
const INTEREST_RATE = 4;
const STAKING_APY = 12;
const GAS_BUFFER_ETH = 0.01;
const DEFAULT_ASSETS: Asset[] = [
  { id: "ETH", name: "ETH", symbol: "ETH", coingeckoId: "ethereum", type: "native", decimals: 18, ltvBps: 7000, fallbackPrice: "100" },
  { id: "BTC", name: "BTC", symbol: "BTC", coingeckoId: "bitcoin", type: "erc20", decimals: 8, ltvBps: 7000, fallbackPrice: "65000" },
  { id: "SOL", name: "Solana", symbol: "SOL", coingeckoId: "solana", type: "erc20", decimals: 9, ltvBps: 6500, fallbackPrice: "150" }
];

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isPositiveDecimal(value: string) {
  const trimmed = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) return false;
  return Number(trimmed) > 0;
}

function decimalPlaces(value: string) {
  return value.includes(".") ? value.split(".")[1]?.length || 0 : 0;
}

function playClickSound() {
  if (typeof window === "undefined") return;
  const audioWindow = window as Window & { webkitAudioContext?: typeof AudioContext };
  const AudioCtor = window.AudioContext || audioWindow.webkitAudioContext;
  if (!AudioCtor) return;

  try {
    const context = new AudioCtor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 520;
    gain.gain.setValueAtTime(0.025, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.08);
    window.setTimeout(() => context.close().catch(() => undefined), 140);
  } catch {
    // Sound is a polish feature only. Ignore browser audio restrictions.
  }
}

function assetKey(assetId: string) {
  return encodeBytes32String(assetId);
}

const deploymentAssets = (DEPLOYMENT as unknown as { assets?: Asset[] }).assets;
const SUPPORTED_ASSETS = (deploymentAssets?.length ? deploymentAssets : DEFAULT_ASSETS).map((asset) => ({
  ...asset,
  address: asset.address || (asset.id === "BTC" ? (DEPLOYMENT as unknown as { mockBtc?: string }).mockBtc : (asset.id === "SOL" ? (DEPLOYMENT as unknown as { mockSol?: string }).mockSol : undefined))
}));

export default function Home() {
  const [view, setView] = useState<View>("home");
  const [account, setAccount] = useState("");
  const [ethBalance, setEthBalance] = useState("0");
  const [usdtBalance, setUsdtBalance] = useState("0");
  const [usdtAllowance, setUsdtAllowance] = useState("0");
  const [assetBalances, setAssetBalances] = useState<Record<string, string>>({});
  const [assetAllowances, setAssetAllowances] = useState<Record<string, string>>({});
  const [tokenCollateral, setTokenCollateral] = useState<Record<string, string>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceSource, setPriceSource] = useState("fallback");
  const [poolLiquidity, setPoolLiquidity] = useState("0");
  const [poolCollateral, setPoolCollateral] = useState("0");
  const [totalBorrowed, setTotalBorrowed] = useState("0");
  const [totalStaked, setTotalStaked] = useState("0");
  const [protocolStatus, setProtocolStatus] = useState("Connect Hardhat node to load protocol data.");
  const [position, setPosition] = useState({ collateral: "0", borrowed: "0", accruedInterest: "0", totalDebt: "0", staked: "0", pendingReward: "0" });
  const [selectedAssetId, setSelectedAssetId] = useState("ETH");
  const [assetSearch, setAssetSearch] = useState("");
  const [collateralAmount, setCollateralAmount] = useState("0.01");
  const [borrowAmount, setBorrowAmount] = useState("0.7");
  const [repayAmount, setRepayAmount] = useState("1");
  const [stakeAmount, setStakeAmount] = useState("100");
  const [unstakeAmount, setUnstakeAmount] = useState("100");
  const [liquidityAmount, setLiquidityAmount] = useState("100");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const [isMessageClosing, setIsMessageClosing] = useState(false);
  const [borrowHistory, setBorrowHistory] = useState<BorrowHistory[]>([]);
  const [repayHistory, setRepayHistory] = useState<RepayHistory[]>([]);
  const [stakingHistory, setStakingHistory] = useState<StakingHistory[]>([]);

  const deploymentReady = hasDeployment();
  const selectedAsset = SUPPORTED_ASSETS.find((asset) => asset.id === selectedAssetId) || SUPPORTED_ASSETS[0];
  const selectedBalance = assetBalances[selectedAsset.id] || "0";
  const selectedAllowance = assetAllowances[selectedAsset.id] || "0";
  const selectedDemoPrice = toNumber(selectedAsset.fallbackPrice);
  const selectedLivePrice = prices[selectedAsset.coingeckoId] || selectedDemoPrice;
  const collateralValue = useMemo(() => toNumber(collateralAmount) * selectedDemoPrice, [collateralAmount, selectedDemoPrice]);
  const liveCollateralValue = useMemo(() => toNumber(collateralAmount) * selectedLivePrice, [collateralAmount, selectedLivePrice]);
  const maxBorrow = useMemo(() => (collateralValue * selectedAsset.ltvBps) / 10000, [collateralValue, selectedAsset.ltvBps]);
  const healthFactor = useMemo(() => {
    const borrow = toNumber(borrowAmount);
    return borrow > 0 ? maxBorrow / borrow : 0;
  }, [borrowAmount, maxBorrow]);
  const needsStakeApproval = toNumber(stakeAmount) > toNumber(usdtAllowance);
  const needsRepayApproval = toNumber(repayAmount) > toNumber(usdtAllowance);
  const needsFullRepayApproval = toNumber(position.totalDebt) + 0.01 > toNumber(usdtAllowance);
  const needsCollateralApproval = selectedAsset.type === "erc20" && toNumber(collateralAmount) > toNumber(selectedAllowance);
  const dailyReward = (toNumber(stakeAmount) * STAKING_APY) / 100 / 365;
  const yearlyReward = (toNumber(stakeAmount) * STAKING_APY) / 100;
  const portfolioValue = SUPPORTED_ASSETS.reduce((sum, asset) => {
    const price = prices[asset.coingeckoId] || toNumber(asset.fallbackPrice);
    return sum + toNumber(assetBalances[asset.id] || "0") * price;
  }, toNumber(usdtBalance));
  const isTreasury = account && account.toLowerCase() === DEPLOYMENT.deployer.toLowerCase();

  const visibleAssets = SUPPORTED_ASSETS.filter((asset) => {
    const matchesSearch = `${asset.name} ${asset.symbol}`.toLowerCase().includes(assetSearch.toLowerCase());
    const hasBalance = !account || toNumber(assetBalances[asset.id] || "0") > 0;
    return matchesSearch && hasBalance;
  });

  const showError = useCallback((message: string) => {
    setError(message);
    setIsShaking(false);
    window.setTimeout(() => setIsShaking(true), 0);
    window.setTimeout(() => setIsShaking(false), 460);
  }, []);

  const getBrowserProvider = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask is not available. Please install MetaMask first.");
    return new BrowserProvider(window.ethereum);
  }, []);

  const refreshPrices = useCallback(async () => {
    try {
      const response = await fetch("/api/prices", { cache: "no-store" });
      if (!response.ok) throw new Error("Price API failed");
      const data = await response.json();
      setPrices(data.prices || {});
      setPriceSource(data.source || "fallback");
    } catch {
      setPrices({ ethereum: 100, bitcoin: 65000, solana: 150 });
      setPriceSource("fallback");
    }
  }, []);

  const refreshBorrowHistory = useCallback(async (walletAddress = account) => {
    if (!walletAddress) {
      setBorrowHistory([]);
      return;
    }
    const response = await fetch(`/api/borrow-history?wallet=${walletAddress}`, { cache: "no-store" });
    if (response.ok) setBorrowHistory(await response.json());
  }, [account]);

  const refreshStakingHistory = useCallback(async (walletAddress = account) => {
    if (!walletAddress) {
      setStakingHistory([]);
      return;
    }
    const response = await fetch(`/api/staking-history?wallet=${walletAddress}`, { cache: "no-store" });
    if (response.ok) setStakingHistory(await response.json());
  }, [account]);

  const refreshRepayHistory = useCallback(async (walletAddress = account) => {
    if (!walletAddress) {
      setRepayHistory([]);
      return;
    }
    const response = await fetch(`/api/repay-history?wallet=${walletAddress}`, { cache: "no-store" });
    if (response.ok) setRepayHistory(await response.json());
  }, [account]);

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
      const [eth, usdtRaw, allowanceRaw, loan, accruedInterestRaw, totalDebtRaw, stakedRaw, pendingRaw] = await Promise.all([
        provider.getBalance(walletAddress),
        usdt.balanceOf(walletAddress),
        usdt.allowance(walletAddress, DEPLOYMENT.lendingPool),
        pool.positions(walletAddress),
        pool.getAccruedInterestUsdt(walletAddress),
        pool.getTotalDebtUsdt(walletAddress),
        pool.stakedUsdt(walletAddress),
        pool.pendingRewardUsdt(walletAddress)
      ]);

      const nextBalances: Record<string, string> = { ETH: Number(formatEther(eth)).toFixed(4) };
      const nextAllowances: Record<string, string> = {};
      const nextTokenCollateral: Record<string, string> = {};

      await Promise.all(SUPPORTED_ASSETS.filter((asset) => asset.type === "erc20" && asset.address).map(async (asset) => {
        const token = new Contract(asset.address!, MOCK_USDT_ABI, provider);
        const [balanceRaw, assetAllowanceRaw, collateralRaw] = await Promise.all([
          token.balanceOf(walletAddress),
          token.allowance(walletAddress, DEPLOYMENT.lendingPool),
          pool.tokenCollateral(walletAddress, assetKey(asset.id))
        ]);
        nextBalances[asset.id] = Number(formatUnits(balanceRaw, asset.decimals)).toFixed(4);
        nextAllowances[asset.id] = Number(formatUnits(assetAllowanceRaw, asset.decimals)).toFixed(4);
        nextTokenCollateral[asset.id] = Number(formatUnits(collateralRaw, asset.decimals)).toFixed(4);
      }));

      setEthBalance(Number(formatEther(eth)).toFixed(4));
      setUsdtBalance(Number(formatUnits(usdtRaw, 6)).toFixed(2));
      setUsdtAllowance(Number(formatUnits(allowanceRaw, 6)).toFixed(2));
      setAssetBalances(nextBalances);
      setAssetAllowances(nextAllowances);
      setTokenCollateral(nextTokenCollateral);
      setPosition({
        collateral: Number(formatEther(loan.collateralWei)).toFixed(4),
        borrowed: Number(formatUnits(loan.borrowedUsdt, 6)).toFixed(2),
        accruedInterest: Number(formatUnits(accruedInterestRaw, 6)).toFixed(4),
        totalDebt: Number(formatUnits(totalDebtRaw, 6)).toFixed(4),
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
          params: [{ chainId: "0x7a69", chainName: "Hardhat Local", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: [LOCAL_RPC_URL], blockExplorerUrls: [] }]
        });
      }
      const signer = await provider.getSigner();
      const address = await signer.getAddress();
      setAccount(address);
      setStatus("Wallet connected successfully.");
      await refreshBalances(address);
      await refreshBorrowHistory(address);
      await refreshRepayHistory(address);
      await refreshStakingHistory(address);
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Failed to connect wallet.");
      setStatus("");
    }
  };

  const requireWallet = () => {
    if (!account) throw new Error("Please connect your MetaMask wallet first.");
    if (!deploymentReady) throw new Error("Contracts are not deployed yet. Run npm.cmd run deploy:local first.");
  };

  const validateBorrow = () => {
    requireWallet();
    if (!isPositiveDecimal(collateralAmount)) throw new Error("Collateral amount must be a valid number greater than 0.");
    if (!isPositiveDecimal(borrowAmount)) throw new Error("Borrow amount must be a valid number greater than 0.");
    if (decimalPlaces(collateralAmount) > selectedAsset.decimals) throw new Error(`${selectedAsset.name} supports up to ${selectedAsset.decimals} decimal places.`);
    if (decimalPlaces(borrowAmount) > 6) throw new Error("USDT borrow amount supports up to 6 decimal places.");
    const collateral = toNumber(collateralAmount);
    const borrow = toNumber(borrowAmount);
    const maxSpendableEth = Math.max(toNumber(ethBalance) - GAS_BUFFER_ETH, 0);
    if (selectedAsset.type === "native" && collateral > maxSpendableEth) throw new Error(`Collateral exceeds wallet ETH balance after gas buffer. Max: ${maxSpendableEth.toFixed(4)} ETH.`);
    if (selectedAsset.type === "erc20" && !selectedAsset.address) throw new Error(`${selectedAsset.name} token address is missing. Redeploy contracts first.`);
    if (selectedAsset.type === "erc20" && collateral > toNumber(selectedBalance)) throw new Error(`Collateral exceeds wallet ${selectedAsset.name} balance.`);
    if (borrow > maxBorrow) throw new Error(`Borrow amount exceeds ${selectedAsset.ltvBps / 100}% max LTV.`);
    if (borrow > toNumber(poolLiquidity)) throw new Error("Borrow amount exceeds protocol USDT liquidity.");
  };

  const validateStake = () => {
    requireWallet();
    if (!isPositiveDecimal(stakeAmount)) throw new Error("Stake amount must be a valid number greater than 0.");
    if (decimalPlaces(stakeAmount) > 6) throw new Error("USDT stake amount supports up to 6 decimal places.");
    const stake = toNumber(stakeAmount);
    if (stake > toNumber(usdtBalance)) throw new Error("Stake amount exceeds your wallet USDT balance.");
  };

  const validateLiquidity = () => {
    requireWallet();
    if (!isTreasury) throw new Error("Only the treasury wallet can add liquidity.");
    if (!isPositiveDecimal(liquidityAmount)) throw new Error("Liquidity amount must be a valid number greater than 0.");
    if (decimalPlaces(liquidityAmount) > 6) throw new Error("USDT liquidity amount supports up to 6 decimal places.");
    if (toNumber(liquidityAmount) > toNumber(usdtBalance)) throw new Error(`Liquidity amount exceeds treasury wallet USDT balance. Wallet has ${usdtBalance} USDT.`);
  };

  const validateRepay = () => {
    requireWallet();
    if (toNumber(position.borrowed) <= 0) throw new Error("You do not have an active loan to repay.");
    if (!isPositiveDecimal(repayAmount)) throw new Error("Repay amount must be a valid number greater than 0.");
    if (decimalPlaces(repayAmount) > 6) throw new Error("USDT repay amount supports up to 6 decimal places.");
    if (toNumber(repayAmount) < toNumber(position.accruedInterest)) throw new Error(`Repay amount must cover accrued interest first. Interest due: ${position.accruedInterest} USDT.`);
    if (toNumber(repayAmount) > toNumber(position.totalDebt)) throw new Error("Repay amount exceeds your total debt. Use Repay Full Loan instead.");
    if (toNumber(repayAmount) > toNumber(usdtBalance)) throw new Error("Repay amount exceeds your wallet USDT balance.");
  };

  const validateWithdrawCollateral = () => {
    requireWallet();
    if (toNumber(position.borrowed) > 0 || toNumber(position.totalDebt) > 0) throw new Error("Repay your full loan before withdrawing collateral.");
    const hasEthCollateral = toNumber(position.collateral) > 0;
    const hasTokenCollateral = Object.values(tokenCollateral).some((amount) => toNumber(amount) > 0);
    if (!hasEthCollateral && !hasTokenCollateral) throw new Error("No collateral is available to withdraw.");
  };

  const approveCollateral = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateBorrow();
      if (selectedAsset.type !== "erc20" || !selectedAsset.address) throw new Error("Selected collateral does not need approval.");
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const token = new Contract(selectedAsset.address, MOCK_USDT_ABI, signer);
      const tx = await token.approve(DEPLOYMENT.lendingPool, parseUnits(collateralAmount, selectedAsset.decimals));
      setStatus(`${selectedAsset.name} approval submitted. Waiting for confirmation...`);
      await tx.wait();
      setStatus(`${selectedAsset.name} approved for borrowing.`);
      await refreshBalances(await signer.getAddress());
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Collateral approval failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const borrow = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateBorrow();
      if (needsCollateralApproval) throw new Error(`Please approve ${selectedAsset.name} before borrowing.`);
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const borrowRaw = parseUnits(borrowAmount, 6);
      const tx = selectedAsset.type === "native"
        ? await pool.borrowWithEthCollateral(borrowRaw, { value: parseEther(collateralAmount) })
        : await pool.borrowWithTokenCollateral(assetKey(selectedAsset.id), parseUnits(collateralAmount, selectedAsset.decimals), borrowRaw);

      setStatus("Borrow transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      await fetch("/api/borrow-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: await signer.getAddress(), collateralSymbol: selectedAsset.name, collateralAmount, borrowAmount, txHash: receipt.hash })
      });
      setStatus("Borrow successful. Wallet and protocol balances refreshed.");
      await refreshBalances(await signer.getAddress());
      await refreshBorrowHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Borrow transaction failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const approveUsdt = async (amount: string) => {
    const provider = await getBrowserProvider();
    const signer = await provider.getSigner();
    const usdt = new Contract(DEPLOYMENT.mockUsdt, MOCK_USDT_ABI, signer);
    const tx = await usdt.approve(DEPLOYMENT.lendingPool, parseUnits(amount, 6));
    await tx.wait();
    await refreshBalances(await signer.getAddress());
  };

  const approveRepay = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      requireWallet();
      if (toNumber(position.borrowed) <= 0) throw new Error("You do not have an active loan to repay.");
      const approvalAmount = Math.max(toNumber(repayAmount), toNumber(position.totalDebt) + 1);
      setStatus("USDT repay approval submitted. Waiting for confirmation...");
      await approveUsdt(approvalAmount.toFixed(6));
      setStatus("USDT approved for loan repayment.");
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Repay approval failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const repayLoan = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateRepay();
      if (needsRepayApproval) throw new Error("Approve USDT before repaying this amount.");
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const interestBefore = Math.min(toNumber(repayAmount), toNumber(position.accruedInterest));
      const principalBefore = Math.max(toNumber(repayAmount) - interestBefore, 0);
      const tx = await pool.repayUsdt(parseUnits(repayAmount, 6));
      setStatus("Repay transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      await fetch("/api/repay-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: await signer.getAddress(), amount: repayAmount, interestPaid: interestBefore.toFixed(4), principalPaid: principalBefore.toFixed(4), txHash: receipt.hash }) });
      setStatus("Repayment successful. Loan balance refreshed.");
      await refreshBalances(await signer.getAddress());
      await refreshRepayHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Repay transaction failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const repayFullLoan = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      requireWallet();
      if (toNumber(position.borrowed) <= 0) throw new Error("You do not have an active loan to repay.");
      if (toNumber(position.totalDebt) > toNumber(usdtBalance)) throw new Error("Total debt exceeds your wallet USDT balance.");
      if (needsFullRepayApproval) throw new Error("Approve USDT before repaying the full loan.");
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const debtBefore = position.totalDebt;
      const interestBefore = position.accruedInterest;
      const principalBefore = position.borrowed;
      const tx = await pool.repayFullLoan();
      setStatus("Full repayment submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      await fetch("/api/repay-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: await signer.getAddress(), amount: debtBefore, interestPaid: interestBefore, principalPaid: principalBefore, txHash: receipt.hash }) });
      setStatus("Full loan repaid. You can now withdraw collateral.");
      await refreshBalances(await signer.getAddress());
      await refreshRepayHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Full repayment failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const withdrawCollateral = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateWithdrawCollateral();
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.withdrawAllCollateral();
      setStatus("Collateral withdrawal submitted. Waiting for confirmation...");
      await tx.wait();
      setStatus("Collateral withdrawn back to your wallet.");
      await refreshBalances(await signer.getAddress());
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Collateral withdrawal failed.");
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
      setStatus("USDT approval submitted. Waiting for confirmation...");
      await approveUsdt(stakeAmount);
      setStatus("USDT approved. You can now stake.");
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Approval failed.");
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
      if (needsStakeApproval) throw new Error("Please approve USDT before staking.");
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.stakeUsdt(parseUnits(stakeAmount, 6));
      setStatus("Stake transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      await fetch("/api/staking-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: await signer.getAddress(), action: "STAKE", amount: stakeAmount, rewardAmount: "0", txHash: receipt.hash }) });
      setStatus("Stake successful. Your USDT is now earning rewards.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Stake failed.");
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
      await fetch("/api/staking-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: await signer.getAddress(), action: "CLAIM", amount: "0", rewardAmount: rewardBefore, txHash: receipt.hash }) });
      setStatus("Rewards claimed successfully.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Claim failed.");
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
      if (!isPositiveDecimal(unstakeAmount)) throw new Error("Unstake amount must be a valid number greater than 0.");
      if (decimalPlaces(unstakeAmount) > 6) throw new Error("USDT unstake amount supports up to 6 decimal places.");
      if (toNumber(unstakeAmount) > toNumber(position.staked)) throw new Error("Unstake amount exceeds your staked USDT.");
      const rewardBefore = position.pendingReward;
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.unstakeUsdt(parseUnits(unstakeAmount, 6));
      setStatus("Unstake transaction submitted. Waiting for confirmation...");
      const receipt = await tx.wait();
      await fetch("/api/staking-history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ walletAddress: await signer.getAddress(), action: "UNSTAKE", amount: unstakeAmount, rewardAmount: rewardBefore, txHash: receipt.hash }) });
      setStatus("Unstake successful. Principal and rewards returned.");
      await refreshBalances(await signer.getAddress());
      await refreshStakingHistory();
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Unstake failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const approveLiquidity = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateLiquidity();
      setStatus("Liquidity approval submitted. Waiting for confirmation...");
      await approveUsdt(liquidityAmount);
      setStatus("USDT approved for liquidity funding.");
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Liquidity approval failed.");
    } finally {
      setIsBusy(false);
    }
  };

  const addLiquidity = async () => {
    try {
      setError("");
      setStatus("");
      setIsBusy(true);
      validateLiquidity();
      if (toNumber(liquidityAmount) > toNumber(usdtAllowance)) throw new Error("Approve USDT before adding liquidity.");
      const provider = await getBrowserProvider();
      const signer = await provider.getSigner();
      const pool = new Contract(DEPLOYMENT.lendingPool, LENDING_POOL_ABI, signer);
      const tx = await pool.addLiquidity(parseUnits(liquidityAmount, 6));
      setStatus("Add liquidity transaction submitted. Waiting for confirmation...");
      await tx.wait();
      setStatus("Liquidity added to the protocol.");
      await refreshBalances(await signer.getAddress());
    } catch (caught) {
      showError(caught instanceof Error ? caught.message : "Add liquidity failed.");
    } finally {
      setIsBusy(false);
    }
  };

  useEffect(() => {
    refreshPrices().catch(() => undefined);
    const priceTimer = window.setInterval(() => {
      refreshPrices().catch(() => undefined);
    }, 60000);
    refreshProtocol().catch(() => undefined);
    return () => window.clearInterval(priceTimer);
  }, [refreshPrices, refreshProtocol]);

  useEffect(() => {
    if (!window.ethereum) return;
    const handleAccountsChanged = (accounts: unknown) => {
      const nextAccount = Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : "";
      setAccount(nextAccount);
      if (nextAccount) {
        refreshBalances(nextAccount).catch(() => undefined);
        refreshBorrowHistory(nextAccount).catch(() => undefined);
        refreshRepayHistory(nextAccount).catch(() => undefined);
        refreshStakingHistory(nextAccount).catch(() => undefined);
      } else {
        disconnectWallet();
      }
    };
    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    return () => window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [refreshBalances, refreshBorrowHistory, refreshRepayHistory, refreshStakingHistory]);

  useEffect(() => {
    if (!status && !error) return;

    setIsMessageClosing(false);
    window.scrollTo({ top: 0, behavior: "smooth" });

    const fadeTimer = window.setTimeout(() => {
      setIsMessageClosing(true);
    }, 4500);

    const clearTimer = window.setTimeout(() => {
      setStatus("");
      setError("");
      setIsMessageClosing(false);
    }, 5200);

    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [status, error]);

  const disconnectWallet = () => {
    setAccount("");
    setEthBalance("0");
    setUsdtBalance("0");
    setUsdtAllowance("0");
    setAssetBalances({});
    setAssetAllowances({});
    setTokenCollateral({});
    setBorrowHistory([]);
    setRepayHistory([]);
    setStakingHistory([]);
    setPosition({ collateral: "0", borrowed: "0", accruedInterest: "0", totalDebt: "0", staked: "0", pendingReward: "0" });
    setStatus("");
    setError("");
  };

  return (
    <main className={`${isDarkMode ? "dark bg-slate-950 text-slate-100" : "bg-slate-50 text-ink"} min-h-screen transition-colors duration-300`}>
      <header className="border-b border-line bg-white transition-colors duration-300 dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <button onClick={() => { playClickSound(); setView("home"); }} className="flex items-center gap-4 text-left transition hover:scale-[1.01]">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-night text-white"><Coins className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-semibold tracking-normal text-ink dark:text-white">CryptoLend</h1>
              <p className="text-sm text-slate-500">Decentralized Lending & Staking</p>
            </div>
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => { playClickSound(); setIsDarkMode((value) => !value); }} className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-white text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-slate-900 hover:shadow-soft active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:hover:border-slate-400" aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}>
              {isDarkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>
            {account ? (
              <div className="flex items-center gap-3 rounded-lg border border-line bg-slate-50 px-4 py-3 transition-colors dark:border-slate-700 dark:bg-slate-900">
                <span className="h-2.5 w-2.5 rounded-full bg-mint" />
                <span className="font-medium text-slate-700 dark:text-slate-200">{shortAddress(account)}</span>
                <button onClick={() => { playClickSound(); disconnectWallet(); }} className="text-rose-500 transition hover:scale-110" aria-label="Disconnect wallet"><LogOut className="h-5 w-5" /></button>
              </div>
            ) : (
              <button onClick={() => { playClickSound(); connectWallet(); }} className="inline-flex items-center gap-2 rounded-lg bg-night px-5 py-3 font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg active:scale-95 dark:bg-white dark:text-night">
                <Wallet className="h-5 w-5" /> Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>
      <section className="mx-auto max-w-7xl px-6 py-8">
        {!deploymentReady && <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Contracts are not deployed yet. Start Hardhat node and run <strong>npm.cmd run deploy:local</strong>.</div>}
        {(status || error) && <div className={`mb-6 grid gap-3 transition duration-700 ${isShaking ? "animate-shake" : ""} ${isMessageClosing ? "-translate-y-2 opacity-0" : "translate-y-0 opacity-100"}`}>{status && <Alert tone="success" text={status} />}{error && <Alert tone="error" text={error} />}</div>}
        {view === "home" && <HomeView account={account} portfolioValue={portfolioValue} position={position} poolLiquidity={poolLiquidity} totalStaked={totalStaked} onLending={() => setView("lending")} onStaking={() => setView("staking")} />}
        {view === "lending" && (
          <LendingView
            account={account}
            assets={visibleAssets}
            selectedAsset={selectedAsset}
            selectedBalance={selectedBalance}
            selectedAllowance={selectedAllowance}
            selectedLivePrice={selectedLivePrice}
            selectedDemoPrice={selectedDemoPrice}
            priceSource={priceSource}
            prices={prices}
            assetSearch={assetSearch}
            setAssetSearch={setAssetSearch}
            setSelectedAssetId={setSelectedAssetId}
            collateralAmount={collateralAmount}
            setCollateralAmount={setCollateralAmount}
            borrowAmount={borrowAmount}
            setBorrowAmount={setBorrowAmount}
            collateralValue={collateralValue}
            liveCollateralValue={liveCollateralValue}
            maxBorrow={maxBorrow}
            healthFactor={healthFactor}
            poolLiquidity={poolLiquidity}
            poolCollateral={poolCollateral}
            protocolStatus={protocolStatus}
            totalBorrowed={totalBorrowed}
            totalStaked={totalStaked}
            position={position}
            tokenCollateral={tokenCollateral}
            borrowHistory={account ? borrowHistory : []}
            repayHistory={account ? repayHistory : []}
            isBusy={isBusy}
            needsCollateralApproval={needsCollateralApproval}
            repayAmount={repayAmount}
            setRepayAmount={setRepayAmount}
            needsRepayApproval={needsRepayApproval}
            needsFullRepayApproval={needsFullRepayApproval}
            onBack={() => setView("home")}
            onApproveCollateral={approveCollateral}
            onBorrow={borrow}
            onApproveRepay={approveRepay}
            onRepay={repayLoan}
            onRepayFull={repayFullLoan}
            onWithdrawCollateral={withdrawCollateral}
            isTreasury={Boolean(isTreasury)}
            liquidityAmount={liquidityAmount}
            setLiquidityAmount={setLiquidityAmount}
            usdtAllowance={usdtAllowance}
            onApproveLiquidity={approveLiquidity}
            onAddLiquidity={addLiquidity}
          />
        )}
        {view === "staking" && <StakingView account={account} usdtBalance={usdtBalance} allowance={usdtAllowance} stakeAmount={stakeAmount} setStakeAmount={setStakeAmount} unstakeAmount={unstakeAmount} setUnstakeAmount={setUnstakeAmount} position={position} poolLiquidity={poolLiquidity} totalStaked={totalStaked} dailyReward={dailyReward} yearlyReward={yearlyReward} needsApproval={needsStakeApproval} stakingHistory={account ? stakingHistory : []} isBusy={isBusy} onBack={() => setView("home")} onApprove={approveStake} onStake={stake} onClaim={claimRewards} onUnstake={unstake} />}
      </section>
    </main>
  );
}

function HomeView({ account, portfolioValue, position, poolLiquidity, totalStaked, onLending, onStaking }: { account: string; portfolioValue: number; position: { borrowed: string; staked: string; pendingReward: string }; poolLiquidity: string; totalStaked: string; onLending: () => void; onStaking: () => void }) {
  return <div className="py-8"><div className="mb-10 text-center"><h2 className="text-3xl font-semibold text-ink dark:text-white">Choose Your DeFi Strategy</h2><p className="mx-auto mt-4 max-w-3xl text-lg leading-8 text-slate-500 dark:text-slate-400">Select lending to borrow USDT against your crypto, or staking to earn rewards by supplying USDT liquidity.</p></div><div className="mx-auto grid max-w-5xl gap-7 md:grid-cols-2"><StrategyCard icon={<DollarSign className="h-9 w-9 text-blue-600" />} title="Lending" description="Use ETH, BTC, or Solana as collateral to borrow USDT instantly." rows={[["Interest Rate", "4%"], ["Max LTV", "Up to 70%"], ["Available Liquidity", `${poolLiquidity} USDT`]]} onClick={onLending} /><StrategyCard icon={<TrendingUp className="h-9 w-9 text-violet-600" />} title="Staking" description="Stake USDT into the protocol liquidity pool and claim demo rewards." rows={[["APY", "12%"], ["Rewards", "Claimable"], ["Total Staked", `${totalStaked} USDT`]]} onClick={onStaking} /></div><section className="mx-auto mt-8 max-w-5xl rounded-lg border border-violet-200 bg-violet-50 p-6 transition-colors dark:border-violet-900 dark:bg-slate-900"><div className="mb-5 flex items-center gap-4"><div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white dark:bg-slate-800"><Wallet className="h-7 w-7 text-ink dark:text-white" /></div><div><h3 className="text-xl font-semibold text-ink dark:text-white">Your Portfolio Overview</h3><p className="text-slate-500 dark:text-slate-400">{account ? "Connected wallet positions are shown below." : "Connect your wallet to load your positions."}</p></div></div><div className="grid gap-4 sm:grid-cols-4"><SummaryMetric label="Total Balance" value={`$${portfolioValue.toFixed(2)}`} /><SummaryMetric label="Borrowed" value={`${position.borrowed} USDT`} /><SummaryMetric label="Staked" value={`${position.staked} USDT`} /><SummaryMetric label="Pending Rewards" value={`${position.pendingReward} USDT`} /></div></section></div>;
}

function LendingView(props: {
  account: string; assets: Asset[]; selectedAsset: Asset; selectedBalance: string; selectedAllowance: string; selectedLivePrice: number; selectedDemoPrice: number; priceSource: string; prices: Record<string, number>; assetSearch: string; setAssetSearch: (v: string) => void; setSelectedAssetId: (v: string) => void; collateralAmount: string; setCollateralAmount: (v: string) => void; borrowAmount: string; setBorrowAmount: (v: string) => void; collateralValue: number; liveCollateralValue: number; maxBorrow: number; healthFactor: number; poolLiquidity: string; poolCollateral: string; protocolStatus: string; totalBorrowed: string; totalStaked: string; position: { collateral: string; borrowed: string; accruedInterest: string; totalDebt: string }; tokenCollateral: Record<string, string>; borrowHistory: BorrowHistory[]; repayHistory: RepayHistory[]; isBusy: boolean; needsCollateralApproval: boolean; repayAmount: string; setRepayAmount: (v: string) => void; needsRepayApproval: boolean; needsFullRepayApproval: boolean; onBack: () => void; onApproveCollateral: () => void; onBorrow: () => void; onApproveRepay: () => void; onRepay: () => void; onRepayFull: () => void; onWithdrawCollateral: () => void; isTreasury: boolean; liquidityAmount: string; setLiquidityAmount: (v: string) => void; usdtAllowance: string; onApproveLiquidity: () => void; onAddLiquidity: () => void;
}) {
  return (
    <div>
      <PageTitle onBack={props.onBack} title="Borrow USDT" subtitle="Use ETH, BTC, or Solana as collateral to borrow USDT." />
      <div className="grid gap-7 lg:grid-cols-[1fr_420px]">
        <div className="space-y-7">
          <Panel title="Select Collateral">
            <label className="mb-5 flex items-center gap-3 rounded-lg border border-line bg-slate-50 px-4 py-3 transition focus-within:border-slate-900 focus-within:ring-4 focus-within:ring-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:focus-within:border-slate-400 dark:focus-within:ring-slate-700">
              <Search className="h-5 w-5 text-slate-400" />
              <input value={props.assetSearch} onChange={(event) => props.setAssetSearch(event.target.value)} placeholder="Search ETH, BTC, or Solana" className="w-full bg-transparent text-ink outline-none placeholder:text-slate-400 dark:text-white" />
            </label>
            <div className="grid gap-4 md:grid-cols-3">
              {props.assets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-slate-500 md:col-span-3 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  {props.account ? "No matching supported collateral with positive balance was found." : "Connect wallet to load supported collateral."}
                </div>
              ) : props.assets.map((asset) => (
                <button key={asset.id} onClick={() => { playClickSound(); props.setSelectedAssetId(asset.id); }} className={`rounded-lg border p-5 text-left transition duration-200 hover:-translate-y-0.5 hover:shadow-soft active:scale-[0.99] ${asset.id === props.selectedAsset.id ? "border-slate-900 bg-slate-50 dark:border-slate-300 dark:bg-slate-800" : "border-line bg-white dark:border-slate-800 dark:bg-slate-900"}`}>
                  <div className="mb-4 flex items-center justify-between"><strong className="text-ink dark:text-white">{asset.name}</strong><Shield className="h-5 w-5 text-slate-500" /></div>
                  <Metric label="Live Price" value={`$${(props.prices[asset.coingeckoId] ?? Number(asset.fallbackPrice)).toLocaleString()}`} />
                  <Metric label="Wallet" value={`${asset.id === props.selectedAsset.id ? props.selectedBalance : ""} ${asset.symbol}`} />
                  <Metric label="Max LTV" value={`${asset.ltvBps / 100}%`} positive />
                </button>
              ))}
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Price source: {props.priceSource === "coingecko" ? "CoinGecko live API" : "demo fallback prices"}. Contract validation uses demo prices for stable local-chain transactions.</p>
          </Panel>

          <Panel title="Collateral Details">
            <Input label={`Collateral Amount (${props.selectedAsset.name})`} value={props.collateralAmount} onChange={props.setCollateralAmount} />
            <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">Live value approx. ${props.liveCollateralValue.toFixed(2)}. Contract demo value ${props.collateralValue.toFixed(2)}.</p>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-slate-800">
              <div className="grid gap-5 sm:grid-cols-2">
                <SummaryMetric label="Contract Value" value={`$${props.collateralValue.toFixed(2)}`} />
                <SummaryMetric label={`Max Loan (LTV ${props.selectedAsset.ltvBps / 100}%)`} value={`${props.maxBorrow.toFixed(2)} USDT`} positive />
              </div>
            </div>
          </Panel>

          <History title="Borrow History" rows={props.borrowHistory.map((item) => ({ id: item.id, title: `${item.collateralSymbol || "ETH"} - ${shortAddress(item.walletAddress)}`, detail: `Collateral ${item.collateralAmount} ${item.collateralSymbol || "ETH"} - Borrowed ${item.borrowAmount} USDT`, txHash: item.txHash, createdAt: item.createdAt }))} />
          <History title="Repay History" rows={props.repayHistory.map((item) => ({ id: item.id, title: `Repay - ${shortAddress(item.walletAddress)}`, detail: `Paid ${item.amount} USDT - Interest ${item.interestPaid} USDT - Principal ${item.principalPaid} USDT`, txHash: item.txHash, createdAt: item.createdAt }))} />
        </div>

        <aside className="h-fit space-y-5">
          <Panel title="Loan Details">
            <Input label="Loan Amount (USDT)" value={props.borrowAmount} onChange={props.setBorrowAmount} />
            <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">Max: {props.maxBorrow.toFixed(2)} USDT</p>
            <div className="space-y-3">
              <Metric label="Interest Rate" value="4% APY" />
              <Metric label="Health Factor" value={props.healthFactor ? props.healthFactor.toFixed(2) : "-"} positive={props.healthFactor >= 1} />
              <Metric label="Pool Liquidity" value={`${props.poolLiquidity} USDT`} />
              <Metric label="Your Borrowed" value={`${props.position.borrowed} USDT`} />
              <Metric label="Accrued Interest" value={`${props.position.accruedInterest} USDT`} />
              <Metric label="Total Debt" value={`${props.position.totalDebt} USDT`} />
              <Metric label="ETH Collateral" value={`${props.position.collateral} ETH`} />
              <Metric label={`${props.selectedAsset.name} Collateral`} value={`${props.tokenCollateral[props.selectedAsset.id] || "0"} ${props.selectedAsset.symbol}`} />
            </div>
            {props.needsCollateralApproval && <PrimaryButton disabled={!props.account || props.isBusy} onClick={props.onApproveCollateral} busy={props.isBusy}>Approve {props.selectedAsset.name}</PrimaryButton>}
            <PrimaryButton disabled={!props.account || props.isBusy || props.needsCollateralApproval} onClick={props.onBorrow} busy={props.isBusy}>Borrow USDT</PrimaryButton>
          </Panel>

          <Panel title="Manage Loan">
            <Input label="Repay Amount (USDT)" value={props.repayAmount} onChange={props.setRepayAmount} />
            <div className="space-y-3">
              <Metric label="USDT Allowance" value={`${props.usdtAllowance} USDT`} />
              <Metric label="Interest Due First" value={`${props.position.accruedInterest} USDT`} />
              <Metric label="Total Debt" value={`${props.position.totalDebt} USDT`} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.borrowed) <= 0 || (!props.needsRepayApproval && !props.needsFullRepayApproval)} onClick={props.onApproveRepay} busy={props.isBusy}>Approve Repay</PrimaryButton>
              <PrimaryButton disabled={!props.account || props.isBusy || props.needsRepayApproval || toNumber(props.position.borrowed) <= 0} onClick={props.onRepay} busy={props.isBusy}>Repay Amount</PrimaryButton>
            </div>
            <PrimaryButton disabled={!props.account || props.isBusy || props.needsFullRepayApproval || toNumber(props.position.borrowed) <= 0} onClick={props.onRepayFull} busy={props.isBusy}>Repay Full Loan</PrimaryButton>
            <PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.borrowed) > 0} onClick={props.onWithdrawCollateral} busy={props.isBusy}>Withdraw Collateral</PrimaryButton>
          </Panel>

          {props.isTreasury && <Panel title="Company Liquidity"><Input label="Add USDT Liquidity" value={props.liquidityAmount} onChange={props.setLiquidityAmount} /><Metric label="Current USDT Allowance" value={`${props.usdtAllowance} USDT`} /><div className="grid gap-3 sm:grid-cols-2"><PrimaryButton disabled={props.isBusy} onClick={props.onApproveLiquidity} busy={props.isBusy}>Approve USDT</PrimaryButton><PrimaryButton disabled={props.isBusy} onClick={props.onAddLiquidity} busy={props.isBusy}>Add Liquidity</PrimaryButton></div></Panel>}
          <ProtocolPanel protocolStatus={props.protocolStatus} poolCollateral={props.poolCollateral} poolLiquidity={props.poolLiquidity} totalBorrowed={props.totalBorrowed} totalStaked={props.totalStaked} />
        </aside>
      </div>
    </div>
  );
}

function StakingView(props: { account: string; usdtBalance: string; allowance: string; stakeAmount: string; setStakeAmount: (value: string) => void; unstakeAmount: string; setUnstakeAmount: (value: string) => void; position: { staked: string; pendingReward: string }; poolLiquidity: string; totalStaked: string; dailyReward: number; yearlyReward: number; needsApproval: boolean; stakingHistory: StakingHistory[]; isBusy: boolean; onBack: () => void; onApprove: () => void; onStake: () => void; onClaim: () => void; onUnstake: () => void }) {
  return <div><PageTitle onBack={props.onBack} title="Stake USDT" subtitle="Supply liquidity to the protocol and claim demo rewards." /><div className="grid gap-7 lg:grid-cols-[1fr_420px]"><div className="space-y-7"><Panel title="Investor Staking"><div className="mb-5 grid gap-4 md:grid-cols-3"><SummaryMetric label="Wallet USDT" value={`${props.usdtBalance} USDT`} /><SummaryMetric label="Staked USDT" value={`${props.position.staked} USDT`} /><SummaryMetric label="Pending Reward" value={`${props.position.pendingReward} USDT`} positive /></div><Input label="Stake Amount (USDT)" value={props.stakeAmount} onChange={props.setStakeAmount} /><div className="mb-5 rounded-lg border border-violet-200 bg-violet-50 p-5 transition-colors dark:border-slate-700 dark:bg-slate-800"><div className="grid gap-5 sm:grid-cols-3"><SummaryMetric label="APY" value="12%" positive /><SummaryMetric label="Est. Daily Reward" value={`${props.dailyReward.toFixed(4)} USDT`} /><SummaryMetric label="Est. Yearly Reward" value={`${props.yearlyReward.toFixed(2)} USDT`} /></div></div><div className="grid gap-3 sm:grid-cols-2"><PrimaryButton disabled={!props.account || props.isBusy || !props.needsApproval} onClick={props.onApprove} busy={props.isBusy && props.needsApproval}>Approve USDT</PrimaryButton><PrimaryButton disabled={!props.account || props.isBusy || props.needsApproval} onClick={props.onStake} busy={props.isBusy && !props.needsApproval}>Stake USDT</PrimaryButton></div><p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Current allowance: {props.allowance} USDT</p></Panel><Panel title="Manage Staked Assets"><Input label="Unstake Amount (USDT)" value={props.unstakeAmount} onChange={props.setUnstakeAmount} /><div className="grid gap-3 sm:grid-cols-2"><PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.pendingReward) <= 0} onClick={props.onClaim} busy={props.isBusy}>Claim Rewards</PrimaryButton><PrimaryButton disabled={!props.account || props.isBusy || toNumber(props.position.staked) <= 0} onClick={props.onUnstake} busy={props.isBusy}>Unstake</PrimaryButton></div></Panel><History title="Staking History" rows={props.stakingHistory.map((item) => ({ id: item.id, title: `${item.action} - ${shortAddress(item.walletAddress)}`, detail: `Amount ${item.amount} USDT - Reward ${item.rewardAmount} USDT`, txHash: item.txHash, createdAt: item.createdAt }))} /></div><aside className="h-fit"><Panel title="Staking Pool"><div className="space-y-3"><Metric label="APY" value="12%" positive /><Metric label="Total Staked" value={`${props.totalStaked} USDT`} /><Metric label="Pool Liquidity" value={`${props.poolLiquidity} USDT`} /><Metric label="Your Stake" value={`${props.position.staked} USDT`} /><Metric label="Pending Reward" value={`${props.position.pendingReward} USDT`} positive /></div></Panel></aside></div></div>;
}

function StrategyCard({ icon, title, description, rows, onClick }: { icon: React.ReactNode; title: string; description: string; rows: string[][]; onClick: () => void }) { return <button onClick={() => { playClickSound(); onClick(); }} className="rounded-lg border border-line bg-white p-7 text-left shadow-soft transition duration-200 hover:-translate-y-1 hover:border-slate-900 hover:shadow-xl active:scale-[0.99] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-400"><div className="mb-10 flex items-start justify-between"><div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">{icon}</div><ArrowRight className="h-6 w-6 text-slate-500" /></div><h3 className="mb-4 text-2xl font-semibold text-ink dark:text-white">{title}</h3><p className="mb-6 leading-7 text-slate-500 dark:text-slate-400">{description}</p><div className="space-y-3">{rows.map(([label, value]) => <Metric key={label} label={label} value={value} positive={value.includes("%") || value.includes("Claimable")} />)}</div></button>; }
function PageTitle({ onBack, title, subtitle }: { onBack: () => void; title: string; subtitle: string }) { return <div className="mb-7 flex items-center gap-4"><button onClick={() => { playClickSound(); onBack(); }} aria-label="Back to strategy page" className="rounded-lg p-2 transition hover:bg-slate-100 active:scale-95 dark:hover:bg-slate-800"><ArrowLeft className="h-6 w-6 text-ink dark:text-white" /></button><div><h2 className="text-2xl font-semibold text-ink dark:text-white">{title}</h2><p className="text-slate-500 dark:text-slate-400">{subtitle}</p></div></div>; }
function ProtocolPanel({ protocolStatus, poolCollateral, poolLiquidity, totalBorrowed, totalStaked }: { protocolStatus: string; poolCollateral: string; poolLiquidity: string; totalBorrowed: string; totalStaked: string }) { return <Panel title="Protocol Dashboard"><p className="mb-4 text-sm text-slate-500">{protocolStatus}</p><div className="space-y-3"><Metric label="Pool ETH Collateral" value={`${poolCollateral} ETH`} /><Metric label="Pool USDT Liquidity" value={`${poolLiquidity} USDT`} /><Metric label="Total Borrowed" value={`${totalBorrowed} USDT`} /><Metric label="Total Staked" value={`${totalStaked} USDT`} /><Metric label="Available Liquidity" value={`${poolLiquidity} USDT`} /></div><div className="mt-4 space-y-3 text-sm"><AddressLine label="LendingPool" value={DEPLOYMENT.lendingPool || "Not deployed"} /><AddressLine label="USDT" value={DEPLOYMENT.mockUsdt || "Not deployed"} /></div></Panel>; }
function History({ title, rows }: { title: string; rows: Array<{ id: number; title: string; detail: string; txHash: string; createdAt: string }> }) { return <Panel title={title} icon={<Database className="h-5 w-5 text-slate-700 dark:text-slate-300" />}><div className="space-y-3">{rows.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">No records yet.</p> : rows.map((item) => <div key={item.id} className="rounded-lg border border-line bg-slate-50 p-4 text-sm transition hover:-translate-y-0.5 hover:shadow-soft dark:border-slate-800 dark:bg-slate-800"><div className="mb-2 flex items-center justify-between gap-3"><span className="font-medium text-ink dark:text-white">{item.title}</span><span className="text-slate-500 dark:text-slate-400">{new Date(item.createdAt).toLocaleString()}</span></div><p className="text-slate-600 dark:text-slate-300">{item.detail}</p><p className="mt-1 truncate text-slate-400">Tx: {item.txHash}</p></div>)}</div></Panel>; }
function Panel({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) { return <section className="rounded-lg border border-line bg-white p-6 shadow-soft transition-colors duration-300 dark:border-slate-800 dark:bg-slate-900"><div className="mb-5 flex items-center gap-3">{icon}<h3 className="text-lg font-semibold text-ink dark:text-white">{title}</h3></div>{children}</section>; }
function Input({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="mb-3 block"><span className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-line bg-slate-50 px-4 py-4 text-lg text-ink outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-700" inputMode="decimal" /></label>; }
function PrimaryButton({ children, disabled, busy, onClick }: { children: React.ReactNode; disabled: boolean; busy?: boolean; onClick: () => void }) { return <button onClick={() => { if (!disabled) playClickSound(); onClick(); }} disabled={disabled} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg bg-night px-5 py-4 font-semibold text-white transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:hover:translate-y-0 disabled:hover:shadow-none dark:bg-white dark:text-night dark:disabled:bg-slate-700 dark:disabled:text-slate-400">{busy && <Loader2 className="h-5 w-5 animate-spin" />}{children}</button>; }
function Metric({ label, value, positive }: { label: string; value: string; positive?: boolean }) { return <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-4 transition-colors dark:bg-slate-800"><span className="text-slate-500 dark:text-slate-400">{label}</span><span className={positive ? "font-semibold text-mint" : "font-semibold text-ink dark:text-white"}>{value}</span></div>; }
function SummaryMetric({ label, value, positive }: { label: string; value: string; positive?: boolean }) { return <div><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className={positive ? "text-2xl font-semibold text-mint" : "text-2xl font-semibold text-ink dark:text-white"}>{value}</p></div>; }
function AddressLine({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-line bg-white px-3 py-3 dark:border-slate-800 dark:bg-slate-800"><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p><p className="break-all font-mono text-xs text-slate-700 dark:text-slate-300">{value}</p></div>; }
function Alert({ tone, text }: { tone: "success" | "error"; text: string }) { const isSuccess = tone === "success"; return <div className={`flex items-center gap-2 rounded-lg border p-4 text-sm shadow-sm ${isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200"}`}><CheckCircle2 className="h-5 w-5" />{text}</div>; }
