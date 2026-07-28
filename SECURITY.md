# Security Policy

## Secrets Management

GlobalPay stores all sensitive parameters, private keys, database credentials, API keys, and configurations strictly in environment variables.

> [!IMPORTANT]
> **Never commit `.env` or any files containing production secrets/credentials to the Git repository.** The `.gitignore` file has been configured to actively block tracking of any such files.

---

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please **do not** open a public issue. Instead, report it privately to the maintainers at [security@globalpay.platform](mailto:security@globalpay.platform). We will acknowledge and address the vulnerability promptly.

---

## Local Configuration Guide

To configure and run GlobalPay locally without exposing secrets, follow these steps:

### 1. Backend Setup
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Copy the template environment file:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in the placeholders. Minimal local setup requires:
   - `JWT_SECRET` (generate a random 64-character hex string)
   - `ENCRYPTION_KEY` (generate a random 64-character hex string)
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (if using Supabase Auth or database tables)
   - `BOTCHAIN_RPC_URL` (defaults to `https://rpc.botchain.ai` if left empty)
4. Install dependencies and start the backend:
   ```bash
   npm install
   npm run dev
   ```

### 2. Frontend (Client) Setup
1. Navigate to the `client` directory:
   ```bash
   cd ../client
   ```
2. Copy the template environment file:
   ```bash
   cp .env.example .env
   ```
3. Open `.env` and fill in:
   - `VITE_API_URL` (points to local backend, e.g. `http://localhost:5550/api`)
   - `VITE_BACKEND_URL` (e.g. `http://localhost:5550`)
   - `VITE_PRIVY_APP_ID` (your Privy application client ID)
4. Install dependencies and start the frontend:
   ```bash
   yarn install # or npm install
   npm run dev
   ```
