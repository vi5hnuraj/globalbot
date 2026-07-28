import dotenv from 'dotenv';
dotenv.config();

// ✅ SECURITY: No hardcoded fallback secrets — all must come from environment
export const JWT_SECRET = process.env.JWT_SECRET;
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
export const BOTCHAIN_RPC_URL = process.env.BOTCHAIN_RPC_URL || 'https://rpc.botchain.ai';
export const BOTCHAIN_EXPLORER_URL = process.env.BOTCHAIN_EXPLORER_URL || 'https://scan.botchain.ai/';
export const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;

const requiredEnvVars = ['JWT_SECRET'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
  console.error(`❌ [FATAL SECURITY ERROR] Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('The application cannot start without these variables set in .env');
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.warn('⚠️ [SECURITY WARNING] ENCRYPTION_KEY is not set. Encryption features will be unavailable.');
}
