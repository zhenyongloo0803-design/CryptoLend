import deployment from "./deployment.json";

export const DEPLOYMENT = deployment;

export const LENDING_POOL_ABI = [
  "function borrowWithEthCollateral(uint256 borrowAmountUsdt) payable",
  "function borrowWithTokenCollateral(bytes32 assetId, uint256 collateralAmount, uint256 borrowAmountUsdt)",
  "function repayUsdt(uint256 amountUsdt)",
  "function repayFullLoan()",
  "function withdrawAllCollateral()",
  "function addLiquidity(uint256 usdtAmount)",
  "function getAccruedInterestUsdt(address borrower) view returns (uint256)",
  "function getTotalDebtUsdt(address borrower) view returns (uint256)",
  "function getCollateralValueUsdt(uint256 collateralWei) view returns (uint256)",
  "function getMaxBorrowUsdt(uint256 collateralWei) view returns (uint256)",
  "function getTokenCollateralValueUsdt(bytes32 assetId, uint256 collateralAmount) view returns (uint256)",
  "function getTokenMaxBorrowUsdt(bytes32 assetId, uint256 collateralAmount) view returns (uint256)",
  "function getPoolLiquidityUsdt() view returns (uint256)",
  "function getAvailableLiquidityUsdt() view returns (uint256)",
  "function positions(address) view returns (uint256 collateralWei, uint256 borrowedUsdt, uint256 updatedAt)",
  "function tokenCollateral(address user, bytes32 assetId) view returns (uint256)",
  "function totalTokenCollateral(bytes32 assetId) view returns (uint256)",
  "function stakedUsdt(address) view returns (uint256)",
  "function pendingRewardUsdt(address investor) view returns (uint256)",
  "function totalBorrowedUsdt() view returns (uint256)",
  "function totalStakedUsdt() view returns (uint256)",
  "function stakeUsdt(uint256 amountUsdt)",
  "function unstakeUsdt(uint256 amountUsdt)",
  "function claimRewards()",
  "function PRICE_USDT_PER_ETH() view returns (uint256)",
  "function MAX_LTV_BPS() view returns (uint256)",
  "function INTEREST_BPS() view returns (uint256)",
  "function STAKING_APY_BPS() view returns (uint256)"
] as const;

export const MOCK_USDT_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)"
] as const;

export function hasDeployment() {
  return Boolean(DEPLOYMENT.mockUsdt && DEPLOYMENT.lendingPool);
}
