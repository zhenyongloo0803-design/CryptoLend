# CryptoLend

CryptoLend is a blockchain lending and staking demo for the CT124-3-3-BCD assignment. It uses Next.js for the frontend, Prisma + SQLite for local database history, Hardhat for the local blockchain, and Solidity smart contracts for the lending/staking protocol.

## Features

- Connect MetaMask wallet.
- Strategy home page with Lending and Staking.
- Supported collateral search for `ETH`, `BTC`, and `Solana`.
- Show supported collateral only when the connected wallet has a positive demo balance.
- Fetch live display prices from CoinGecko with demo fallback prices.
- Borrow USDT using ETH, BTC, or Solana collateral.
- Track loan principal, accrued interest, and total debt.
- Repay USDT loans and withdraw collateral after full repayment.
- Stake USDT into the protocol and claim demo rewards.
- Unstake USDT principal and rewards.
- Treasury-only Add Liquidity panel for the company wallet.
- Store borrow and staking history in SQLite.

## Demo Token Mapping

The UI displays realistic names, but the assets are local Hardhat demo assets:

- `ETH` = Hardhat local test ETH
- `USDT` = MockUSDT ERC20
- `BTC` = MockBTC ERC20
- `Solana` = MockSOL ERC20 on the EVM, not real Solana SPL

CoinGecko prices are used for frontend display. The contract uses deterministic demo prices for local-chain validation so transactions remain stable during presentation.

## Demo Account Flow

- Account 1 is the deployer, treasury, and company liquidity provider.
- Demo user accounts can borrow or stake.
- Demo users receive `10000 USDT`, `1 BTC`, and `100 Solana` during deployment.
- The LendingPool is pre-funded with ETH and USDT liquidity.
- Borrowing moves collateral from the user wallet to the LendingPool and moves USDT from the LendingPool to the user wallet.
- Borrowed USDT accrues demo interest at `4% APY`.
- Repayment moves USDT from the user wallet back to the LendingPool.
- Collateral can be withdrawn only after the loan is fully repaid.
- Staking moves USDT from the investor wallet to the LendingPool and allows rewards to be claimed later.

## Setup

```bash
npm install
copy .env.example .env
npm.cmd run db:push
npm.cmd run hardhat:compile
npm.cmd run hardhat:test
```

Start local blockchain:

```bash
npm.cmd run hardhat:node
```

Deploy contracts in another terminal:

```bash
npm.cmd run deploy:local
```

Start frontend:

```bash
npm.cmd run dev:clean
```

Open:

```text
http://localhost:3000
```

## MetaMask Configuration

Add or switch to the Hardhat local network:

- Network name: `Hardhat Local`
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

Import demo accounts from the `npm.cmd run hardhat:node` terminal output. Import demo tokens using the latest addresses in `src/lib/deployment.json`:

- `mockUsdt` as symbol `USDT`, decimals `6`
- `mockBtc` as symbol `BTC`, decimals `8`
- `mockSol` as symbol `SOL`, decimals `9`

If Hardhat node is restarted, redeploy and re-import the latest token addresses.

## Company Liquidity

Connect with the deployer account to reveal the company-only Add Liquidity panel. The treasury can approve USDT and add it into the LendingPool. Normal user wallets do not see this panel.

## Validation Rules

The frontend checks:

- collateral amount must be greater than `0`
- collateral amount cannot exceed wallet balance
- ETH collateral keeps a gas buffer
- ERC20 collateral requires approval before borrowing
- borrow amount must be greater than `0`
- borrow amount cannot exceed LTV
- borrow amount cannot exceed pool USDT liquidity
- stake amount must be greater than `0`
- stake amount cannot exceed wallet USDT balance
- USDT must be approved before staking or adding liquidity
- repay amount must cover accrued interest before reducing principal
- repay amount cannot exceed the current total debt
- collateral withdrawal is allowed only after the loan is fully repaid

The Solidity contract also validates LTV, liquidity, balances, allowances, accrued loan interest, repayment, collateral withdrawal, staking balances, and treasury-only liquidity funding.

## PDF Requirement Checklist

- Frontend: Next.js + React
- Local database: Prisma + SQLite for borrow and staking history
- Local blockchain: Hardhat Node
- Smart contracts: Solidity `MockUSDT`, `MockToken`, and `LendingPool`
- Frontend to smart contract connection: ethers.js + MetaMask
- Documentation: setup, features, deployment flow, MetaMask setup, and demo flow

## Submission Notes

Remove `node_modules` before zipping the implementation folder. Keep source code, contracts, Prisma schema, deployment scripts, tests, and documentation.
