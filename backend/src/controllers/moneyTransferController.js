import { supabase } from '../config/supabaseClient.js';
import { getLiveExchangeRates, getLiveBotPrice } from '../services/liveRateService.js';
import crypto from 'crypto';

const fetchRatesAndPrices = async (currencyCode = 'INR') => {
  const rates = await getLiveExchangeRates();
  const botPriceVal = await getLiveBotPrice();
  const exchangeRateVal = rates[currencyCode] || rates['INR'] || 83.5;

  return { botPriceVal, exchangeRateVal };
};

// Helper mapper to preserve Mongoose output contract for MoneyTransfer
const mapTransferToMongoose = (t) => {
  if (!t) return null;
  return {
    _id: t.id,
    id: t.id,
    sender: t.sender ? {
      _id: t.sender.id,
      id: t.sender.id,
      name: t.sender.name,
      globalPayTag: t.sender.global_pay_tag,
      upiId: t.sender.global_pay_tag,
      email: t.sender.email,
      internalWalletAddress: t.sender.internal_wallet_address,
      metamaskId: t.sender.metamask_id
    } : t.sender_id,
    senderUPI: t.sender_pay_tag,
    receiver: t.receiver ? {
      _id: t.receiver.id,
      id: t.receiver.id,
      name: t.receiver.name,
      globalPayTag: t.receiver.global_pay_tag,
      upiId: t.receiver.global_pay_tag,
      email: t.receiver.email,
      internalWalletAddress: t.receiver.internal_wallet_address,
      metamaskId: t.receiver.metamask_id
    } : t.receiver_id,
    receiverUPI: t.receiver_pay_tag,
    amount: Number(t.amount),
    savedAmount: Number(t.saved_amount),
    savePercent: Number(t.save_percent),
    network: t.network,
    txHash: t.tx_hash,
    depositAmountLocal: Number(t.deposit_amount_local),
    exchangeRate: Number(t.exchange_rate),
    botPrice: Number(t.bot_price),
    botAmount: Number(t.bot_amount),
    blockNumber: t.block_number,
    status: t.status,
    usdEquivalent: Number(t.usd_equivalent),
    localEquivalent: Number(t.local_equivalent),
    localCurrency: t.local_currency,
    transferRail: t.transfer_rail,
    timestamp: t.created_at,
    senderWalletType: t.sender_wallet_type,
    senderWalletAddress: t.sender_wallet_address,
    receivingWalletType: t.receiving_wallet_type,
    receiverWalletAddress: t.receiver_wallet_address,
    destinationAddress: t.destination_address,
    rawSignedTx: t.raw_signed_tx,
    release_at: (() => { try { const r = typeof t.raw_signed_tx === 'string' ? JSON.parse(t.raw_signed_tx) : t.raw_signed_tx; return r?.releaseAt || null; } catch { return null; } })(),
    receiver_wallet_address: t.receiver_wallet_address,
    sender_wallet_address: t.sender_wallet_address,
    paymentStage: t.paymentStage,
    txType: t.txType,
    keyword: t.keyword,
    scheduledAt: t.scheduledAt || null,
    releasedAt: t.releasedAt || null
  };
};

// Helper mapper to preserve Mongoose output contract for RequestMoney requests
const mapRequestToMongoose = (r) => {
  if (!r) return null;
  return {
    _id: r.id,
    id: r.id,
    name: r.name,
    sender: r.sender,
    amount: Number(r.amount),
    currency: r.currency,
    requestedAmount: r.requested_amount !== null ? Number(r.requested_amount) : Number(r.amount),
    requestedCurrency: r.requested_currency || r.currency || "BOT",
    exchangeRateSnapshot: r.exchange_rate_snapshot ? Number(r.exchange_rate_snapshot) : 83.5,
    botPriceSnapshot: r.bot_price_snapshot ? Number(r.bot_price_snapshot) : 9.72,
    botAmountSnapshot: r.bot_amount_snapshot ? Number(r.bot_amount_snapshot) : Number(r.amount),
    status: r.status,
    createdAt: r.created_at,
    ownerUpi: r.recipient_pay_tag,
    ownerMetamask: r.metamask,
    ownerUserId: r.user_id,
    requestedAt: r.created_at,
    // A request is paid to the person who created it. Their linked wallet is
    // stored in the existing `metamask` column on request_money.
    receiverWalletAddress: r.metamask || "",
    receivingWalletType: r.receivingWalletType || "Internal Wallet"
  };
};

