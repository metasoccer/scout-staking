pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";

///@dev The interface we couple Scouts contract to
interface IERC721Attributes is IERC721Enumerable {
  function tokenAttributes(uint256 _tokenId, string memory _attribute) external view returns (string memory);
}