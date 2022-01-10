// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./IERC721Attributes.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";

/**
 * @dev {ERC20} testToken, freely minteable by everyone
 *
 * This is just so we can test contracts dependent on an ERC20
 * fo example withdrawERC20 from EntropyManager
 */
contract TestERC721 is IERC721Attributes, ERC721Enumerable
{
    mapping(uint256 => mapping(string => string)) public tokenAttributes;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC721(name_, symbol_) {
    }

    function mint(address to, uint256 _tokenId) public virtual {
        _mint(to, _tokenId);
    }

    function setTokenAttribute(uint256 _tokenId, string memory _attribute, string memory _value) external {
        tokenAttributes[_tokenId][_attribute] = _value;
    }
}
