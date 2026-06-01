// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Token {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract LendingPool {
    struct LoanPosition {
        uint256 collateralWei;
        uint256 borrowedUsdt;
        uint256 updatedAt;
    }

    IERC20Token public immutable mockUsdt;
    address public immutable treasury;

    uint256 public constant USDT_DECIMALS = 1e6;
    uint256 public constant ETH_DECIMALS = 1e18;
    uint256 public constant PRICE_USDT_PER_ETH = 100;
    uint256 public constant MAX_LTV_BPS = 7000;
    uint256 public constant INTEREST_BPS = 400;
    uint256 public constant STAKING_APY_BPS = 1200;
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant YEAR_SECONDS = 365 days;

    bool private locked;
    mapping(address => LoanPosition) public positions;
    mapping(address => uint256) public stakedUsdt;
    mapping(address => uint256) public lastRewardAt;
    uint256 public totalBorrowedUsdt;
    uint256 public totalStakedUsdt;

    event Borrowed(
        address indexed borrower,
        uint256 collateralWei,
        uint256 borrowAmountUsdt,
        uint256 collateralValueUsdt,
        uint256 maxBorrowUsdt
    );
    event LiquidityFunded(address indexed funder, uint256 amountUsdt);
    event Staked(address indexed investor, uint256 amountUsdt);
    event Unstaked(address indexed investor, uint256 amountUsdt);
    event RewardClaimed(address indexed investor, uint256 rewardUsdt);

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address mockUsdtAddress) {
        require(mockUsdtAddress != address(0), "Invalid USDT");
        mockUsdt = IERC20Token(mockUsdtAddress);
        treasury = msg.sender;
    }

    function borrowWithEthCollateral(uint256 borrowAmountUsdt) external payable nonReentrant {
        require(msg.value > 0, "Collateral required");
        require(borrowAmountUsdt > 0, "Borrow amount required");

        uint256 collateralValue = getCollateralValueUsdt(msg.value);
        uint256 maxBorrow = getMaxBorrowUsdt(msg.value);

        require(borrowAmountUsdt <= maxBorrow, "Exceeds max LTV");
        require(mockUsdt.balanceOf(address(this)) >= borrowAmountUsdt, "Pool liquidity low");
        require(mockUsdt.transfer(msg.sender, borrowAmountUsdt), "USDT transfer failed");

        LoanPosition storage position = positions[msg.sender];
        position.collateralWei += msg.value;
        position.borrowedUsdt += borrowAmountUsdt;
        position.updatedAt = block.timestamp;
        totalBorrowedUsdt += borrowAmountUsdt;

        emit Borrowed(msg.sender, msg.value, borrowAmountUsdt, collateralValue, maxBorrow);
    }

    function stakeUsdt(uint256 amountUsdt) external nonReentrant {
        require(amountUsdt > 0, "Stake amount required");

        uint256 reward = pendingRewardUsdt(msg.sender);
        if (reward > 0) {
            require(mockUsdt.balanceOf(address(this)) >= reward, "Reward reserve low");
            require(mockUsdt.transfer(msg.sender, reward), "Reward transfer failed");
            emit RewardClaimed(msg.sender, reward);
        }

        require(mockUsdt.transferFrom(msg.sender, address(this), amountUsdt), "Stake transfer failed");
        stakedUsdt[msg.sender] += amountUsdt;
        totalStakedUsdt += amountUsdt;
        lastRewardAt[msg.sender] = block.timestamp;

        emit Staked(msg.sender, amountUsdt);
    }

    function unstakeUsdt(uint256 amountUsdt) external nonReentrant {
        require(amountUsdt > 0, "Unstake amount required");
        require(stakedUsdt[msg.sender] >= amountUsdt, "Insufficient stake");

        uint256 reward = pendingRewardUsdt(msg.sender);
        uint256 payout = amountUsdt + reward;
        require(mockUsdt.balanceOf(address(this)) >= payout, "Pool liquidity low");

        stakedUsdt[msg.sender] -= amountUsdt;
        totalStakedUsdt -= amountUsdt;
        lastRewardAt[msg.sender] = block.timestamp;

        require(mockUsdt.transfer(msg.sender, payout), "Unstake transfer failed");
        if (reward > 0) {
            emit RewardClaimed(msg.sender, reward);
        }
        emit Unstaked(msg.sender, amountUsdt);
    }

    function claimRewards() external nonReentrant {
        uint256 reward = pendingRewardUsdt(msg.sender);
        require(reward > 0, "No rewards");
        require(mockUsdt.balanceOf(address(this)) >= reward, "Reward reserve low");

        lastRewardAt[msg.sender] = block.timestamp;
        require(mockUsdt.transfer(msg.sender, reward), "Reward transfer failed");

        emit RewardClaimed(msg.sender, reward);
    }

    function pendingRewardUsdt(address investor) public view returns (uint256) {
        uint256 principal = stakedUsdt[investor];
        if (principal == 0 || lastRewardAt[investor] == 0) {
            return 0;
        }

        uint256 elapsed = block.timestamp - lastRewardAt[investor];
        return (principal * STAKING_APY_BPS * elapsed) / (BPS_DENOMINATOR * YEAR_SECONDS);
    }

    function getCollateralValueUsdt(uint256 collateralWei) public pure returns (uint256) {
        return (collateralWei * PRICE_USDT_PER_ETH * USDT_DECIMALS) / ETH_DECIMALS;
    }

    function getMaxBorrowUsdt(uint256 collateralWei) public pure returns (uint256) {
        return (getCollateralValueUsdt(collateralWei) * MAX_LTV_BPS) / BPS_DENOMINATOR;
    }

    function getPoolLiquidityUsdt() external view returns (uint256) {
        return mockUsdt.balanceOf(address(this));
    }

    function getAvailableLiquidityUsdt() external view returns (uint256) {
        return mockUsdt.balanceOf(address(this));
    }

    receive() external payable {}
}
