# Pre-Req Vault Architecture

```mermaid
flowchart LR
    user["User / TypeScript client<br/>Wallet signer"]
    state[("Vault State PDA<br/>seeds: [state, user]")]
    vault[("Vault PDA<br/>seeds: [vault, vault_state]")]
    registration[("Registration PDA<br/>seeds: [prereqs, user]")]
    vaultProgram[["Modified Vault program<br/>G2EbNUR3qxtVyfMGaxf6BzMBpd7xfB3gESNxhJVreSxj"]]
    registrationProgram[["Registration program<br/>TRBZyQHB3m68FGeVsqTK39Wm4xejadjVhP5MAZaKWDM"]]
    system[["Solana System Program"]]

    user -->|initialize| vaultProgram
    vaultProgram -->|creates / records bumps| state
    vaultProgram -->|derives| vault
    user -->|deposit(amount)| vaultProgram
    vaultProgram -->|System CPI: user -> vault| system
    system --> vault

    user -->|withdraw(amount, github)| vaultProgram
    vaultProgram -->|"System CPI: vault -> user<br/>Vault PDA signer seeds"| system
    system --> user
    vaultProgram -->|registration CPI: initialize(github)| registrationProgram
    registrationProgram -->|creates / stores GitHub username| registration
    registrationProgram -->|payer and signer| user
    registrationProgram -->|account creation| system

    user -->|close| vaultProgram
    vaultProgram -->|System CPI: vault -> user| system
    vaultProgram -->|close = user| state
```

## Verified PDA Relationships

- Vault State: `["state", user]`, owned by the Vault program.
- Vault: `["vault", vault_state]`, derived by the Vault program.
- Registration: `["prereqs", user]`, derived by the Registration program.

## Lifecycle

`initialize` creates the user-scoped Vault State PDA and records both PDA bumps.
The Vault PDA is a system-owned lamport account derived from that state account.
`deposit` transfers lamports from the user to the Vault PDA. `withdraw` transfers
lamports back to the user and, in the same transaction, performs the registration
program's `initialize(github)` CPI. `close` transfers the remaining Vault PDA
lamports to the user and closes the Vault State PDA.

The Registration PDA is one-registration-per-wallet state. A second initialization
for the same wallet is expected to fail because the PDA already exists.
