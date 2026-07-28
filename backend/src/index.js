import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './database/connect.js'; // ✅ FIXED IMPORT
import payRoutes from './routes/pay.js';


import authRoutes from './routes/auth.js';
import transactionRoutes from './routes/transactions.js';
import bankRoutes from './routes/bank.js';
import moneyTransferRoutes from './routes/moneyTransferRoutes.js';
import FLRoutes from './routes/flashLoan.js';

dotenv.config();

const app = express();

// Connect DB
connectDB();

// Middleware
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
  : ['*'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/bank', bankRoutes);
app.use('/api/money-transfer', moneyTransferRoutes);
app.use('/loan', FLRoutes);
app.use('/api/pay', payRoutes);

// Server
const PORT = process.env.PORT || 5550;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
