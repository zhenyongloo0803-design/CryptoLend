// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Token {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract LendingPool {
    struct CollateralAsset {
        address token;
        uint8 decimals;
        uint256 priceUsdt;
        uint256 ltvBps;
        bool enabled;
    }

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
    bytes32 public constant ETH_ASSET = keccak256("ETH");
    mapping(address => LoanPosition) public positions;
    mapping(bytes32 => CollateralAsset) public collateralAssets;
    bytes32[] public collateralAssetIds;
    mapping(address => mapping(bytes32 => uint256)) public tokenCollateral;
    mapping(bytes32 => uint256) public totalTokenCollateral;
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
    event CollateralAssetConfigured(bytes32 indexed assetId, address token, uint8 decimals, uint256 priceUsdt, uint256 ltvBps);
    event TokenBorrowed(address indexed borrower, bytes32 indexed assetId, uint256 collateralAmount, uint256 borrowAmountUsdt, uint256 collateralValueUsdt, uint256 maxBorrowUsdt);
    event Staked(address indexed investor, uint256 amountUsdt);
    event Unstaked(address indexed investor, uint256 amountUsdt);
    event RewardClaimed(address indexed investor, uint256 rewardUsdt);
    event Repaid(address indexed borrower, uint256 amountUsdt, uint256 interestPaidUsdt, uint256 principalPaidUsdt);
    event CollateralWithdrawn(address indexed borrower, uint256 ethCollateralWei);

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    modifier onlyTreasury() {
        require(msg.sender == treasury, "Not treasury");
        _;
    }

    constructor(address mockUsdtAddress) {
        require(mockUsdtAddress != address(0), "Invalid USDT");
        mockUsdt = IERC20Token(mockUsdtAddress);
        treasury = msg.sender;
    }

    function configureCollateralAsset(
        bytes32 assetId,
        address token,
        uint8 decimals_,
        uint256 priceUsdt,
        uint256 ltvBps
    ) external onlyTreasury {
        require(assetId != bytes32(0), "Invalid asset");
        require(token != address(0), "Invalid token");
        require(priceUsdt > 0, "Invalid price");
        require(ltvBps > 0 && ltvBps <= BPS_DENOMINATOR, "Invalid LTV");

        if (!collateralAssets[assetId].enabled) {
            collateralAssetIds.push(assetId);
        }

        collateralAssets[assetId] = CollateralAsset({
            token: token,
            decimals: decimals_,
            priceUsdt: priceUsdt,
            ltvBps: ltvBps,
            enabled: true
        });

        emit CollateralAssetConfigured(assetId, token, decimals_, priceUsdt, ltvBps);
    }

    function addLiquidity(uint256 usdtAmount) external onlyTreasury nonReentrant {
        require(usdtAmount > 0, "Liquidity required");
        require(mockUsdt.transferFrom(msg.sender, address(this), usdtAmount), "Liquidity transfer failed");
        emit LiquidityFunded(msg.sender, usdtAmount);
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

    function borrowWithTokenCollateral(
        bytes32 assetId,
        uint256 collateralAmount,
        uint256 borrowAmountUsdt
    ) external nonReentrant {
        CollateralAsset memory asset = collateralAssets[assetId];
        require(asset.enabled, "Unsupported collateral");
        require(collateralAmount > 0, "Collateral required");
        require(borrowAmountUsdt > 0, "Borrow amount required");

        uint256 collateralValue = getTokenCollateralValueUsdt(assetId, collateralAmount);
        uint256 maxBorrow = (collateralValue * asset.ltvBps) / BPS_DENOMINATOR;

        require(borrowAmountUsdt <= maxBorrow, "Exceeds max LTV");
        require(mockUsdt.balanceOf(address(this)) >= borrowAmountUsdt, "Pool liquidity low");
        require(IERC20Token(asset.token).transferFrom(msg.sender, address(this), collateralAmount), "Collateral transfer failed");
        require(mockUsdt.transfer(msg.sender, borrowAmountUsdt), "USDT transfer failed");

        tokenCollateral[msg.sender][assetId] += collateralAmount;
        totalTokenCollateral[assetId] += collateralAmount;
        positions[msg.sender].borrowedUsdt += borrowAmountUsdt;
        positions[msg.sender].updatedAt = block.timestamp;
        totalBorrowedUsdt += borrowAmountUsdt;

        emit TokenBorrowed(msg.sender, assetId, collateralAmount, borrowAmountUsdt, collateralValue, maxBorrow);
    }

    function repayUsdt(uint256 amountUsdt) external nonReentrant {
        require(amountUsdt > 0, "Repay amount required");

        LoanPosition storage position = positions[msg.sender];
        require(position.borrowedUsdt > 0, "No active loan");

        uint256 interest = getAccruedInterestUsdt(msg.sender);
        uint256 totalDebt = position.borrowedUsdt + interest;
        require(amountUsdt <= totalDebt, "Repay exceeds debt");
        require(amountUsdt >= interest, "Repay interest first");
        require(mockUsdt.transferFrom(msg.sender, address(this), amountUsdt), "Repay transfer failed");

        uint256 interestPaid = amountUsdt > interest ? interest : amountUsdt;
        uint256 principalPaid = amountUsdt - interestPaid;

        if (principalPaid > 0) {
            position.borrowedUsdt -= principalPaid;
            totalBorrowedUsdt -= principalPaid;
        }

        position.updatedAt = block.timestamp;

        emit Repaid(msg.sender, amountUsdt, interestPaid, principalPaid);
    }

    function repayFullLoan() external nonReentrant {
        LoanPosition storage position = positions[msg.sender];
        require(position.borrowedUsdt > 0, "No active loan");

        uint256 interest = getAccruedInterestUsdt(msg.sender);
        uint256 principal = position.borrowedUsdt;
        uint256 totalDebt = principal + interest;

        require(mockUsdt.transferFrom(msg.sender, address(this), totalDebt), "Repay transfer failed");

        position.borrowedUsdt = 0;
        position.updatedAt = block.timestamp;
        totalBorrowedUsdt -= principal;

        emit Repaid(msg.sender, totalDebt, interest, principal);
    }

    function withdrawAllCollateral() external nonReentrant {
        LoanPosition storage position = positions[msg.sender];
        require(position.borrowedUsdt == 0, "Repay loan first");

        uint256 ethCollateral = position.collateralWei;
        position.collateralWei = 0;
        position.updatedAt = block.timestamp;

        if (ethCollateral > 0) {
            (bool sent, ) = msg.sender.call{value: ethCollateral}("");
            require(sent, "ETH withdraw failed");
        }

        for (uint256 i = 0; i < collateralAssetIds.length; i++) {
            bytes32 assetId = collateralAssetIds[i];
            uint256 amount = tokenCollateral[msg.sender][assetId];
            if (amount == 0) continue;

            CollateralAsset memory asset = collateralAssets[assetId];
            tokenCollateral[msg.sender][assetId] = 0;
            totalTokenCollateral[assetId] -= amount;
            require(IERC20Token(asset.token).transfer(msg.sender, amount), "Token withdraw failed");
        }

        emit CollateralWithdrawn(msg.sender, ethCollateral);
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

    function getAccruedInterestUsdt(address borrower) public view returns (uint256) {
        LoanPosition memory position = positions[borrower];
        if (position.borrowedUsdt == 0 || position.updatedAt == 0) {
            return 0;
        }

        uint256 elapsed = block.timestamp - position.updatedAt;
        return (position.borrowedUsdt * INTEREST_BPS * elapsed) / (BPS_DENOMINATOR * YEAR_SECONDS);
    }

    function getTotalDebtUsdt(address borrower) public view returns (uint256) {
        LoanPosition memory position = positions[borrower];
        return position.borrowedUsdt + getAccruedInterestUsdt(borrower);
    }

    function getCollateralValueUsdt(uint256 collateralWei) public pure returns (uint256) {
        return (collateralWei * PRICE_USDT_PER_ETH * USDT_DECIMALS) / ETH_DECIMALS;
    }

    function getMaxBorrowUsdt(uint256 collateralWei) public pure returns (uint256) {
        return (getCollateralValueUsdt(collateralWei) * MAX_LTV_BPS) / BPS_DENOMINATOR;
    }

    function getTokenCollateralValueUsdt(bytes32 assetId, uint256 collateralAmount) public view returns (uint256) {
        CollateralAsset memory asset = collateralAssets[assetId];
        require(asset.enabled, "Unsupported collateral");
        return (collateralAmount * asset.priceUsdt) / (10 ** asset.decimals);
    }

    function getTokenMaxBorrowUsdt(bytes32 assetId, uint256 collateralAmount) public view returns (uint256) {
        CollateralAsset memory asset = collateralAssets[assetId];
        require(asset.enabled, "Unsupported collateral");
        return (getTokenCollateralValueUsdt(assetId, collateralAmount) * asset.ltvBps) / BPS_DENOMINATOR;
    }

    function getPoolLiquidityUsdt() external view returns (uint256) {
        return mockUsdt.balanceOf(address(this));
    }

    function getAvailableLiquidityUsdt() external view returns (uint256) {
        return mockUsdt.balanceOf(address(this));
    }

    receive() external payable {}
}
