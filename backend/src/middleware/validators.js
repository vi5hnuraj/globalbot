import Joi from 'joi';

// ==================== Validation Middleware Factory ====================
export const validate = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.body, { abortEarly: false, stripUnknown: false });
  if (error) {
    const messages = error.details.map(d => d.message).join(', ');
    return res.status(400).json({ message: `Validation error: ${messages}` });
  }
  next();
};

export const validateQuery = (schema) => (req, res, next) => {
  const { error } = schema.validate(req.query, { abortEarly: false, stripUnknown: false });
  if (error) {
    const messages = error.details.map(d => d.message).join(', ');
    return res.status(400).json({ message: `Validation error: ${messages}` });
  }
  next();
};

// ==================== Shared Patterns ====================
const payTag = Joi.string().max(100).trim();
const walletAddress = Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).message('Invalid EVM wallet address');
const txHash = Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).message('Invalid transaction hash format');
const positiveAmount = Joi.number().positive().max(1e12).prefs({ convert: true });
const email = Joi.string().email().max(254);

// ==================== Auth Schemas ====================
export const registerSchema = Joi.object({
  email: email.required(),
  password: Joi.string().min(8).max(128).required(),
  name: Joi.string().min(1).max(100).trim().required()
});

export const loginSchema = Joi.object({
  email: email.required(),
  password: Joi.string().min(1).max(128).required()
});

export const refreshSessionSchema = Joi.object({
  refreshToken: Joi.string().min(10).max(2048).required()
});

// ==================== Wallet / Profile Schemas ====================
export const linkingSchema = Joi.object({
  upi: payTag.allow('', null),
  metamask: walletAddress.allow('', null),
  bankDetails: Joi.object().allow(null),
  region: Joi.string().max(50).allow('', null)
});

export const updateProfileSchema = Joi.object({
  name: Joi.string().max(100).trim().allow('', null),
  mob: Joi.string().max(20).allow('', null),
  age: Joi.number().integer().min(0).max(150).allow(null),
  dob: Joi.string().max(30).allow('', null),
  address: Joi.string().max(500).allow('', null),
  status: Joi.string().max(50).allow('', null)
});

export const updateExternalWalletSchema = Joi.object({
  walletAddress: walletAddress.allow('', null)
});

export const updatePrimaryWalletSchema = Joi.object({
  primaryReceivingWallet: Joi.string().valid('internal', 'external').required()
});

export const updateWalletSchema = Joi.object({
  internalWalletAddress: walletAddress.required(),
  signature: Joi.string().min(10).max(512).required(),
  forceMigration: Joi.boolean().allow(null)
});

export const walletChallengeSchema = Joi.object({}).unknown(true);

export const verifyWeb3KYCSchema = Joi.object({
  kycProvider: Joi.string().max(50).allow('', null),
  walletAddress: walletAddress.allow('', null)
});

// ==================== Payment Schemas ====================
export const createMoneyTransferSchema = Joi.object({
  senderUPI: payTag.required(),
  receiverUPI: payTag.required(),
  amount: positiveAmount.required(),
  savePercent: Joi.number().min(0).max(100).default(0),
  network: Joi.string().valid('fiat', 'sepolia', 'botchain').default('botchain'),
  senderWalletType: Joi.string().max(50).allow('', null),
  txHash: txHash.allow('', null)
});

export const paymentsWriteSchema = Joi.object({
  date: Joi.string().allow('', null),
  to: payTag.required(),
  sender: Joi.string().max(200).allow('', null),
  keyword: Joi.string().max(200).allow('', null),
  amt: Joi.number().min(0).max(1e12).allow(null),
  coin: Joi.string().max(20).allow('', null),
  txHash: txHash.required(),
  requestedAmount: Joi.number().min(0).max(1e12).allow(null),
  requestedCurrency: Joi.string().max(10).allow('', null),
  exchangeRateSnapshot: Joi.number().min(0).allow(null),
  botPriceSnapshot: Joi.number().min(0).allow(null),
  botAmountSnapshot: Joi.number().min(0).allow(null),
  receivingWalletType: Joi.string().max(50).allow('', null),
  senderWalletType: Joi.string().max(50).allow('', null),
  destinationAddress: walletAddress.allow('', null),
  reqId: Joi.string().uuid().allow('', null)
});

export const smartRouteSchema = Joi.object({
  amount: positiveAmount.required(),
  currency: Joi.string().max(10).allow('', null),
  payTag: payTag.required()
});

export const requestMoneyCreateSchema = Joi.object({
  name: Joi.string().max(200).allow('', null),
  sender: Joi.string().max(200).allow('', null),
  receiver: Joi.string().max(200).allow('', null),
  amount: positiveAmount.required(),
  currency: Joi.string().max(10).allow('', null)
});

// ==================== Bank Schemas ====================
export const addBankDetailsSchema = Joi.object({
  bankName: Joi.string().max(200).required(),
  ifscCode: Joi.string().max(50).required(),
  accountHolder: Joi.string().max(200).required(),
  accountAddress: Joi.string().max(500).allow('', null),
  accountType: Joi.string().valid('savings', 'current', 'checking').default('savings'),
  amount: Joi.number().min(0).max(1e15).required(),
  region: Joi.string().max(50).allow('', null),
  customPayTag: payTag.allow('', null)
});

export const swapSchema = Joi.object({
  amount: positiveAmount.required(),
  txHash: txHash.allow('', null)
});

export const bankLinkingSchema = Joi.object({
  upi: payTag.required(),
  metamask: walletAddress.required()
});

// ==================== Flash Loan Schemas ====================
export const flashLoanReadSchema = Joi.object({
  address: walletAddress.required()
});

export const flashLoanWriteSchema = Joi.object({
  address: walletAddress.required(),
  date: Joi.string().allow('', null),
  token: Joi.string().max(50).required(),
  amt: Joi.number().required(),
  pft: Joi.number().allow(null)
});

// ==================== Schedule Schemas ====================
export const storeContractFundingSchema = Joi.object({
  transferId: Joi.string().uuid().required(),
  txHash: txHash.required()
});

export const cancelContractFundingSchema = Joi.object({
  transferId: Joi.string().uuid().required(),
  cancelTxHash: txHash.required()
});

export const failContractFundingSchema = Joi.object({
  transferId: Joi.string().uuid().required()
});

export const releaseClaimedScheduleSchema = Joi.object({
  transferId: Joi.string().uuid().required(),
  txHash: txHash.required()
});

export const recoverStuckFundingSchema = Joi.object({
  transferId: Joi.string().uuid().required(),
  txHash: txHash.required()
});

// ==================== AI Agent Schema ====================
export const agentChatSchema = Joi.object({
  message: Joi.string().min(1).max(2000).trim().required(),
  timezoneOffset: Joi.number().integer().min(-840).max(840).optional()
});

// ==================== Checkout Schema ====================
export const checkoutSessionSchema = Joi.object({
  amount: positiveAmount.required()
});

export const verifySessionSchema = Joi.object({
  session_id: Joi.string().min(1).max(500).required()
});
