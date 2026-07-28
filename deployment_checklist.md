# GlobalPay Deployment & Environment Variable Checklist

This checklist documents every required environment variable needed to successfully deploy and run the GlobalPay platform in a production or staging environment.

---

## 1. Backend Environment Variables (Railway / Server Deployment)

When deploying the backend on **Railway** (or similar server hosting platforms), configure the following environment variables in the project's dashboard:

### Core Server Settings
- `PORT`: The port the backend server listens on (defaults to `5550`).
- `NODE_ENV`: Set to `production` in live environments, or `development` in sandbox/local.
- `CORS_ORIGINS`: A comma-separated list of allowed frontend origins (e.g., `https://globalpay.platform,https://globalpay-admin.platform`).

### Database & Security Secrets
- `JWT_SECRET`: A secure, high-entropy random hex string (64 characters) used to sign and verify JSON Web Tokens.
- `ENCRYPTION_KEY`: A secure random hex string (64 characters, distinct from `JWT_SECRET`) used for AES-256 private key encryption at rest.

### Supabase Integration
- `SUPABASE_URL`: The API URL of your Supabase project (e.g., `https://mwkkufjcpjfjjuempxao.supabase.co`).
- `SUPABASE_ANON_KEY`: The anonymous client key for Supabase database access.
- `SUPABASE_SERVICE_ROLE_KEY`: The secret service role key (bypasses RLS policies) used securely on the backend for admin database operations.
- `SUPABASE_DATABASE_URL`: The direct PostgreSQL connection string (e.g., `postgresql://postgres:[password]@db.[id].supabase.co:5432/postgres`) used by internal database scripts.

### Privy Wallet Auth
- `PRIVY_APP_ID`: Your Privy Application ID (e.g., `cmryjkzbw00100clbtlgi5wpi`).
- `PRIVY_APP_SECRET`: The confidential server-side Privy App Secret.

### BOT Chain Blockchain Network
- `BOTCHAIN_CHAIN_NAME`: The target EVM chain name (e.g., `"BOT Chain"`).
- `BOTCHAIN_CHAIN_ID`: The target EVM chain ID (e.g., `677` for Mainnet, `968` for Testnet).
- `BOTCHAIN_RPC_URL`: The EVM JSON-RPC provider endpoint (e.g., `https://rpc.botchain.ai`).
- `BOTCHAIN_EXPLORER_URL`: The blockchain block explorer URL (e.g., `https://scan.botchain.ai/`).
- `BOTCHAIN_SYMBOL`: The native currency symbol (e.g., `"BOT"`).
- `PAYMENT_MODE`: Active payment token mode (e.g., `"BOT"`).

### Smart Contract Addresses & Web3 Signers
- `GLOBAL_PAY_MANAGER_ADDRESS`: The deployed GlobalPayPaymentManager smart contract address.
- `RELAYER_PRIVATE_KEY`: The private key of the server relayer wallet that signs transaction batches and automates scheduled payments.
- `TREASURY_PRIVATE_KEY`: The private key of the system treasury wallet used to fund user transactions and deploy contracts.

### External Integrations
- `STRIPE_SECRET_KEY`: The secret API key of your Stripe account (for fiat card processing).
- `GROQ_API_KEY`: The API key for Groq AI assistant remittance routing.
- `OPENAI_API_KEY`: The API key for OpenAI GPT features (if enabled).
- `MONGO_URL` / `MONGO_URI`: Connection strings for legacy Mongo database scripts (if run).

---

## 2. Frontend Environment Variables (Vercel / Client Deployment)

When deploying the frontend on **Vercel** (or similar static hosting platforms), configure these environment variables in the project's dashboard. All variables must be prefixed with `VITE_` to be bundled by the Vite bundler:

### API Endpoints
- `VITE_BACKEND_URL`: The root URL of the deployed backend server (e.g., `https://globalpay-backend.railway.app`).
- `VITE_API_URL`: The full API path of the backend server (e.g., `https://globalpay-backend.railway.app/api`).

### Privy Web3 Auth
- `VITE_PRIVY_APP_ID`: The public Privy Application ID.

### Wallet Connector SDKs
- `VITE_WALLETCONNECT_PROJECT_ID`: Your WalletConnect cloud portal project ID.
- `VITE_THIRDWEB_CLIENT_ID`: Your ThirdWeb SDK public client ID (if thirdweb wallet connectors are used).

### Moralis Indexing API
- `VITE_MORALIS_API_KEY`: The public/client API key for Moralis block indexer.

### BOT Chain Blockchain Config
- `VITE_BOTCHAIN_CHAIN_NAME`: The public chain name (e.g., `"BOT Chain"`).
- `VITE_BOTCHAIN_CHAIN_ID`: The public chain ID (e.g., `677`).
- `VITE_BOTCHAIN_RPC_URL`: The public EVM RPC endpoint (e.g., `https://rpc.botchain.ai`).
- `VITE_BOTCHAIN_EXPLORER_URL`: The block explorer base URL.
- `VITE_BOTCHAIN_SYMBOL`: The public currency symbol.
- `VITE_PAYMENT_MODE`: Active payment mode.

### Supabase Config
- `SUPABASE_URL`: The public Supabase project API URL.
- `SUPABASE_ANON_KEY`: The public anonymous client API key.

### Smart Contract Addresses
- `VITE_GLOBAL_PAY_MANAGER_ADDRESS`: The public smart contract address for payment routing.

### AI Integrations
- `VITE_GEMINI_API_KEY`: The public API Key for Google Gemini (for the chatbot financial recommendations feature).
