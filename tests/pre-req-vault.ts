import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { PreReqVault } from "../target/types/pre_req_vault";
import {
  Commitment,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { BN } from "bn.js";
import { expect } from "chai";

const commitment: Commitment = "confirmed";
const githubUsername = "yeandamen";
const registrationProgram = new PublicKey(
  "TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM"
);

describe("pre-req-vault", () => {
  const confirmTx = async (signature: string) => {
    console.log(`Transaction signature: ${signature}`);
    const latestBlockhash = await anchor
      .getProvider()
      .connection.getLatestBlockhash();
    await anchor.getProvider().connection.confirmTransaction(
      {
        signature,
        ...latestBlockhash,
      },
      commitment
    );
  };

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.preReqVault as Program<PreReqVault>;
  const user = Keypair.generate();

  // Derive PDAs

  const [vaultStatePda, stateBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state"), user.publicKey.toBuffer()],
    program.programId
  );

  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), vaultStatePda.toBuffer()],
    program.programId
  );

  before(async () => {
    const fundingTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: provider.wallet.publicKey,
        toPubkey: user.publicKey,
        lamports: 1.1 * LAMPORTS_PER_SOL,
      })
    );
    await confirmTx(await provider.sendAndConfirm(fundingTx));
  });

  it("Initialize the vault", async () => {
    const tx = await program.methods
      .initialize()
      .accountsStrict({
        user: user.publicKey,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    await confirmTx(tx);

    const vaultState = await program.account.vaultState.fetch(vaultStatePda);
    expect(vaultState.vaultBump).to.equal(vaultBump);
    expect(vaultState.stateBump).to.equal(stateBump);
  });

  it(" Deposilt 1 Sol in to the vault", async () => {
    const depositAmount = 1 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const initialUserBalance = await provider.connection.getBalance(
      user.publicKey
    );

    const tx = await program.methods
      .deposit(new BN(depositAmount))
      .accountsStrict({
        user: user.publicKey,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(
      user.publicKey
    );

    expect(finalBalanceVault).to.equal(initialVaultBalance + depositAmount);
    expect(finalBalanceUser).to.be.at.most(initialUserBalance - depositAmount);
  });

  it(" Withdraw 0.5 Sol from the vault", async () => {
    const withdrawAmount = 0.5 * LAMPORTS_PER_SOL;

    const initialVaultBalance = await provider.connection.getBalance(vaultPda);
    const initialUserBalance = await provider.connection.getBalance(
      user.publicKey
    );

    const applicationAccount = PublicKey.findProgramAddressSync(
      [Buffer.from("prereqs"), user.publicKey.toBuffer()],
      registrationProgram
    )[0];

    const tx = await program.methods
      .withdraw(new BN(withdrawAmount), githubUsername)
      .accountsStrict({
        user: user.publicKey,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        applicationAccount,
        applicationProgram: registrationProgram,
      })
      .signers([user])
      .rpc();

    await confirmTx(tx);

    const finalBalanceVault = await provider.connection.getBalance(vaultPda);
    const finalBalanceUser = await provider.connection.getBalance(
      user.publicKey
    );

    expect(finalBalanceVault).to.equal(initialVaultBalance - withdrawAmount);
    expect(finalBalanceUser).to.be.greaterThan(initialUserBalance);

    const withdrawalTransaction =
      await provider.connection.getParsedTransaction(tx, {
        commitment,
        maxSupportedTransactionVersion: 0,
      });
    expect(withdrawalTransaction).to.not.be.null;
    expect(
      withdrawalTransaction.transaction.message.instructions.some(
        (instruction) => instruction.programId.equals(program.programId)
      )
    ).to.equal(true);
    expect(
      withdrawalTransaction.meta.innerInstructions.some((group) =>
        group.instructions.some((instruction) =>
          instruction.programId.equals(registrationProgram)
        )
      )
    ).to.equal(true);

    const registrationAccount = await provider.connection.getAccountInfo(
      applicationAccount
    );
    expect(registrationAccount).to.not.be.null;
    expect(registrationAccount.owner.toBase58()).to.equal(
      registrationProgram.toBase58()
    );

    const registrationData = registrationAccount.data;
    const githubOffset = 8 + 32 + 1 + 1 + 1 + 4;
    const storedLength = registrationData.readUInt32LE(githubOffset - 4);
    expect(storedLength).to.equal(Buffer.byteLength(githubUsername));
    expect(
      registrationData
        .subarray(githubOffset, githubOffset + storedLength)
        .toString("utf8")
    ).to.equal(githubUsername);
  });

  it(" Close the vault and withdraw all the funds", async () => {
    const initialUserBalance = await provider.connection.getBalance(
      user.publicKey
    );

    const tx = await program.methods
      .close()
      .accountsStrict({
        user: user.publicKey,
        vaultState: vaultStatePda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    await confirmTx(tx);

    expect(await provider.connection.getBalance(vaultPda)).to.equal(0);

    const vaultStateInfo = await provider.connection.getAccountInfo(
      vaultStatePda
    );
    expect(vaultStateInfo).to.be.null;

    const finalUserBalance = await provider.connection.getBalance(
      user.publicKey
    );
    expect(finalUserBalance).to.be.greaterThan(initialUserBalance);
  });
});