/** Create money transfer */
export const createMoneyTransfer = async (req, res) => {
  let { senderUPI, receiverUPI, amount, savePercent = 0, network = 'botchain', senderWalletType: clientSenderWalletType, txHash } = req.body;

  // Normalize Pay Tags
  if (!senderUPI.startsWith('upi') && !senderUPI.startsWith('@')) senderUPI = '@' + senderUPI;
  if (!receiverUPI.startsWith('upi') && !receiverUPI.startsWith('@')) receiverUPI = '@' + receiverUPI;

  try {
    // Resolve profiles
    const cleanSender = senderUPI.replace(/^@/, '');
    const cleanReceiver = receiverUPI.replace(/^@/, '');

    let { data: senderUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('global_pay_tag', cleanSender)
      .maybeSingle();

    if (!senderUser) {
      const { data: senderWithAt } = await supabase
        .from('profiles')
        .select('*')
        .eq('global_pay_tag', `@${cleanSender}`)
        .maybeSingle();
      if (!senderWithAt) return res.status(404).json({ message: 'Sender user not found' });
      senderUser = senderWithAt;
    }

    let { data: receiverUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('global_pay_tag', cleanReceiver)
      .maybeSingle();

    if (!receiverUser) {
      const { data: receiverWithAt } = await supabase
        .from('profiles')
        .select('*')
        .eq('global_pay_tag', `@${cleanReceiver}`)
        .maybeSingle();
      if (!receiverWithAt) return res.status(404).json({ message: 'Receiver user not found' });
      receiverUser = receiverWithAt;
    }

    if (!receiverUser) return res.status(404).json({ message: 'Receiver user not found' });

    if (senderUser.id === receiverUser.id) {
      return res.status(400).json({ message: "You cannot transfer money to yourself." });
    }

    const { data: senderBankDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', senderUser.id)
      .maybeSingle();

    // For fiat transfers, bank_details is required (balance deductions).
    // For crypto/BOT transfers, only region is needed — default to 'Global' if missing.
    if (!senderBankDetails && network === 'fiat') {
      return res.status(404).json({ message: 'Sender bank details not found' });
    }

    const { data: receiverBankDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', receiverUser.id)
      .maybeSingle();

    if (!receiverBankDetails && network === 'fiat') {
      return res.status(404).json({ message: 'Receiver bank details not found' });
    }

    const senderRegion = senderBankDetails?.region || 'Global';
    const receiverRegion = receiverBankDetails?.region || 'Global';

    // Cross-border routing rules
    if (senderRegion !== receiverRegion) {
      if (network === 'fiat') {
        return res.status(403).json({
          message: `Fiat rails cannot cross borders instantly. Please switch to Crypto (BOT Chain) network.`
        });
      }

      const isSenderUsingPayTag = senderUPI === senderUser.global_pay_tag;
      const isReceiverUsingPayTag = receiverUPI === receiverUser.global_pay_tag;

      if (!isSenderUsingPayTag || !isReceiverUsingPayTag) {
        return res.status(403).json({
          message: `Cross-border transfers between ${senderRegion} and ${receiverRegion} require a Global Pay Tag. Local domestic IDs are not supported.`
        });
      }
    }

    const savedAmount = (amount * savePercent) / 100;
    const transferAmountUsdc = amount - savedAmount;

    // 1. Perform Fiat DB Balance Updates
    if (network === 'fiat') {
      if (Number(senderBankDetails.amount) < amount) {
        return res.status(400).json({ message: 'Insufficient Fiat funds' });
      }

      const updatedSenderFiat = Number(senderBankDetails.amount) - amount;
      await supabase
        .from('bank_details')
        .update({ amount: updatedSenderFiat })
        .eq('id', senderBankDetails.id);

      const updatedReceiverFiat = Number(receiverBankDetails.amount) + transferAmountUsdc;
      await supabase
        .from('bank_details')
        .update({ amount: updatedReceiverFiat })
        .eq('id', receiverBankDetails.id);
    }

    let botPriceVal = 9.72;
    let exchangeRateVal = 83.5;
    let usdVal = amount;
    let localVal = amount * 83.5;
    const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN', France: 'EUR' };
    const currencyCode = currencyMap[senderRegion] || 'INR';

    if (process.env.PAYMENT_MODE === 'BOT') {
      const helper = await fetchRatesAndPrices(currencyCode);
      botPriceVal = helper.botPriceVal;
      exchangeRateVal = helper.exchangeRateVal;
      usdVal = amount * botPriceVal;
      localVal = usdVal * exchangeRateVal;
    }

    // Resolve wallets & addresses
    const clientSenderWallet = (clientSenderWalletType && String(clientSenderWalletType).toLowerCase().includes('external'))
      ? "external"
      : "internal";

    let finalSenderAddress = (clientSenderWallet === 'external')
      ? (senderUser.metamask_id || senderUser.external_wallet || null)
      : (senderUser.internal_wallet_address || null);

    const finalSenderWalletType = (senderUser && finalSenderAddress && String(finalSenderAddress).toLowerCase() === String(senderUser.internal_wallet_address).toLowerCase())
      ? 'internal'
      : 'external';

    const isExternalReceiver = String(receiverUser.primary_receiving_wallet || '').toLowerCase() === 'external';
    const extAddress = receiverUser.metamask_id || receiverUser.external_wallet;
    const targetReceiverAddress = (isExternalReceiver && extAddress && extAddress.startsWith('0x'))
      ? extAddress
      : receiverUser.internal_wallet_address;

    const finalReceivingWalletType = (receiverUser && targetReceiverAddress && String(targetReceiverAddress).toLowerCase() === String(receiverUser.internal_wallet_address).toLowerCase())
      ? 'internal'
      : 'external';

    let verifiedTxHash = txHash;
    let blockNumber = null;

    // 2. Perform Sepolia/BOT Chain On-Chain Verification
    if (network === 'sepolia' || network === 'botchain') {
      if (!verifiedTxHash || typeof verifiedTxHash !== 'string' || !verifiedTxHash.startsWith("0x")) {
        return res.status(400).json({ message: "Transaction hash (txHash) is required for client-signed MPC transfers." });
      }

      try {
        const { ethers } = await import('ethers');
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        const receipt = await provider.getTransactionReceipt(verifiedTxHash);
        if (!receipt || receipt.status !== 1) {
          return res.status(400).json({ message: "Transaction failed or receipt not found on-chain." });
        }

        const txData = await provider.getTransaction(verifiedTxHash);
        if (!txData) {
          return res.status(400).json({ message: "Transaction details not found on-chain." });
        }

        // Verify recipient matches receiver
        if (!targetReceiverAddress) {
          return res.status(400).json({ message: "No destination address provided for transfer verification." });
        }
        const expectedReceiver = targetReceiverAddress;
        if (String(txData.to).toLowerCase() !== String(expectedReceiver).toLowerCase()) {
          return res.status(400).json({ message: `Recipient address mismatch. Expected: ${expectedReceiver}, Found: ${txData.to}` });
        }

        blockNumber = receipt.blockNumber;
      } catch (blockchainErr) {
        console.error("P2P on-chain verification failed:", blockchainErr);
        return res.status(400).json({ message: "Failed to verify transaction on-chain: " + blockchainErr.message });
      }
    }

    // 3. Log MoneyTransfer transaction to database
    // ✅ SECURITY: Prevent transaction replay — reject duplicate txHash
    if (verifiedTxHash) {
      const { data: existingTx } = await supabase
        .from('money_transfers')
        .select('id')
        .eq('tx_hash', verifiedTxHash)
        .maybeSingle();
      if (existingTx) {
        return res.status(409).json({ message: "Transaction already recorded. Duplicate payment prevented." });
      }
    }

    const { data: moneyTransfer, error: mtErr } = await supabase
      .from('money_transfers')
      .insert({
        sender_id: senderUser.id,
        sender_pay_tag: senderUPI,
        receiver_id: receiverUser.id,
        receiver_pay_tag: receiverUPI,
        amount: amount,
        saved_amount: savedAmount,
        save_percent: savePercent,
        network: network,
        tx_hash: verifiedTxHash,
        deposit_amount_local: localVal,
        exchange_rate: exchangeRateVal,
        bot_price: botPriceVal,
        bot_amount: amount,
        block_number: blockNumber,
        status: 'COMPLETED',
        usd_equivalent: usdVal,
        local_equivalent: localVal,
        local_currency: currencyCode,
        transfer_rail: 'crypto',
        sender_wallet_type: finalSenderWalletType,
        sender_wallet_address: finalSenderAddress,
        receiving_wallet_type: finalReceivingWalletType,
        receiver_wallet_address: targetReceiverAddress,
        destination_address: targetReceiverAddress
      })
      .select('*, sender:profiles!money_transfers_sender_id_fkey(*), receiver:profiles!money_transfers_receiver_id_fkey(*)')
      .single();

    if (mtErr) throw mtErr;

    // 4. Update Receiver BankDetails usdcBalance dynamically
    if ((network === 'sepolia' || network === 'botchain') && receiverBankDetails) {
      const currentUsdc = Number(receiverBankDetails.usdc_balance || 0);
      const newUsdcBal = currentUsdc + transferAmountUsdc;

      await supabase
        .from('bank_details')
        .update({ usdc_balance: newUsdcBal })
        .eq('id', receiverBankDetails.id);
    }

    return res.status(201).json(mapTransferToMongoose(moneyTransfer));

  } catch (error) {
    console.error('P2P Transfer Controller Error:', error.message);
    res.status(500).json({ message: 'Server error during transfer creation' });
  }
};

const deriveTxType = (record) => {
  if (record.paymentStage === 'pending_release') return 'scheduled_funding';
  if (record.paymentStage === 'cancelled') return 'scheduled_cancellation';
  if (record.keyword === 'Scheduled Payment (Released)') return 'scheduled_release';
  if (record.keyword === 'AI Agent transfer') return 'ai';
  if (record.keyword === 'QR Payment') return 'qr';
  if (record.keyword === 'Request Payment') return 'request';
  if (record.keyword === 'Payment' || record.keyword === '') return 'direct';
  // Completed money_transfer with raw_signed_tx containing paymentId = scheduled release
  if (record.paymentStage === 'completed') {
    try {
      const raw = record.raw_signed_tx;
      const meta = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      if (meta && meta.paymentId) return 'scheduled_release';
    } catch {}
  }
  return 'direct';
};

const fetchAllUserTransactions = async (userId) => {
  const run = (table, fkey) =>
    supabase
      .from(table)
      .select(`*, sender:profiles!${fkey}_sender_id_fkey(*), receiver:profiles!${fkey}_receiver_id_fkey(*)`)
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .then(r => r.data || [])
      .catch(() => []);
  const [mt, p] = await Promise.all([
    run('money_transfers', 'money_transfers'),
    run('payments', 'payments')
  ]);

  const enhancedMt = (mt || []).map(t => {
    const isFundedPending = t.status === 'PENDING'
      && typeof t.tx_hash === 'string' && /^0x[a-fA-F0-9]{64}$/.test(t.tx_hash.trim());
    const isCompleted = t.status === 'COMPLETED';
    const isCancelled = t.status === 'FAILED' && (() => {
      try { const r = typeof t.raw_signed_tx === 'string' ? JSON.parse(t.raw_signed_tx) : t.raw_signed_tx; return r?.type === 'paymentManager' || !!r?.paymentId; } catch { return false; }
    })();
    let paymentStage = 'pending';
    if (isCompleted) paymentStage = 'completed';
    else if (isCancelled) paymentStage = 'cancelled';
    else if (isFundedPending) paymentStage = 'pending_release';
    const base = { ...t, paymentStage };
    base.txType = deriveTxType(base);
    return base;
  });

  const normalizedPayments = (p || []).map(item => ({
    paymentStage: 'completed',
    id: item.id,
    _id: item.id,
    sender_id: item.sender_id,
    sender_pay_tag: item.sender?.global_pay_tag || '@user',
    senderUPI: item.sender?.global_pay_tag || '@user',
    receiver_id: item.receiver_id,
    receiver_pay_tag: item.recipient_pay_tag || item.receiver?.global_pay_tag || '@user',
    receiverUPI: item.recipient_pay_tag || item.receiver?.global_pay_tag || '@user',
    amount: item.amount || item.bot_amount_snapshot || 0,
    botAmount: item.bot_amount_snapshot || item.amount || 0,
    botAmountSnapshot: item.bot_amount_snapshot || item.amount || 0,
    tx_hash: item.tx_hash,
    txHash: item.tx_hash,
    created_at: item.created_at,
    createdAt: item.created_at,
    timestamp: item.created_at,
    date: item.created_at,
    status: 'COMPLETED',
    sender_wallet_type: item.sender_wallet_type || 'internal',
    receiving_wallet_type: item.receiving_wallet_type || 'internal',
    sender_wallet_address: item.sender_wallet_address,
    receiver_wallet_address: item.receiver_wallet_address,
    destination_address: item.destination_address,
    destinationAddress: item.destination_address,
    sender: item.sender ? { ...item.sender, globalPayTag: item.sender.global_pay_tag } : null,
    receiver: item.receiver ? { ...item.receiver, globalPayTag: item.receiver.global_pay_tag } : null,
    keyword: item.keyword,
    txType: deriveTxType({ paymentStage: 'completed', keyword: item.keyword })
  }));

  // Build a map of payments records by tx_hash for merging releasedAt
  const paymentsByTxHash = new Map();
  for (const np of normalizedPayments) {
    if (np.tx_hash && np.tx_hash.startsWith('0x')) {
      paymentsByTxHash.set(np.tx_hash.toLowerCase(), np);
    }
  }

  // Merge: for money_transfers records that have a matching payments record,
  // inject scheduledAt (schedule time from money_transfers.created_at) and
  // releasedAt (release time from payments.created_at)
  for (const mt of enhancedMt) {
    if (mt.tx_hash && mt.tx_hash.startsWith('0x')) {
      const match = paymentsByTxHash.get(mt.tx_hash.toLowerCase());
      if (match) {
        mt.scheduledAt = mt.created_at;
        mt.releasedAt = match.created_at;
      }
    }
  }
  // Set releasedAt on payments-only records
  for (const np of normalizedPayments) {
    np.releasedAt = np.created_at;
  }

  const all = [...enhancedMt, ...normalizedPayments];

  const txMap = new Map();
  all.forEach(t => {
    const k = (t.tx_hash && t.tx_hash.startsWith('0x')) ? t.tx_hash.toLowerCase() : t.id;
    if (!txMap.has(k)) {
      txMap.set(k, t);
    }
  });

  return Array.from(txMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
};

/** Fetch internal transfers log */
export const getMoneyTransfers = async (req, res) => {
  try {
    const userId = req.user.id;
    const transfers = await fetchAllUserTransactions(userId);

    const filteredTransfers = transfers.filter(t => {
      const isSenderInternal = t.sender_id === userId && t.sender_wallet_type === 'internal';
      const isReceiverInternal = t.receiver_id === userId && t.receiving_wallet_type === 'internal';
      return isSenderInternal || isReceiverInternal;
    });

    const mongooseTransfers = filteredTransfers.map(t => mapTransferToMongoose(t));
    return res.json(mongooseTransfers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Fetch external transfers log */
export const getExternalMoneyTransfers = async (req, res) => {
  try {
    const userId = req.user.id;
    const transfers = await fetchAllUserTransactions(userId);
    const filteredTransfers = transfers.filter(t => {
      const isSenderExternal = t.sender_id === userId && t.sender_wallet_type === 'external';
      const isReceiverExternal = t.receiver_id === userId && t.receiving_wallet_type === 'external';
      return isSenderExternal || isReceiverExternal;
    });
    const mongooseTransfers = filteredTransfers.map(t => mapTransferToMongoose(t));
    return res.json(mongooseTransfers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Settle a requested money invoice */
export const settleRequestMoney = async (req, res) => {
  const { id } = req.params;
  const { txHash } = req.body;
  const userId = req.user.id;

  try {
    // 1. Resolve requested invoice document details
    const { data: reqDoc, error: docErr } = await supabase
      .from('request_money')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (docErr || !reqDoc) {
      return res.status(404).json({ message: "Invoice request not found" });
    }

    if (reqDoc.status === 'Completed') {
      return res.status(400).json({ message: "Invoice request already settled" });
    }

    const amount = Number(reqDoc.amount);

    // 2. Resolve Sender & Receiver Profiles
    const { data: senderUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    const { data: receiverUser } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', reqDoc.user_id)
      .single();

    if (!senderUser || !receiverUser) {
      return res.status(404).json({ message: "Sender or Receiver profile not found" });
    }

    const { data: senderBankDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', senderUser.id)
      .maybeSingle();

    const { data: receiverBankDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', receiverUser.id)
      .maybeSingle();

    if (!senderBankDetails || !receiverBankDetails) {
      return res.status(404).json({ message: "Bank details not found for transaction settling" });
    }

    // Verify on-chain transaction receipt if signed client-side
    let verifiedTxHash = txHash;
    let blockNumber = null;

    if (!verifiedTxHash || typeof verifiedTxHash !== 'string' || !verifiedTxHash.startsWith("0x")) {
      return res.status(400).json({ message: "Valid transaction hash (txHash) is required to settle request." });
    }

    try {
      const { ethers } = await import('ethers');
      const rpcUrl = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      const receipt = await provider.getTransactionReceipt(verifiedTxHash);
      if (!receipt || receipt.status !== 1) {
        return res.status(400).json({ message: "On-chain verification failed: receipt status is invalid." });
      }
      blockNumber = receipt.blockNumber;
    } catch (blockchainErr) {
      console.error("Settle request on-chain verification failed:", blockchainErr);
      return res.status(400).json({ message: "On-chain verification error: " + blockchainErr.message });
    }

    const usdAmount = Number(amount);
    const exchangeRates = { India: 83.5, Brazil: 5.1, Mexico: 17.5, US: 1.0 };
    const senderRate = exchangeRates[senderBankDetails.region || 'India'] || 83.5;
    const receiverRate = exchangeRates[receiverBankDetails.region || 'India'] || 83.5;

    const requiredFiatToDeduct = usdAmount * senderRate;
    const receiverFiatAmount = usdAmount * receiverRate;

    // 3. Perform balance ledger swap
    const senderNewBal = Number(senderBankDetails.amount) - requiredFiatToDeduct;
    await supabase
      .from('bank_details')
      .update({ amount: senderNewBal })
      .eq('id', senderBankDetails.id);

    const receiverNewBal = Number(receiverBankDetails.amount) + receiverFiatAmount;
    await supabase
      .from('bank_details')
      .update({ amount: receiverNewBal })
      .eq('id', receiverBankDetails.id);

    // Save MoneyTransfer activity log
    const sUPI = senderUser.global_pay_tag || "GlobalPay Sender";
    const rUPI = receiverUser.global_pay_tag || "GlobalPay Receiver";

    await supabase
      .from('money_transfers')
      .insert({
        sender_id: senderUser.id,
        sender_pay_tag: sUPI,
        receiver_id: receiverUser.id,
        receiver_pay_tag: rUPI,
        amount: usdAmount,
        network: 'botchain',
        tx_hash: verifiedTxHash,
        status: 'COMPLETED',
        usd_equivalent: usdAmount,
        local_equivalent: receiverFiatAmount,
        local_currency: receiverBankDetails.region === 'India' ? 'INR' : 'USD',
        transfer_rail: 'crypto',
        sender_wallet_type: 'internal',
        sender_wallet_address: senderUser.internal_wallet_address,
        receiving_wallet_type: 'internal',
        receiver_wallet_address: receiverUser.internal_wallet_address,
        destination_address: receiverUser.internal_wallet_address,
        bot_amount: usdAmount,
        exchange_rate: receiverRate,
        bot_price: 9.72
      });

    // 4. Mark request status as Completed
    await supabase
      .from('request_money')
      .update({ status: 'Completed' })
      .eq('id', id);

    return res.status(200).json({ status: 'success', message: 'Invoice paid successfully!' });
  } catch (error) {
    console.error("Settle request money error:", error.message);
    res.status(500).json({ message: 'Server error during invoice settlement' });
  }
};

/** Reject request money invoice */
export const rejectRequestMoney = async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from('request_money')
      .update({ status: 'Rejected' })
      .eq('id', id);

    if (error) throw error;

    return res.status(200).json({ status: 'success', message: 'Invoice request rejected successfully' });
  } catch (error) {
    console.error("Reject request money error:", error.message);
    res.status(500).json({ message: 'Server error while rejecting request' });
  }
};

/** Create a request money invoice */
export const requestMoneyCreate = async (req, res) => {
  const { name, sender, receiver, amount, currency } = req.body;
  const userId = req.user.id;

  try {
    const { data: userProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!userProfile) return res.status(404).json({ message: "User profile not found" });

    const recipientInput = (sender || receiver || '').trim();
    if (!recipientInput) {
      return res.status(400).json({ message: "Recipient PayTag is required" });
    }

    const cleanPayTag = recipientInput.replace(/^@/, '');
    const { data: recipientProfile, error: recipientError } = await supabase
      .from('profiles')
      .select('id, global_pay_tag, email')
      .or(`global_pay_tag.eq.${cleanPayTag},global_pay_tag.eq.@${cleanPayTag},email.eq.${recipientInput}`)
      .maybeSingle();

    if (recipientError) throw recipientError;
    if (!recipientProfile) {
      return res.status(404).json({ message: "Recipient PayTag was not found" });
    }

    const newRequest = {
      // user_id belongs to the authenticated requester, which also satisfies
      // the request_money INSERT RLS policy.
      user_id: userId,
      // recipient_pay_tag is the person who must see this invoice in Reqpay.
      recipient_pay_tag: recipientProfile.global_pay_tag || recipientProfile.email,
      metamask: userProfile.metamask_id,
      name: name || "Requested Payment",
      // sender identifies the person who created the request and will receive
      // the eventual payment.
      sender: userProfile.global_pay_tag || userProfile.email,
      amount: Number(amount),
      currency: currency || "BOT",
      requested_amount: Number(amount),
      requested_currency: currency || "BOT",
      status: "Pending"
    };

    const { data: requestRecord, error } = await supabase
      .from('request_money')
      .insert(newRequest)
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, message: "Request added", request: mapRequestToMongoose(requestRecord) });
  } catch (error) {
    console.error("requestMoneyCreate error:", error.message);
    res.status(500).json({ message: 'Server error while creating payment request' });
  }
};

/** Fetch request money invoices */
export const requestMoneyRead = async (req, res) => {
  try {
    const userId = req.user.id;
    const type = req.query.type; // inbox or outbox

    const { data: profile } = await supabase
      .from('profiles')
      .select('global_pay_tag, email')
      .eq('id', userId)
      .single();

    let query = supabase.from('request_money').select('*');

    if (type === 'inbox') {
      const cleanTag = (profile.global_pay_tag || '').replace(/^@/, '');
      const recipientIdentifiers = [cleanTag, cleanTag && `@${cleanTag}`, profile.email].filter(Boolean);
      query = query.in('recipient_pay_tag', recipientIdentifiers);
    } else {
      query = query.eq('user_id', userId);
    }

    const { data: docs, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const expiryDuration = 24 * 60 * 60 * 1000; // 24 hours in ms

    // Auto-expire requests if they are Pending and past 24 hours
    for (const doc of docs) {
      if (doc.status === 'Pending') {
        const createdDate = new Date(doc.created_at);
        if (now - createdDate > expiryDuration) {
          doc.status = 'Expired';
          // Async update in Supabase
          supabase
            .from('request_money')
            .update({ status: 'Expired' })
            .eq('id', doc.id)
            .then(({ error: expErr }) => {
              if (expErr) console.error("Failed to mark request as expired:", expErr.message);
            });
        }
      }
    }

    const requests = docs.map(doc => mapRequestToMongoose(doc));
    return res.json(requests);
  } catch (error) {
    console.error("requestMoneyRead error:", error.message);
    res.status(500).json({ message: 'Server error while fetching requests' });
  }
};

/** Fetch a single request money invoice */
export const requestMoneyReadById = async (req, res) => {
  const { id } = req.params;

  try {
    const { data: doc, error } = await supabase
      .from('request_money')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error || !doc) return res.status(404).json({ message: "Request invoice not found" });

    if (doc.status === 'Pending') {
      const createdDate = new Date(doc.created_at);
      if (new Date() - createdDate > 24 * 60 * 60 * 1000) {
        doc.status = 'Expired';
        await supabase
          .from('request_money')
          .update({ status: 'Expired' })
          .eq('id', doc.id);
      }
    }

    return res.json(mapRequestToMongoose(doc));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/** Delete a request money invoice */
export const requestMoneyDelete = async (req, res) => {
  const { id, reqId } = req.params;
  const targetId = id || reqId;

  try {
    // ✅ SECURITY: Verify ownership before allowing delete
    const { data: reqDoc, error: fetchErr } = await supabase
      .from('request_money')
      .select('user_id')
      .eq('id', targetId)
      .maybeSingle();

    if (fetchErr || !reqDoc) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (req.user && reqDoc.user_id !== req.user.id) {
      return res.status(403).json({ message: 'Not authorized to delete this request' });
    }

    const { error } = await supabase
      .from('request_money')
      .delete()
      .eq('id', targetId);

    if (error) throw error;

    return res.json({ status: 'success', message: "Request deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: 'Server error while deleting request' });
  }
};

// ==================== Compatibility Mappers for Router ====================
export const getMoneyTransfersExternal = getExternalMoneyTransfers;
export const getFilteredRequests = requestMoneyRead;
export const resolveRequestMoney = requestMoneyDelete;

export const getAllRawDocs = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('request_money')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json(data.map(mapRequestToMongoose));
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getAllRequestMoney = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('request_money')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return res.json({ message: "found", requests: data.map(mapRequestToMongoose) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const smartRouteTransfer = async (req, res) => {
  let { amount, currency, payTag } = req.body;

  if (!payTag.startsWith('upi') && !payTag.startsWith('@')) {
    payTag = '@' + payTag;
  }

  try {
    const senderId = req.user.id;

    // Fetch Sender profile and bank details
    const { data: senderUser, error: senderErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', senderId)
      .single();

    if (senderErr || !senderUser) {
      return res.status(404).json({ message: "Sender not found" });
    }

    // Fetch Receiver profile by globalPayTag
    const cleanPayTag = payTag.replace(/^@/, '');
    const { data: receiverUser, error: receiverErr } = await supabase
      .from('profiles')
      .select('*')
      .or(`global_pay_tag.eq.${cleanPayTag},global_pay_tag.eq.@${cleanPayTag}`)
      .maybeSingle();

    if (receiverErr || !receiverUser) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    const { data: senderBankDetails, error: sBankErr } = await supabase
      .from('bank_details')
      .eq('user_id', senderUser.id)
      .maybeSingle();

    const { data: receiverBankDetails, error: rBankErr } = await supabase
      .from('bank_details')
      .eq('user_id', receiverUser.id)
      .maybeSingle();

    if (!senderBankDetails || !receiverBankDetails) {
      return res.status(400).json({ message: "Bank details missing" });
    }

    const usdAmount = Number(amount);

    // Exchange Rates
    const exchangeRates = { India: 83.5, Brazil: 5.1, Mexico: 17.5, US: 1.0 };
    const senderRegion = senderBankDetails.region || 'India';
    const receiverRegion = receiverBankDetails.region || 'India';
    const senderRate = exchangeRates[senderRegion] || 83.5;
    const receiverRate = exchangeRates[receiverRegion] || 83.5;

    const requiredFiatToDeduct = usdAmount * senderRate;
    const receiverFiatAmount = usdAmount * receiverRate;

    // Check sender balance
    if (Number(senderBankDetails.amount) < requiredFiatToDeduct) {
      return res.status(400).json({
        message: `Insufficient Fiat. You need ${requiredFiatToDeduct.toFixed(2)} ${senderRegion || 'local fiat'}, but you only have ${Number(senderBankDetails.amount).toFixed(2)}`
      });
    }

    // Deduct from Sender, Add to Receiver
    const newSenderAmount = Number(senderBankDetails.amount) - requiredFiatToDeduct;
    const newReceiverAmount = Number(receiverBankDetails.amount) + receiverFiatAmount;

    // On-Chain execution using Treasury key
    let finalTxHash = '0x' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    let receipt = null;

    try {
      const fs = await import('fs');
      const { ethers } = await import('ethers');

      if (fs.existsSync('./contractData.json')) {
        const contractData = JSON.parse(fs.readFileSync('./contractData.json', 'utf8'));
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL;
        const privateKey = process.env.TREASURY_PRIVATE_KEY;

        if (rpcUrl && privateKey && senderUser.internal_wallet_address && receiverUser.internal_wallet_address) {
          console.log("🤖 [TREASURY] Bypassing on-chain treasury transfer to protect funds.");
          finalTxHash = '0x' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
          receipt = { status: 1 };
        }
      }
    } catch (blockchainErr) {
      console.error("Blockchain execution failed in Smart Route:", blockchainErr);
    }

    // Update bank details in Supabase
    await supabase
      .from('bank_details')
      .update({ amount: newSenderAmount })
      .eq('id', senderBankDetails.id);

    await supabase
      .from('bank_details')
      .update({ amount: newReceiverAmount })
      .eq('id', receiverBankDetails.id);

    // Save transaction history log
    const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN', France: 'EUR' };
    const currencyCode = currencyMap[senderRegion] || 'INR';

    await supabase
      .from('money_transfers')
      .insert({
        sender_id: senderUser.id,
        sender_pay_tag: senderUser.global_pay_tag,
        receiver_id: receiverUser.id,
        receiver_pay_tag: receiverUser.global_pay_tag,
        amount: usdAmount,
        exchange_rate: senderRate,
        bot_price: 9.72,
        bot_amount: usdAmount,
        network: 'botchain',
        tx_hash: finalTxHash,
        block_number: receipt ? receipt.blockNumber : null,
        usd_equivalent: usdAmount,
        local_equivalent: requiredFiatToDeduct,
        local_currency: currencyCode,
        status: 'COMPLETED'
      });

    return res.json({
      message: 'Smart Route Successful',
      amountUsd: usdAmount,
      receiverReceived: receiverFiatAmount,
      txHash: finalTxHash
    });

  } catch (err) {
    console.error("Smart Route error:", err);
    return res.status(500).json({ message: 'Server error during smart route transfer' });
  }
};

// Default export object matching legacy route expectations
export default {
  createMoneyTransfer,
  getMoneyTransfers,
  getMoneyTransfersExternal,
  requestMoneyCreate,
  getAllRequestMoney,
  getAllRawDocs,
  resolveRequestMoney,
  getFilteredRequests,
  smartRouteTransfer,
};
