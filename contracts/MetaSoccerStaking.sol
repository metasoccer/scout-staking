// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "./IERC721Attributes.sol";
import "./EntropyReader.sol";

contract MetaSoccerStaking is Context, Pausable, AccessControl, IERC721Receiver, ERC721Enumerable, ReentrancyGuard
{
    using SafeERC20 for IERC20;

    address public immutable nftToStake;
    address public entropyReader;
    address public rewardsPool;
    uint256 public rewardsPeriod; // Seconds until claimable rewards
    string public rewardsAttribute;
    bool public recurrentRewards = false;

    mapping(uint256 => uint256) public stakedTimestamps;
    mapping(address => mapping(string => uint256)) public rewardsByAttribute;
    address[] public rewardsTokens;

    constructor(
        address _nftToStake,
        uint256 _rewardsPeriod,
        string memory _nftName,
        string memory _nftSymbol
    ) ERC721(_nftName, _nftSymbol) {
        require(_nftToStake != address(0), "Wrong NFT to stake");
        nftToStake = _nftToStake;
        rewardsPeriod = _rewardsPeriod;
        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function supportsInterface(bytes4 _interfaceId) public view virtual override(ERC721Enumerable, AccessControl) returns (bool) {
        return super.supportsInterface(_interfaceId);
    }

    /**
     * @dev Blocked transfers.
     */
    function transferFrom(
        address from,
        address to,
        uint256 tokenId
    ) public override {
        revert("Transferring Staked NFT");
    }

    function safeTransferFrom(
        address from,
        address to,
        uint256 tokenId,
        bytes memory _data
    ) public override {
        revert("Transferring Staked NFT");
    }

    function onERC721Received(
        address operator,
        address from,
        uint256 tokenId,
        bytes calldata
    ) external whenNotPaused nonReentrant returns (bytes4) {
        require(nftToStake == _msgSender(), "Invalid NFT");
        // Sanity check
        require(IERC721(nftToStake).ownerOf(tokenId) == address(this), "Contract must own staked token");
        if (!recurrentRewards) {
            require(!hasStaked(tokenId), "Already staked");
        }
        _stake(from, tokenId);
        return this.onERC721Received.selector;
    }

    function isRewardTime(uint256 _tokenId) public view returns(bool) {
        return stakedTimestamps[_tokenId] != 0 && stakedTimestamps[_tokenId] + rewardsPeriod < block.timestamp;
    }

    function withdrawWithoutRewards(uint256 _tokenId) external nonReentrant {
        address owner = ownerOf(_tokenId);
        require(_msgSender() == owner, "Not Token Owner");
        // Always unstaking with timestamp reset to allow re-staking
        _unstake(owner, _tokenId, true);
    }

    function withdrawWithRewards(uint256 _tokenId) external nonReentrant {
        require(isRewardTime(_tokenId), "Not Reward Time");
        address owner = ownerOf(_tokenId);
        require(_msgSender() == owner, "Not Token Owner");
        _distributeRewards(owner, _tokenId);
        // When recurrentRewards we reset timestamp to allow re-staking
        _unstake(owner, _tokenId, recurrentRewards);
    }

    function claimRewards(uint256 _tokenId) external nonReentrant {
        require(recurrentRewards, "Reward not recurrent");
        require(isRewardTime(_tokenId), "Not Reward Time");
        // Reset rewards timer and distribute rewards
        stakedTimestamps[_tokenId] = block.timestamp;
        _distributeRewards(ownerOf(_tokenId), _tokenId);
    }

    function setEntropyReader(address _entropyReader) external onlyRole(DEFAULT_ADMIN_ROLE) {
        entropyReader = _entropyReader;
    }
    
    function setRewardsPool(address _rewardsPool) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardsPool = _rewardsPool;
    }

    function setRewardsPeriod(uint256 _rewardsPeriod) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardsPeriod = _rewardsPeriod;
    }

    function setRecurrentRewards(bool _recurrentRewards) external onlyRole(DEFAULT_ADMIN_ROLE) {
        recurrentRewards = _recurrentRewards;
    }

    function setRewardsAttribute(string memory _attribute) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardsAttribute = _attribute;
    }

    function setReward(address _token, string memory _attributeValue, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        rewardsByAttribute[_token][_attributeValue] = _amount;
    }

    function setRewardTokens(address[] calldata _tokens) external onlyRole(DEFAULT_ADMIN_ROLE) {
        // Maximum to avoid potential situations where too many tokens are awarded and tx gas becomes too high to withdraw
        require(_tokens.length < 5, "Max 5 token rewards");
        rewardsTokens = _tokens;
    }

    function isStakingForAddress(address _address, uint256 _tokenId) public view returns (bool) {
        return ownerOf(_tokenId) == _address && IERC721(nftToStake).ownerOf(_tokenId) == address(this);
    }

    function hasStaked(uint256 _tokenId) public view returns (bool) {
        return stakedTimestamps[_tokenId] > 0;
    }

    function getOwnedTokenIds(address owner) external view returns (uint256[] memory) {
        uint256[] memory ret = new uint256[](balanceOf(owner));
        for (uint256 i = 0; i < balanceOf(owner); i++) {
            ret[i] = tokenOfOwnerByIndex(owner, i);
        }
        return ret;
    }

    ///@dev Withdraw function to avoid locking tokens in the contract
    function withdrawERC20(address _address, uint256 _amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(_address).transfer(msg.sender, _amount);
    }

    ///@dev Emergency method to withdraw NFT in case someone sends them via transferFrom
    function withdrawNFT(address _token, uint256 _tokenId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_token != address(this), "Withdrawing staking NFTs not allowed");
        if (_token == nftToStake) {
            require(!_exists(_tokenId), "Token can be withdrawn by owner");
        }
        IERC721(_token).safeTransferFrom(address(this), msg.sender, _tokenId);
    }

    function _distributeRewards(address owner, uint256 _tokenId) internal {
        // string memory attributeValue = IERC721Attributes(nftToStake).tokenAttributes(_tokenId, rewardsAttribute);
        string memory attributeValue = EntropyReader(entropyReader).getAttributeFromSeed(rewardsAttribute, _tokenId);
        for (uint256 i = 0; i < rewardsTokens.length; i++) {
            uint256 reward = rewardsByAttribute[rewardsTokens[i]][attributeValue];
            if (reward > 0) {
                IERC20(rewardsTokens[i]).transferFrom(rewardsPool, owner, reward);
            }
        }
    }

    function _stake(address _owner, uint256 _tokenId) internal {
        if (_exists(_tokenId)) {
            _safeTransfer(address(this), _owner, _tokenId, "");
        } else {
           _mint(_owner, _tokenId);
        }   
        stakedTimestamps[_tokenId] = block.timestamp;
    }

    function _unstake(address _owner, uint256 _tokenId, bool _resetTimestamp) internal {
        _transfer(_owner, address(this), _tokenId);
        if (_resetTimestamp) {
            stakedTimestamps[_tokenId] = 0;
        }
        IERC721(nftToStake).safeTransferFrom(address(this), _owner, _tokenId);
    }
}