pragma solidity ^0.8.9;
// SPDX-License-Identifier: MIT

contract EntropyReader {

  // For tests only, will use actual EntropyStorage contract from Scouts repo
  mapping(uint256 => uint256) public entropyStorage;

  // For tests only, will use actual EntropyStorage contract from Scouts repo
  function setEntropy(uint256 _tokenId, uint256 _randomness) external {
    entropyStorage[_tokenId] = _randomness;
  }

  // For tests only, actual method will need to take into account seed for v1 and token origin for v2
  function getAttributeFromSeed(string memory _attr, uint256 _tokenId) public view returns(string memory) {
    uint256 entropy = entropyStorage[_tokenId];
    bytes memory entropyBytes = abi.encodePacked(entropy);
    bytes memory slicedBytes = new bytes(2);
    slicedBytes[0] = entropyBytes[8];
    slicedBytes[1] = entropyBytes[9];
    uint16 levelEntropy = uint16(bytes2(slicedBytes));
    uint16 modulo = levelEntropy % 10;
    if (modulo == 9) {
      return "4";
    }
    return "3";
  }
}