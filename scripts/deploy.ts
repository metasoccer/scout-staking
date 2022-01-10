import { ethers } from "hardhat";

async function main() {
  const TestToken = await ethers.getContractFactory("TestToken");
  const testToken = await TestToken.deploy("Some name", "TNT");

  await testToken.deployed();

  console.log("Greeter deployed to:", testToken.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
