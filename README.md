# 🌍 GlobalPay

**Next-Gen Web3 Global Payments | Built for Ethereum Mexico 2026**

![GlobalPay Banner](https://img.shields.io/badge/Status-Live-success?style=for-the-badge) ![Ethereum](https://img.shields.io/badge/Network-Sepolia_L2-blue?style=for-the-badge&logo=ethereum) ![AI](https://img.shields.io/badge/AI_Agent-Integrated-purple?style=for-the-badge)

GlobalPay is a FinTech super-app that abstracts away 100% of the blockchain complexity. We are tearing down the wall between traditional fiat banking and the Web3 ecosystem. To the user, it feels exactly like a traditional Web2 NeoBank (like Mercado Pago). But under the hood, we leverage the **Ethereum L2 Sepolia Network** and **Account Abstraction** to enable instant cross-border remittances with zero gas fees.

---

## 🚀 The Vision & The Problem We Solve
Right now, there is a giant wall between traditional fiat banking and the Web3 ecosystem. If you are a user in LATAM, sending money across borders means paying brutal SWIFT fees and waiting days for settlement. And if you try to use crypto for everyday real-time purchases, the UX is a nightmare (gas fees, seed phrases, multiple networks).

**Our solution is a complete paradigm shift.**
We have built an Auto-Bridge that tokenizes local Fiat into `pUSDC` on the Sepolia testnet, enabling instant cross-border remittances without the user needing to understand gas fees. We are making crypto usable for real-time daily purchases without the user ever knowing they are using blockchain.

---

## ✨ Key Features

### 1. Seamless Onboarding & Strict AML Compliance
We are building institutional-grade infrastructure with strict AML and KYC compliance hardcoded into our flow:
* **Bank KYC**: Users must pass KYC to get a local **UPI ID** for domestic Fiat-to-Fiat transfers.
* **Web3 KYC**: We connect to their MetaMask and run an on-chain security score (Gitcoin Passport mocked integration). Once cleared, we issue a global **PayTag** and spin up a secure, custodial **Internal Vault** on the Sepolia network.

### 2. Fiat On-Ramp & The Smart Bridge
* **Stripe Integration**: Dynamically detects the user's country. Mexican users deposit native Mexican Pesos.
* **Smart Bridge**: With one click, the smart contract automatically mints the equivalent amount of `pUSDC` directly into their internal vault. Bridge between local Fiat and L2 Crypto instantly, 24/7.

### 3. AI-Powered Global Remittances
* **Two Rails**: Users can send domestic payments via their local UPI ID, or global transfers using a recipient's PayTag.
* **AI Remittance Agent**: Just tell the AI: *"Send 10 USD to @vitalik"* and the AI handles the complex 4-step atomic transaction (Fiat -> Crypto -> Transfer -> Fiat) in under 12 seconds with zero gas fees. All executed on the Sepolia L2 and verifiable on Etherscan!

### 4. Global B2B Payments & Activity Logs
* **Real-time Activity Logs**: Track transactions with dynamic Sent/Received graphs.
* **Global Payments**: Pay for cinema tickets, Uber, or food globally using your crypto balance, while the merchant instantly receives their native Fiat currency.
* **Flash Loans**: Uncollateralized liquidity for zero-risk arbitrage trading in a single block execution.

---

## 🛠️ Tech Stack
* **Frontend**: React, TailwindCSS, Vite
* **Backend**: Node.js, Express.js, MongoDB
* **Web3**: ThirdWeb SDK, Sepolia Testnet, Solidity Smart Contracts (USDC Mock)
* **AI Integration**: Custom regex and external LLM APIs for Intent Parsing

---

## 💻 Running Locally

1. Clone the repository
2. Install dependencies for both client and backend:
   ```bash
   cd client && npm install
   cd ../backend && npm install
   ```
3. Start the development servers:
   ```bash
   # Terminal 1
   cd client && npm run dev
   
   # Terminal 2
   cd backend && npm run dev
   ```

---
*Submitted to the Ethereum Mexico 2026 Hackathon.*
