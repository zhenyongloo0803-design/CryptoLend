# CryptoLend Borrow MVP

CryptoLend is a blockchain lending demo for the CT124-3-3-BCD assignment. It uses Next.js for the frontend, Prisma + SQLite for local database history, Hardhat for the local blockchain, and Solidity smart contracts for MockUSDT lending.

## Features

- Connect MetaMask wallet.
- Show SepoliaETH collateral only when the connected wallet has ETH balance.
- Calculate collateral value using `1 SepoliaETH = 100 MockUSDT`.
- Apply `70%` max LTV before allowing borrow.
- Borrow MockUSDT by sending ETH collateral to the LendingPool contract.
- Stake MockUSDT into the protocol and claim demo staking rewards.
- Unstake MockUSDT principal back to the investor wallet.
- Store successful borrow records in a local SQLite database.
- Store staking, unstaking, and reward claim records in a local SQLite database.

## Demo Account Flow

- Account 1 is the deployer, treasury, and initial liquidity provider.
- Account 2 can be the borrower or staking investor.
- The pool is funded with MockUSDT during deployment.
- When Account 2 borrows, ETH moves from Account 2 to the LendingPool contract and MockUSDT moves from the LendingPool contract to Account 2.
- When Account 2 stakes, MockUSDT moves from Account 2 to the LendingPool contract and rewards can later be claimed from the pool reserve.

## Setup

Install dependencies:

```bash
npm install
```

Create local environment:

```bash
copy .env.example .env
```

Prepare SQLite database:

```bash
npm run db:push
```

Compile and test contracts:

```bash
npm run hardhat:compile
npm run hardhat:test
```

Start a local Hardhat blockchain:

```bash
npm run hardhat:node
```

In another terminal, deploy contracts:

```bash
npm run deploy:local
```

Start the frontend:

```bash
npm run dev
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

Import the private key for Account 2 from the `npm run hardhat:node` terminal output. Use Account 2 as the borrower wallet.

After deployment, import MockUSDT into MetaMask before the demo:

- Token contract address: copy `mockUsdt` from `src/lib/deployment.json`
- Symbol: `mUSDT`
- Decimals: `6`

This simulates a real user wallet that already displays ETH and USDT before using the lending platform.

Demo borrower accounts receive `10000 mUSDT` during deployment so the wallet looks pre-funded before borrowing.
The LendingPool contract is also pre-funded with `1000 ETH` and `1000 mUSDT` during deployment for demonstration liquidity.

## Important Smart Contract Constants

- `PRICE_USDT_PER_ETH = 100`
- `MAX_LTV_BPS = 7000`
- `INTEREST_BPS = 400`
- `STAKING_APY_BPS = 1200`
- `USDT_DECIMALS = 6`

Example:

- Collateral: `0.01 ETH`
- Collateral value: `1.00 MockUSDT`
- Max borrow at 70% LTV: `0.70 MockUSDT`

## Validation Rules

The frontend checks user input before sending transactions:

- collateral amount must be greater than `0`
- collateral amount cannot exceed wallet ETH balance after a gas buffer
- borrow amount must be greater than `0`
- borrow amount cannot exceed 70% LTV
- borrow amount cannot exceed pool mUSDT liquidity
- stake amount must be greater than `0`
- stake amount cannot exceed wallet mUSDT balance
- users must approve mUSDT before staking

The Solidity contract also validates LTV, liquidity, ERC20 balances, allowances, and staking balances.

## PDF Requirement Checklist

- Frontend: Next.js + React
- Local database: Prisma + SQLite for borrow and staking history
- Local blockchain: Hardhat Node
- Smart contracts: Solidity `MockUSDT` and `LendingPool`
- Frontend to smart contract connection: ethers.js + MetaMask
- Documentation: setup, features, deploy flow, MetaMask setup, demo flow

## Submission Notes

Remove `node_modules` before zipping the implementation folder. Keep source code, contracts, Prisma schema, deployment scripts, tests, and documentation.
