// server.js
import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import helmet from 'helmet';

import authRoutes from './src/routes/auth.js';
import bankRoutes from './src/routes/bank.js';
import flashLoanRoutes from './src/routes/flashLoan.js';
import moneyTransferRoutes from './src/routes/moneyTransferRoutes.js';
import payRoutes from './src/routes/pay.js'; // ✅ Import new pay route
import paymentRoutes from './src/routes/payment.js';
import aiAgentRoutes from './src/routes/aiAgentRoutes.js'; // ✅ AI Tool Calling Agent

import rateLimit from 'express-rate-limit';
import { idempotencyMiddleware } from './src/middleware/idempotencyMiddleware.js';
import { startBroadcastRecoveryWorker } from './src/workers/broadcastRecoveryWorker.js';
import { startScheduledPaymentWorker } from './src/workers/scheduledPaymentWorker.js';

// Load environment variables
dotenv.config();

// Initialize express
const app = express();

// ✅ Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://rpc.botchain.ai", "https://scan.botchain.ai"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

// ✅ CORS Middleware — origins from environment or localhost defaults
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5174'];

app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

// Rate Limiters
const shouldSkipLimit = () => process.env.NODE_ENV === 'development';

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  skip: shouldSkipLimit,
  message: { message: "Too many requests, please try again later." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  skipSuccessfulRequests: true,
  skip: shouldSkipLimit,
  message: { message: "Too many authentication attempts, please try again later." }
});

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  skip: shouldSkipLimit,
  message: { message: "Payment frequency limit exceeded. Please wait a minute." }
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  skipSuccessfulRequests: true,
  skip: shouldSkipLimit,
  message: { message: "AI agent rate limit exceeded. Please wait a minute." }
});

app.use(globalLimiter);

// ✅ Body size limit to prevent large payload DoS attacks
app.use(express.json({ limit: '1mb' }));

// ✅ Supabase Init (Workers Started)
console.log('✅ Supabase instance prepared successfully');
startBroadcastRecoveryWorker();
startScheduledPaymentWorker();

// ✅ Debugging Middleware (optional but helpful)
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ✅ Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/flashloan', flashLoanRoutes);
app.use('/api/money-transfer', paymentLimiter, idempotencyMiddleware, moneyTransferRoutes);
app.use('/api/pay', paymentLimiter, idempotencyMiddleware, payRoutes);
app.use('/api/payment', paymentLimiter, idempotencyMiddleware, paymentRoutes);
app.use('/api/agent', aiLimiter, idempotencyMiddleware, aiAgentRoutes); // ✅ AI Agent with dedicated rate limiter

// ✅ Default route
app.get('/', (req, res) => {
  res.send('Server is running 🚀');
});

// ✅ Global error handler — never expose stack traces or internal errors
app.use((err, req, res, _next) => {
  console.error(`[ERROR] ${req.method} ${req.url}:`, err.message);
  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({ message: 'An unexpected error occurred. Please try again.' });
});

// ✅ Start server
const PORT = process.env.PORT || 5550;
app.listen(PORT, () => console.log(`🚀 Server started on port ${PORT}`));
