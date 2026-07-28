# GlobalPay — BOT Chain Deployment & Migration Guide

This document serves as the guide for deploying, testing, and migrating the GlobalPay Web3 application to the **BOT Chain Testnet** and **BOT Chain Mainnet**.

---

## 1. Network Configuration

GlobalPay uses the following EVM parameters for both networks, managed dynamically through environment variables:

| Parameter | BOT Chain Testnet (Bohr) | BOT Chain Mainnet |
| :--- | :--- | :--- |
| **Chain Name** | BOT Chain Testnet | BOT Chain Mainnet |
| **Chain ID** | `968` | `677` |
| **RPC URL** | `https://rpc.bohr.life` | `https://rpc.botchain.ai` |
| **Native Symbol** | `BOT` (or `DAT`) | `BOT` |
| **Block Explorer** | `https://scan.bohr.life/` | `https://scan.botchain.ai/` |

---

## 2. Environment Variables

### Frontend (`client/.env`)
Add the following keys to your frontend configuration. To switch between Testnet and Mainnet, swap these values:

```env
# Dynamic BOT Chain Config
VITE_BOTCHAIN_CHAIN_NAME="BOT Chain Testnet"
VITE_BOTCHAIN_CHAIN_ID=968
VITE_BOTCHAIN_RPC_URL="https://rpc.bohr.life"
VITE_BOTCHAIN_EXPLORER_URL="https://scan.bohr.life"
VITE_BOTCHAIN_SYMBOL="BOT"
```

### Backend (`backend/.env`)
Add these variables to your backend `.env` file:

```env
# Dynamic BOT Chain Config
BOTCHAIN_CHAIN_NAME="BOT Chain Testnet"
BOTCHAIN_CHAIN_ID=968
BOTCHAIN_RPC_URL="https://rpc.bohr.life"
BOTCHAIN_EXPLORER_URL="https://scan.bohr.life"
BOTCHAIN_SYMBOL="BOT"

# Relayer Treasury Key (used to sponsor user gas and deploy contracts)
TREASURY_PRIVATE_KEY="0x7503ca61..."
```

---

## 3. Smart Contract & Deployed Addresses

GlobalPay deploys the custom `PlatformUSDC` contract which supports:
1. **Fiat On-Ramp (`depositFiat`)**: Mints `pUSDC` tokens representing bank deposits into the user's secure Web3 Vault.
2. **Fiat Off-Ramp (`withdrawFiat`)**: Burns `pUSDC` tokens when off-ramped to traditional bank accounts.
3. **Custodial Remittance (`executeTransfer`)**: Facilitates zero-gas, instant cross-border transfers.

### Deployed Addresses (BOT Chain Testnet)

* **PlatformUSDC Contract**: `0x54E067b44F7e43B8f15ce2eC6BD6237f3cdeC498`
* **Relayer Treasury Wallet**: `0xD25F8736C3Efc19a7cb7A3D15f2aF22c2980E317`

---

## 4. Wallet Setup & Network Addition

To connect MetaMask or another Web3 wallet, add the network details in MetaMask Settings:

1. Click on the MetaMask extension, select the network dropdown, and click **Add network** -> **Add a network manually**.
2. Enter the parameters corresponding to your environment (Testnet or Mainnet) as described in **Section 1**.
3. *Note*: MetaMask may flag a symbol mismatch. You can ignore the warning and click **Save anyway**, or set the currency symbol to **DAT** (the genesis symbol for Bohr).

---

## 5. Testing Guide

We have provided a custom integration test runner (`run-tests.js`) that performs end-to-end checks on the configured network:

### Running the Integration Tests
1. Make sure your environment variables are configured.
2. Navigate to the backend directory and run:
   ```bash
   cd backend
   node run-tests.js
   ```
3. The test suite will check:
   * RPC network latency and connectivity.
   * Treasury gas reserves.
   * Smart contract parameters (Name, Symbol, Decimals).
   * Mongoose DB schema compatibility.
   * Active minting, transferring, and burning execution blocks.

---

## 6. Mainnet Migration Guide

Because the application is built using a clean, configuration-driven architecture, moving from Testnet to Mainnet **does not require code rewrites**. Simply follow these steps:

1. **Fund the Mainnet Relayer Wallet**:
   * Derive the address of your mainnet private key.
   * Bridge native `BOT` tokens to this wallet using the official BOT Chain Bridge (https://bridge.botchain.ai).
   * Ensure to select **"Receive 0.1 BOT for Future Gas Fees"** when bridging, so the wallet has gas to begin operations.
2. **Deploy the Smart Contract**:
   * Update the environment variables in `backend/.env` with the Mainnet parameters:
     ```env
     BOTCHAIN_CHAIN_NAME="BOT Chain Mainnet"
     BOTCHAIN_CHAIN_ID=677
     BOTCHAIN_RPC_URL="https://rpc.botchain.ai"
     BOTCHAIN_EXPLORER_URL="https://scan.botchain.ai"
     ```
   * Deploy the ledger contract to Mainnet:
     ```bash
     cd backend
     node deployLedger.js
     ```
   * This automatically generates a new `contractData.json` containing the Mainnet address and ABI.
3. **Update Frontend Environment**:
   * Modify the variables in `client/.env` to point to BOT Chain Mainnet:
     ```env
     VITE_BOTCHAIN_CHAIN_NAME="BOT Chain Mainnet"
     VITE_BOTCHAIN_CHAIN_ID=677
     VITE_BOTCHAIN_RPC_URL="https://rpc.botchain.ai"
     VITE_BOTCHAIN_EXPLORER_URL="https://scan.botchain.ai"
     VITE_BOTCHAIN_SYMBOL="BOT"
     ```
   * Rebuild and redeploy your frontend client.
4. **Final Run**:
   * Confirm database and blockchain interactions function perfectly on Mainnet by running `node run-tests.js`!
