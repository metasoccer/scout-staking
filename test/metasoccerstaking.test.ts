import { MockProvider } from "ethereum-waffle";
import { Wallet } from "ethers";
import { expect } from "chai";
import { ethers, waffle, artifacts } from "hardhat";
import {
  MetaSoccerStaking,
  TestERC721,
  TestToken,
  EntropyReader,
} from "../typechain";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

describe("ScoutInitialStaking", function () {
  async function fixtures(wallets: Wallet[], provider: MockProvider) {
    const [deployer, nonDeployer, nonDeployer2] = await ethers.getSigners();
    const testERC721 = artifacts.readArtifactSync("TestERC721");
    const testToken = artifacts.readArtifactSync("TestToken");
    const entropyReaderContract = artifacts.readArtifactSync("EntropyReader");

    const nftToStake = (await waffle.deployContract(deployer, testERC721, [
      "NFT To stake",
      "NTS",
    ])) as TestERC721;

    const anotherNft = (await waffle.deployContract(deployer, testERC721, [
      "Some other NFT",
      "SON",
    ])) as TestERC721;

    const token1 = (await waffle.deployContract(deployer, testToken, [
      "Token 1",
      "T1",
    ])) as TestToken;

    const token2 = (await waffle.deployContract(deployer, testToken, [
      "Token 2",
      "T2",
    ])) as TestToken;

    const metasoccerStaking = artifacts.readArtifactSync("MetaSoccerStaking");
    const rewardsPeriod = 1000;
    const scoutStaking = (await waffle.deployContract(
      deployer,
      metasoccerStaking,
      [nftToStake.address, rewardsPeriod, "scoutStaking", "STK"]
    )) as MetaSoccerStaking;

    const entropyReader = (await waffle.deployContract(
      deployer,
      entropyReaderContract
    )) as EntropyReader;

    return {
      nftToStake,
      entropyReader,
      anotherNft,
      token1,
      token2,
      scoutStaking,
      deployer,
      nonDeployer,
      nonDeployer2,
      rewardsPeriod,
    };
  }

  async function advanceToRewardTime(
    currentSecond: number,
    rewardsPeriod: number
  ): Promise<number> {
    const newSecond = currentSecond + rewardsPeriod;
    await ethers.provider.send("evm_mine", [newSecond]);
    return newSecond;
  }

  async function mintAndStake(
    nftToStake: TestERC721,
    scoutStaking: MetaSoccerStaking,
    owner: SignerWithAddress,
    tokenId: number,
    tokenAttribute: string = "",
    tokenValue: string = "",
    entropyReader?: EntropyReader
  ) {
    await nftToStake.mint(owner.address, tokenId);
    if (tokenAttribute !== "" && tokenValue !== "") {
      if (entropyReader !== undefined) {
        // 90% chance of level 3, 10% chance of level 4, using modulo 10
        const seeds = [
          "20037959305907081881787792045789224328451420942780897008884961732541851472", // Returns a module of 3 => level 3
          "20037959305907081882362477873613932650335801077962262952741988903360702288", // Returns a module of 9 => level 4
        ];
        let seed = seeds[0];
        if (tokenValue === "4") {
          seed = seeds[1];
        }
        await entropyReader.setEntropy(tokenId, seed);
        expect(await entropyReader.entropyStorage(tokenId)).to.equal(seed);
      } else {
        await nftToStake.setTokenAttribute(tokenId, tokenAttribute, tokenValue);
        expect(
          await nftToStake.tokenAttributes(tokenId, tokenAttribute)
        ).to.equal(tokenValue);
      }
    }
    const r = nftToStake
      .connect(owner)
      ["safeTransferFrom(address,address,uint256)"](
        owner.address,
        scoutStaking.address,
        tokenId
      );
    return r;
  }

  before(async () => {
    await waffle.loadFixture(fixtures);
  });

  describe("onERC721Received", () => {
    it("Should only accept allowed NFT", async function () {
      const { anotherNft, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      const q = anotherNft.mint(nonDeployer.address, 1);
      await expect(q).to.not.be.reverted;

      const r = anotherNft
        .connect(nonDeployer)
        ["safeTransferFrom(address,address,uint256)"](
          nonDeployer.address,
          scoutStaking.address,
          1
        );
      await expect(r).to.be.revertedWith("Invalid NFT");
    });

    it("Should accept incoming NFT if it matches nftToStake", async () => {
      const { nftToStake, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      const r = mintAndStake(nftToStake, scoutStaking, nonDeployer, 1);
      await expect(r).to.not.be.reverted;
    });
  });

  describe("owner", () => {
    it("Should revert if we do not know the owner", async function () {
      const { nftToStake, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 3);

      const r = scoutStaking.ownerOf(4);
      await expect(r).to.revertedWith(
        "ERC721: owner query for nonexistent token"
      );
    });

    it("Should return the original owner", async function () {
      const { nftToStake, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 4);

      expect(await scoutStaking.ownerOf(4)).to.be.equal(nonDeployer.address);
      expect(
        await scoutStaking.isStakingForAddress(nonDeployer.address, 4)
      ).to.equal(true);
    });
  });

  describe("ERC721Enumerable for tracking", () => {
    it("Should support 721 Enumerable interface", async () => {
      const { scoutStaking } = await waffle.loadFixture(fixtures);
      expect(await scoutStaking.supportsInterface("0x780e9d63")).to.equal(true);
    });

    it("Should not allow to be transferred unless unstaked", async function () {
      const { nftToStake, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 4);

      await expect(
        scoutStaking.transferFrom(nonDeployer.address, nftToStake.address, 4)
      ).to.revertedWith("Transferring Staked NFT");
      await expect(
        scoutStaking["safeTransferFrom(address,address,uint256)"](
          nonDeployer.address,
          nftToStake.address,
          4
        )
      ).to.revertedWith("Transferring Staked NFT");
    });
  });

  describe("Withdrawing without rewards should always be available", () => {
    it("Should be able to withdraw early and unable to claim rewards", async function () {
      const { nftToStake, nonDeployer, nonDeployer2, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 3);

      expect(await scoutStaking.isRewardTime(3)).to.equal(false);

      await expect(
        scoutStaking.connect(nonDeployer).withdrawWithRewards(3)
      ).to.be.revertedWith("Not Reward Time");

      await expect(
        scoutStaking.connect(nonDeployer).claimRewards(3)
      ).to.be.revertedWith("Reward not recurrent");

      await expect(
        scoutStaking.connect(nonDeployer2).withdrawWithoutRewards(3)
      ).to.be.revertedWith("Not Token Owner");

      await scoutStaking.connect(nonDeployer).withdrawWithoutRewards(3);

      const owner = await nftToStake.ownerOf(3);
      expect(owner).to.be.equal(nonDeployer.address);
    });
  });

  describe("isRewardTime", () => {
    it("Should account for reward time", async function () {
      const { nftToStake, nonDeployer, scoutStaking, rewardsPeriod } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 3);

      const r = await scoutStaking.isRewardTime(3);
      expect(r).to.be.equal(false);

      await advanceToRewardTime(Date.now() / 1000, rewardsPeriod);

      const r2 = await scoutStaking.isRewardTime(3);
      expect(r2).to.be.equal(true);
    });
  });

  describe("Staking and withdrawWithRewards", () => {
    let nftToStake: TestERC721;
    let entropyReader: EntropyReader;
    let token1: TestToken;
    let token2: TestToken;
    let scoutStaking: MetaSoccerStaking;
    let deployer: SignerWithAddress;
    let nonDeployer: SignerWithAddress;
    let nonDeployer2: SignerWithAddress;
    let rewardsPeriod: number;
    const rewardAttribute = "Level";
    const rewards = {
      token1: {
        "3": 100000,
        "4": 1000000,
      },
      token2: {
        "3": 100000,
        "4": 1000000,
      },
    };

    before(async () => {
      const loadedFixtures = await waffle.loadFixture(fixtures);

      nftToStake = loadedFixtures.nftToStake;
      token1 = loadedFixtures.token1;
      token2 = loadedFixtures.token2;
      scoutStaking = loadedFixtures.scoutStaking;
      deployer = loadedFixtures.deployer;
      nonDeployer = loadedFixtures.nonDeployer;
      nonDeployer2 = loadedFixtures.nonDeployer2;
      rewardsPeriod = loadedFixtures.rewardsPeriod;
      entropyReader = loadedFixtures.entropyReader;
    });

    it("Should allow admin to add token rewards from his wallet", async function () {
      // Mint reward test tokens and grant allowance
      const mintAmount = 999999999999999;
      await token1.mint(deployer.address, mintAmount);
      await token2.mint(deployer.address, mintAmount);
      await token1.approve(scoutStaking.address, mintAmount);
      await token2.approve(scoutStaking.address, mintAmount);
      expect(await token1.balanceOf(deployer.address)).to.equal(mintAmount);
      expect(await token2.balanceOf(deployer.address)).to.equal(mintAmount);
      expect(
        await token1.allowance(deployer.address, scoutStaking.address)
      ).to.equal(mintAmount);
      expect(
        await token2.allowance(deployer.address, scoutStaking.address)
      ).to.equal(mintAmount);
      // Set Staking Rewards from deployer as pool
      await scoutStaking.setRewardTokens([token1.address, token2.address]);
      await scoutStaking.setRewardsPool(deployer.address);
      await scoutStaking.setRewardsAttribute(rewardAttribute);
      await scoutStaking.setEntropyReader(entropyReader.address);
      expect(await scoutStaking.rewardsTokens(0)).to.equal(token1.address);
      expect(await scoutStaking.rewardsTokens(1)).to.equal(token2.address);
      expect(await scoutStaking.rewardsPool()).to.equal(deployer.address);
      expect(await scoutStaking.entropyReader()).to.equal(
        entropyReader.address
      );
      expect(await scoutStaking.rewardsAttribute()).to.equal(rewardAttribute);
      // Set Token1 rewards
      for (const [rewardValue, rewardAmount] of Object.entries(
        rewards.token1
      )) {
        await scoutStaking.setReward(token1.address, rewardValue, rewardAmount);
        expect(
          await scoutStaking.rewardsByAttribute(token1.address, rewardValue)
        ).to.equal(rewardAmount);
      }
      for (const [rewardValue, rewardAmount] of Object.entries(
        rewards.token2
      )) {
        await scoutStaking.setReward(token2.address, rewardValue, rewardAmount);
        expect(
          await scoutStaking.rewardsByAttribute(token2.address, rewardValue)
        ).to.equal(rewardAmount);
      }
    });

    it("NonDeployer should stake a valid NFT of level 1", async function () {
      await mintAndStake(
        nftToStake,
        scoutStaking,
        nonDeployer,
        1,
        rewardAttribute,
        "3",
        entropyReader
      );

      const owner = await nftToStake.ownerOf(1);
      expect(owner).to.be.equal(scoutStaking.address);
    });

    it("NonDeployer2 should stake a valid NFT of level 2", async function () {
      await mintAndStake(
        nftToStake,
        scoutStaking,
        nonDeployer2,
        2,
        rewardAttribute,
        "4",
        entropyReader
      );

      const owner = await nftToStake.ownerOf(2);
      expect(owner).to.be.equal(scoutStaking.address);
    });

    it("Should keep track of NFT original owners", async function () {
      const stakedOwner = await scoutStaking.ownerOf(1);
      expect(stakedOwner).to.be.equal(nonDeployer.address);
      const stakedOwner2 = await scoutStaking.ownerOf(2);
      expect(stakedOwner2).to.be.equal(nonDeployer2.address);
      expect(
        await scoutStaking.getOwnedTokenIds(nonDeployer.address)
      ).to.deep.equal([ethers.BigNumber.from(1)]);
      expect(
        await scoutStaking.getOwnedTokenIds(nonDeployer2.address)
      ).to.deep.equal([ethers.BigNumber.from(2)]);
    });

    it("Should unstake with rewards to the original owner", async function () {
      // Wait for rewards Period;
      await advanceToRewardTime(Date.now() / 1000, rewardsPeriod);
      await scoutStaking.connect(nonDeployer).withdrawWithRewards(1);
      const tx2 = scoutStaking.connect(nonDeployer2).withdrawWithRewards(2);
      await expect(tx2).to.not.be.reverted;

      expect(await nftToStake.ownerOf(1)).to.be.equal(nonDeployer.address);
      expect(await token1.balanceOf(nonDeployer.address)).to.equal(
        rewards.token1["3"]
      );
      expect(await token2.balanceOf(nonDeployer.address)).to.equal(
        rewards.token2["3"]
      );

      expect(await nftToStake.ownerOf(2)).to.be.equal(nonDeployer2.address);
      expect(await token1.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token1["4"]
      );
      expect(await token2.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token2["4"]
      );
    });

    it("Should fail to restake a valid NFT", async function () {
      const token = nftToStake.connect(nonDeployer);
      const tx = token["safeTransferFrom(address,address,uint256)"](
        nonDeployer.address,
        scoutStaking.address,
        1
      );

      await expect(tx).to.revertedWith("Already staked");
    });

    it("Should revert if original owner does not match tokenId", async function () {
      const { nftToStake, scoutStaking, nonDeployer, rewardsPeriod } =
        await waffle.loadFixture(fixtures);

      await nftToStake.mint(nonDeployer.address, 3);
      const token = nftToStake.connect(nonDeployer);
      await token["safeTransferFrom(address,address,uint256)"](
        nonDeployer.address,
        scoutStaking.address,
        3
      );

      // Wait for rewards Period;
      await advanceToRewardTime(Date.now() / 1000, rewardsPeriod);

      const r = scoutStaking.withdrawWithRewards(3);
      await expect(r).to.revertedWith("Not Token Owner");
    });
  });

  describe("Staking with recurrent rewards", () => {
    let nftToStake: TestERC721;
    let entropyReader: EntropyReader;
    let token1: TestToken;
    let token2: TestToken;
    let scoutStaking: MetaSoccerStaking;
    let deployer: SignerWithAddress;
    let nonDeployer: SignerWithAddress;
    let nonDeployer2: SignerWithAddress;
    let s = Date.now() / 1000;
    const recurrentTests = 10;
    const recurrentRewardPeriod = 10;
    const rewardAttribute = "Level";
    const rewards = {
      token1: {
        "3": 100000,
        "4": 1000000,
      },
      token2: {
        "3": 100000,
        "4": 1000000,
      },
    };

    before(async () => {
      const loadedFixtures = await waffle.loadFixture(fixtures);

      nftToStake = loadedFixtures.nftToStake;
      token1 = loadedFixtures.token1;
      token2 = loadedFixtures.token2;
      scoutStaking = loadedFixtures.scoutStaking;
      deployer = loadedFixtures.deployer;
      nonDeployer = loadedFixtures.nonDeployer;
      nonDeployer2 = loadedFixtures.nonDeployer2;
      entropyReader = loadedFixtures.entropyReader;
    });

    it("Should allow deployer to set recurrent rewards from his wallet", async function () {
      // Mint reward test tokens and grant allowance
      const mintAmount = 999999999999999;
      await token1.mint(deployer.address, mintAmount);
      await token2.mint(deployer.address, mintAmount);
      await token1.approve(scoutStaking.address, mintAmount);
      await token2.approve(scoutStaking.address, mintAmount);
      expect(await token1.balanceOf(deployer.address)).to.equal(mintAmount);
      expect(await token2.balanceOf(deployer.address)).to.equal(mintAmount);
      expect(
        await token1.allowance(deployer.address, scoutStaking.address)
      ).to.equal(mintAmount);
      expect(
        await token2.allowance(deployer.address, scoutStaking.address)
      ).to.equal(mintAmount);
      // Set Staking Rewards from deployer as pool
      await scoutStaking.setRewardTokens([token1.address, token2.address]);
      await scoutStaking.setRewardsPool(deployer.address);
      await scoutStaking.setRewardsAttribute(rewardAttribute);
      await scoutStaking.setRecurrentRewards(true);
      await scoutStaking.setRewardsPeriod(recurrentRewardPeriod);
      await scoutStaking.setEntropyReader(entropyReader.address);
      expect(await scoutStaking.rewardsTokens(0)).to.equal(token1.address);
      expect(await scoutStaking.rewardsTokens(1)).to.equal(token2.address);
      expect(await scoutStaking.rewardsPool()).to.equal(deployer.address);
      expect(await scoutStaking.rewardsAttribute()).to.equal(rewardAttribute);
      expect(await scoutStaking.recurrentRewards()).to.equal(true);
      expect(await scoutStaking.entropyReader()).to.equal(entropyReader.address);
      expect(await scoutStaking.rewardsPeriod()).to.equal(
        recurrentRewardPeriod
      );
      // Set Token1 rewards
      for (const [rewardValue, rewardAmount] of Object.entries(
        rewards.token1
      )) {
        await scoutStaking.setReward(token1.address, rewardValue, rewardAmount);
        expect(
          await scoutStaking.rewardsByAttribute(token1.address, rewardValue)
        ).to.equal(rewardAmount);
      }
      for (const [rewardValue, rewardAmount] of Object.entries(
        rewards.token2
      )) {
        await scoutStaking.setReward(token2.address, rewardValue, rewardAmount);
        expect(
          await scoutStaking.rewardsByAttribute(token2.address, rewardValue)
        ).to.equal(rewardAmount);
      }
    });

    it("NonDeployer should stake a valid NFT of level 1", async function () {
      await mintAndStake(
        nftToStake,
        scoutStaking,
        nonDeployer,
        1,
        rewardAttribute,
        "3",
        entropyReader
      );

      const owner = await nftToStake.ownerOf(1);
      expect(owner).to.be.equal(scoutStaking.address);
    });

    it("NonDeployer2 should stake a valid NFT of level 2", async function () {
      await mintAndStake(
        nftToStake,
        scoutStaking,
        nonDeployer2,
        2,
        rewardAttribute,
        "4",
        entropyReader
      );

      const owner = await nftToStake.ownerOf(2);
      expect(owner).to.be.equal(scoutStaking.address);
    });

    it("Should keep track of NFT original owners", async function () {
      const stakedOwner = await scoutStaking.ownerOf(1);
      expect(stakedOwner).to.equal(nonDeployer.address);

      const stakedOwner2 = await scoutStaking.ownerOf(2);
      expect(stakedOwner2).to.equal(nonDeployer2.address);
    });

    it("Should fail to claim rewards before time", async function () {
      const tx = scoutStaking.connect(nonDeployer).claimRewards(1);

      await expect(tx).to.revertedWith("Not Reward Time");
    });

    it("nonDeployer should claim rewards recurrently", async function () {
      const recurrentRewardAmountToken1 = rewards.token1["3"];
      const recurrentRewardAmountToken2 = rewards.token2["3"];
      for (let i = 1; i < recurrentTests; i++) {
        // Wait for rewards Period;
        s = await advanceToRewardTime(s, recurrentRewardPeriod + 1);

        await scoutStaking.connect(nonDeployer).claimRewards(1);

        const newOwner = await nftToStake.ownerOf(1);
        expect(newOwner).to.be.equal(scoutStaking.address);
        expect(await token1.balanceOf(nonDeployer.address)).to.equal(
          recurrentRewardAmountToken1 * i
        );
        expect(await token2.balanceOf(nonDeployer.address)).to.equal(
          recurrentRewardAmountToken2 * i
        );
      }
    });

    it("nonDeployer2 should WithdrawWithRewards token with id 2", async function () {
      // Withdraw with rewards
      await scoutStaking.connect(nonDeployer2).withdrawWithRewards(2);
      expect(await nftToStake.ownerOf(2)).to.equal(nonDeployer2.address);
      expect(await token1.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token1["4"]
      );
      expect(await token2.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token2["4"]
      );
    });

    it("nonDeployer2 should stake again token with id 2", async function () {
      // Restake same token
      await nftToStake
        .connect(nonDeployer2)
        ["safeTransferFrom(address,address,uint256)"](
          nonDeployer2.address,
          scoutStaking.address,
          2
        );
      expect(await nftToStake.ownerOf(2)).to.equal(scoutStaking.address);
      expect(await scoutStaking.ownerOf(2)).to.equal(nonDeployer2.address);
    });

    it("nonDeployer2 should withdrawWithRewards again for token with id 2", async function () {
      // Wait for next rewards and withdraw with rewards again
      s = await advanceToRewardTime(s, recurrentRewardPeriod * recurrentTests);
      await scoutStaking.connect(nonDeployer2).withdrawWithRewards(2);
      expect(await nftToStake.ownerOf(2)).to.equal(nonDeployer2.address);
      expect(await token1.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token1["4"] * 2
      );
      expect(await token2.balanceOf(nonDeployer2.address)).to.equal(
        rewards.token2["4"] * 2
      );
    });
  });

  describe("Admin Emergency Functions", () => {
    it("Should allow deployer to withdraw ERC20", async function () {
      const { token1, deployer, scoutStaking } = await waffle.loadFixture(
        fixtures
      );

      // Mint test tokens to staking contract
      await token1.mint(scoutStaking.address, 100);
      expect(await token1.balanceOf(scoutStaking.address)).to.equal(100);

      await scoutStaking.connect(deployer).withdrawERC20(token1.address, 100);
      expect(await token1.balanceOf(deployer.address)).to.equal(100);
    });

    it("Should allow deployer to withdraw stuck NFT", async function () {
      const { nftToStake, deployer, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await nftToStake.mint(nonDeployer.address, 4);
      await nftToStake
        .connect(nonDeployer)
        .transferFrom(nonDeployer.address, scoutStaking.address, 4);

      await scoutStaking.connect(deployer).withdrawNFT(nftToStake.address, 4);
      const r = await nftToStake.ownerOf(4);
      expect(r).to.be.equal(deployer.address);
    });

    it("Should allow deployer to withdraw random NFT", async function () {
      const { anotherNft, deployer, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await anotherNft.mint(nonDeployer.address, 4);
      await anotherNft
        .connect(nonDeployer)
        .transferFrom(nonDeployer.address, scoutStaking.address, 4);

      await scoutStaking.connect(deployer).withdrawNFT(anotherNft.address, 4);
      const r = await anotherNft.ownerOf(4);
      expect(r).to.be.equal(deployer.address);
    });

    it("Shouldn't allow deployer to withdraw properly staked NFT", async function () {
      const { nftToStake, deployer, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await mintAndStake(nftToStake, scoutStaking, nonDeployer, 4);

      const r = scoutStaking
        .connect(deployer)
        .withdrawNFT(nftToStake.address, 4);
      await expect(r).to.revertedWith("Token can be withdrawn by owner");

      const r2 = scoutStaking
        .connect(deployer)
        .withdrawNFT(scoutStaking.address, 4);
      await expect(r2).to.revertedWith("Withdrawing staking NFTs not allowed");
    });

    it("Should fail to set more than 5 reward tokens", async function () {
      const { deployer, scoutStaking } = await waffle.loadFixture(fixtures);

      const tx = scoutStaking
        .connect(deployer)
        .setRewardTokens([
          deployer.address,
          deployer.address,
          deployer.address,
          deployer.address,
          deployer.address,
          deployer.address,
        ]);
      await expect(tx).to.revertedWith("Max 5 token rewards");
    });

    it("Should fail to bypass staking", async function () {
      const { nftToStake, nonDeployer, scoutStaking } =
        await waffle.loadFixture(fixtures);

      await nftToStake.mint(nonDeployer.address, 4);
      const tx = scoutStaking.onERC721Received(
        nonDeployer.address,
        nonDeployer.address,
        4,
        "0x0000"
      );

      await expect(tx).to.revertedWith("Invalid NFT");
    });
  });
});
