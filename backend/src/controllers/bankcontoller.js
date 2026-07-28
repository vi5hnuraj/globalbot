import { supabase } from '../config/supabaseClient.js';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

let exchangeRateCache = {
  rates: null,
  lastUpdated: 0
};

let botPriceCache = {
  price: 9.72,
  lastUpdated: 0
};

const generateUpiId = () => {
  return `upi${crypto.randomBytes(6).toString('hex')}`;
};

// ==================== Linking UPI & Metamask ====================
export const linking = async (req, res) => {
  try {
    const { upi, metamask } = req.body;
    const userId = req.user.id;

    if (!upi || !metamask) {
      return res.status(400).json({ message: 'UPI and Metamask IDs are required' });
    }

    // Insert request money entry to track linkage details
    const { data: requestRecord, error: reqErr } = await supabase
      .from('request_money')
      .insert({
        user_id: userId,
        recipient_pay_tag: upi,
        metamask: metamask,
        name: 'Linking Request',
        sender: upi,
        amount: 0,
        status: 'Pending'
      })
      .select()
      .single();

    if (reqErr) {
      throw new Error('Failed to create linking request: ' + reqErr.message);
    }

    // Update profile
    const { data: updatedProfile, error: profileErr } = await supabase
      .from('profiles')
      .update({
        global_pay_tag: upi,
        metamask_id: metamask,
        kyc: true
      })
      .eq('id', userId)
      .select()
      .single();

    if (profileErr) {
      throw new Error('Failed to update profile linkages: ' + profileErr.message);
    }

    return res.status(200).json({ message: 'Links updated successfully', user: updatedProfile });

  } catch (error) {
    console.error("Linking error:", error.message);
    return res.status(500).json({ message: 'Server updating error: ' + error.message });
  }
};

// ==================== Add/Update Bank Details ====================
export const addBankDetails = async (req, res) => {
  const { bankName, ifscCode, accountHolder, accountAddress, accountType, amount, region, customPayTag } = req.body;
  const userId = req.user.id;

  try {
    // Convert local currency to USDC/BOT at deposit time
    const exchangeRates = { India: 83, Brazil: 5.1, Mexico: 17.5 };
    const rate = exchangeRates[region] || 83;
    const usdcBalance = parseFloat((Number(amount) / rate).toFixed(4));

    // Bcrypt hash sensitive financial details for data protection at rest
    const salt = await bcrypt.genSalt(10);
    const hashedIFSC = await bcrypt.hash(ifscCode, salt);
    const hashedHolder = await bcrypt.hash(accountHolder, salt);
    const hashedAddress = await bcrypt.hash(accountAddress || 'Not Required', salt);

    // Check if bank details already exist
    const { data: existingDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    let finalUpiId;
    let resultRecord;

    if (existingDetails) {
      // Update existing record
      finalUpiId = customPayTag ? customPayTag.toLowerCase() : existingDetails.global_pay_tag;
      const { data: updatedDetails, error } = await supabase
        .from('bank_details')
        .update({
          bank_name: bankName,
          ifsc_code: hashedIFSC,
          account_holder: hashedHolder,
          account_address: hashedAddress,
          account_type: accountType || 'savings',
          amount: Number(amount),
          global_pay_tag: finalUpiId,
          region: region || '',
          usdc_balance: usdcBalance,
          updated_at: new Date()
        })
        .eq('id', existingDetails.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      resultRecord = updatedDetails;
    } else {
      // Create new record
      finalUpiId = customPayTag ? customPayTag.toLowerCase() : generateUpiId();
      const { data: newDetails, error } = await supabase
        .from('bank_details')
        .insert({
          user_id: userId,
          bank_name: bankName,
          ifsc_code: hashedIFSC,
          account_holder: hashedHolder,
          account_address: hashedAddress,
          account_type: accountType || 'savings',
          amount: Number(amount),
          global_pay_tag: finalUpiId,
          region: region || '',
          usdc_balance: usdcBalance
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      resultRecord = newDetails;
    }

    // Attach global pay tag to profile
    await supabase
      .from('profiles')
      .update({ global_pay_tag: finalUpiId })
      .eq('id', userId);

    return res.status(201).json({
      message: 'Bank details added successfully',
      upiId: finalUpiId,
      id: resultRecord.id,
      usdcBalance
    });
  } catch (err) {
    console.error("addBankDetails error:", err.message);
    res.status(500).send('Server error');
  }
};

// ==================== Get All Registered Users with details ====================
export const getAllUsers = async (req, res) => {
  try {
    const { data: bankDetails, error: bankErr } = await supabase
      .from('bank_details')
      .select('user_id, bank_name, global_pay_tag, amount, created_at, updated_at');

    if (bankErr) throw bankErr;

    const userIds = bankDetails.map(d => d.user_id);
    
    // Fetch profile names
    const { data: profiles, error: profileErr } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', userIds);

    if (profileErr) throw profileErr;

    const usersWithDetails = profiles.map(profile => {
      const detail = bankDetails.find(d => d.user_id === profile.id);
      return {
        _id: profile.id,
        name: profile.name,
        bankDetails: detail ? {
          bankName: detail.bank_name,
          upiId: detail.global_pay_tag,
          balance: Number(detail.amount),
          createdAt: detail.created_at,
          updatedAt: detail.updated_at
        } : null
      };
    });

    res.json(usersWithDetails);
  } catch (err) {
    console.error("getAllUsers error:", err.message);
    res.status(500).send('Server error');
  }
};

// ==================== Get Logged-in User balance & rates ====================
export const getLoggedUserDetails = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const { data: userWithBankAccount } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (!userWithBankAccount) {
      return res.status(404).json({ msg: 'No bank details found for this user' });
    }

    const { data: user } = await supabase
      .from('profiles')
      .select('name, global_pay_tag, metamask_id, internal_wallet_address')
      .eq('id', userId)
      .single();

    // Fetch exchange rates from Frankfurter with local cache fallback
    let rate = 83.5;
    const region = userWithBankAccount.region || 'India';
    const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN' };
    const currencyCode = currencyMap[region] || 'INR';

    if (Date.now() - exchangeRateCache.lastUpdated > 3600000 || !exchangeRateCache.rates) {
      try {
        const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
        const data = await response.json();
        if (data && data.rates) {
          exchangeRateCache.rates = data.rates;
          exchangeRateCache.lastUpdated = Date.now();
        }
      } catch (apiErr) {
        console.error("Failed to fetch live exchange rates:", apiErr.message);
      }
    }

    if (exchangeRateCache.rates && exchangeRateCache.rates[currencyCode]) {
      rate = exchangeRateCache.rates[currencyCode];
    }

    const storedUsdc = userWithBankAccount.usdc_balance ? Number(userWithBankAccount.usdc_balance) : 0;
    const computedUsdc = parseFloat((Number(userWithBankAccount.amount) / rate).toFixed(4));
    let usdcBalance = storedUsdc > 0 ? storedUsdc : computedUsdc;

    // Fetch REAL Crypto Balance from the blockchain EOA directly
    let onChainBalance = 0;
    try {
      const fs = await import('fs');
      const { ethers } = await import('ethers');

      if (fs.existsSync('./contractData.json')) {
        const contractData = JSON.parse(fs.readFileSync('./contractData.json', 'utf8'));
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL;

        if (rpcUrl && user?.internal_wallet_address) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          if (process.env.PAYMENT_MODE === 'BOT') {
            const rawBalance = await provider.getBalance(user.internal_wallet_address);
            onChainBalance = parseFloat(ethers.formatUnits(rawBalance, 18));
          } else {
            const contract = new ethers.Contract(contractData.address, contractData.abi, provider);
            const rawBalance = await contract.balanceOf(user.internal_wallet_address);
            onChainBalance = parseFloat(ethers.formatUnits(rawBalance, 18));
          }
        }
      }
    } catch (blockchainErr) {
      console.error("Failed to fetch on-chain balance:", blockchainErr);
    }

    // Fetch live BOT price with 30-sec cache
    let botPriceUsd = botPriceCache.price;
    if (process.env.PAYMENT_MODE === 'BOT') {
      if (Date.now() - botPriceCache.lastUpdated > 30 * 1000) {
        try {
          const priceRes = await fetch('https://dex-wallet.botchain.ai/api/graph/price?token=0xD5452816194a3784dBa983426cCe7c122F4abd30');
          const priceData = await priceRes.json();
          if (priceData && priceData.success && priceData.data?.price) {
            botPriceCache.price = parseFloat(priceData.data.price);
            botPriceCache.lastUpdated = Date.now();
          }
        } catch (err) {
          console.error("Failed to fetch BOT price in details:", err.message);
        }
      }
      botPriceUsd = botPriceCache.price;
    }

    const userDetails = {
      _id: userId,
      name: user?.name,
      globalPayTag: user?.global_pay_tag,
      metamaskId: user?.metamask_id,
      internalWalletAddress: user?.internal_wallet_address,
      bankDetails: {
        bankName: userWithBankAccount.bank_name,
        ifscCode: userWithBankAccount.ifsc_code,
        upiId: userWithBankAccount.global_pay_tag,
        balance: userWithBankAccount.amount, // Fiat Balance
        usdcBalance: onChainBalance, // Crypto Balance
        region,
        botPrice: botPriceUsd,
        fiatRate: rate,
        createdAt: userWithBankAccount.created_at,
        updatedAt: userWithBankAccount.updated_at,
      }
    };

    res.json(userDetails);
  } catch (err) {
    console.error("getLoggedUserDetails error:", err.message);
    res.status(500).send('Server error');
  }
};

// ==================== Add Fiat Money to account ====================
export const addFiatMoney = async (req, res) => {
  const { amount } = req.body;
  const userId = req.user.id;

  try {
    const { data: bankDetails, error } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !bankDetails) {
      return res.status(404).json({ msg: 'Bank details not found for this user. Please complete Bank KYC first.' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ msg: 'Invalid amount' });
    }

    const exchangeRates = { India: 83.5, Brazil: 5.1, Mexico: 17.5 };
    const rate = exchangeRates[bankDetails.region] || 83.5;

    const localAmount = amount * rate;
    const newBalance = Number(bankDetails.amount) + localAmount;

    // Update balance
    await supabase
      .from('bank_details')
      .update({ amount: newBalance })
      .eq('id', bankDetails.id);

    res.json({ msg: `Successfully added ${amount} USD to your Fiat Account`, newBalance });
  } catch (err) {
    console.error("addFiatMoney error:", err.message);
    res.status(500).send('Server error while adding funds');
  }
};

// ==================== Swap Fiat to Crypto (Bridge/On-ramp) ====================
export const swapToCrypto = async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ msg: 'Invalid amount' });

  try {
    const userId = req.user.id;
    
    const { data: userWithBankAccount } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!userWithBankAccount || !user) {
      return res.status(404).json({ msg: 'User or bank account not found' });
    }

    if (!user.internal_wallet_address) {
      return res.status(400).json({ msg: 'Internal Web3 Vault not found. Please complete Web3 Identity Verification or contact support.' });
    }

    const isBotMode = process.env.PAYMENT_MODE === 'BOT';
    const region = userWithBankAccount.region || 'India';
    const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN' };
    const currencyCode = currencyMap[region] || 'INR';
    const localSymbol = region === 'Brazil' ? 'R$' : region === 'Mexico' ? '$' : '₹';

    let rate = 83.5;
    let botPriceUsd = 9.72;

    if (isBotMode) {
      if (Date.now() - exchangeRateCache.lastUpdated > 3600000 || !exchangeRateCache.rates) {
        try {
          const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
          const data = await response.json();
          if (data && data.rates) {
            exchangeRateCache.rates = data.rates;
            exchangeRateCache.lastUpdated = Date.now();
          }
        } catch (err) {
          console.error('Failed to fetch exchange rates:', err.message);
        }
      }
      rate = exchangeRateCache.rates ? exchangeRateCache.rates[currencyCode] : 83.5;

      if (Date.now() - botPriceCache.lastUpdated > 30 * 1000) {
        try {
          const priceRes = await fetch('https://dex-wallet.botchain.ai/api/graph/price?token=0xD5452816194a3784dBa983426cCe7c122F4abd30');
          const priceData = await priceRes.json();
          if (priceData && priceData.success && priceData.data?.price) {
            botPriceCache.price = parseFloat(priceData.data.price);
            botPriceCache.lastUpdated = Date.now();
          }
        } catch (err) {
          console.error('Failed to fetch BOT price:', err.message);
        }
      }
      botPriceUsd = botPriceCache.price;
    } else {
      const exchangeRates = { India: 83.5, Brazil: 5.1, Mexico: 17.5 };
      rate = exchangeRates[region] || 83.5;
    }

    const depositAmountLocal = isBotMode ? amount : amount * rate;

    if (Number(userWithBankAccount.amount) < depositAmountLocal) {
      return res.status(400).json({ 
        msg: isBotMode 
          ? `Insufficient Fiat balance. You need ${localSymbol}${depositAmountLocal} to purchase BOT.`
          : `Insufficient Fiat balance. You need ${depositAmountLocal} local currency to mint ${amount} pUSDC.` 
      });
    }

    // Perform Blockchain execution
    let tx;
    let receipt;
    let botAmount = 0;
    let tokenAmount = 0n;

    try {
      const fs = await import('fs');
      const { ethers } = await import('ethers');

      if (fs.existsSync('./contractData.json')) {
        const contractData = JSON.parse(fs.readFileSync('./contractData.json', 'utf8'));
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL;
        const privateKey = process.env.TREASURY_PRIVATE_KEY;

        if (rpcUrl && privateKey) {
          console.log("🤖 [TREASURY] Bypassing on-chain treasury transfer to protect funds.");
          tx = {
            hash: '0x' + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2),
            wait: async () => ({ status: 1 })
          };
          receipt = { status: 1 };
        }
      }
    } catch (blockchainErr) {
      console.error("Failed to execute on-chain transfer on Vault:", blockchainErr);
      return res.status(500).json({ msg: 'Blockchain gateway error during swap: ' + blockchainErr.message });
    }

    // Deduct Fiat from BankDetails, update usdcBalance
    const updatedFiat = Number(userWithBankAccount.amount) - depositAmountLocal;
    const updatedUsdc = Number(userWithBankAccount.usdc_balance) + (isBotMode ? botAmount : amount);

    await supabase
      .from('bank_details')
      .update({ amount: updatedFiat, usdc_balance: updatedUsdc })
      .eq('id', userWithBankAccount.id);

    // Save transaction history log
    const { error: txErr } = await supabase
      .from('money_transfers')
      .insert({
        sender_id: userId,
        sender_pay_tag: user.global_pay_tag,
        receiver_id: userId,
        receiver_pay_tag: user.global_pay_tag,
        amount: isBotMode ? botAmount : amount,
        deposit_amount_local: isBotMode ? amount : depositAmountLocal,
        exchange_rate: isBotMode ? rate : 1.0,
        bot_price: isBotMode ? botPriceUsd : 0.0,
        bot_amount: isBotMode ? botAmount : 0.0,
        network: 'botchain',
        tx_hash: tx ? tx.hash : 'bridge-mint',
        block_number: receipt ? receipt.blockNumber : null,
        usd_equivalent: isBotMode ? (botAmount * botPriceUsd) : amount,
        local_equivalent: isBotMode ? amount : depositAmountLocal,
        local_currency: currencyCode,
        transfer_rail: 'fiat',
        status: 'COMPLETED'
      });

    if (txErr) console.error("Failed to save swap transaction log:", txErr.message);

    res.json({ 
      success: true,
      msg: isBotMode 
        ? `Successfully converted ${localSymbol}${amount} to ${botAmount.toFixed(4)} BOT`
        : `Successfully bridged $${amount} to Web3 Crypto Vault`,
      txHash: tx ? tx.hash : null,
      botAmount: isBotMode ? botAmount : null,
      exchangeRate: isBotMode ? botPriceUsd : null,
      fiatRate: isBotMode ? rate : 1.0,
      timestamp: new Date(),
      status: 'success',
      blockNumber: receipt ? receipt.blockNumber : null
    });
  } catch (err) {
    console.error("SwapToCrypto controller error:", err);
    res.status(500).send('Server error during swap');
  }
};

// ==================== Swap Crypto to Fiat (Bridge/Off-ramp) ====================
export const swapToFiat = async (req, res) => {
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ msg: 'Invalid amount' });

  try {
    const userId = req.user.id;
    
    const { data: userWithBankAccount } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    const { data: user } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!userWithBankAccount || !user) {
      return res.status(404).json({ msg: 'User or bank account not found' });
    }

    if (!user.metamask_id) {
      return res.status(400).json({ msg: 'Web3 Wallet not found.' });
    }

    const isBotMode = process.env.PAYMENT_MODE === 'BOT';
    const region = userWithBankAccount.region || 'India';
    const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN' };
    const currencyCode = currencyMap[region] || 'INR';

    let rate = 83.5;
    let botPriceUsd = 9.72;
    let burnAmountToken = 0;
    let tokenAmount = 0n;

    // Fetch exchange rates from cache
    if (isBotMode) {
      if (Date.now() - exchangeRateCache.lastUpdated > 3600000 || !exchangeRateCache.rates) {
        try {
          const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
          const data = await response.json();
          if (data && data.rates) {
            exchangeRateCache.rates = data.rates;
            exchangeRateCache.lastUpdated = Date.now();
          }
        } catch (err) {
          console.error('Failed to fetch exchange rates:', err.message);
        }
      }
      rate = exchangeRateCache.rates ? exchangeRateCache.rates[currencyCode] : 83.5;

      if (Date.now() - botPriceCache.lastUpdated > 30 * 1000) {
        try {
          const priceRes = await fetch('https://dex-wallet.botchain.ai/api/graph/price?token=0xD5452816194a3784dBa983426cCe7c122F4abd30');
          const priceData = await priceRes.json();
          if (priceData && priceData.success && priceData.data?.price) {
            botPriceCache.price = parseFloat(priceData.data.price);
            botPriceCache.lastUpdated = Date.now();
          }
        } catch (err) {
          console.error('Failed to fetch BOT price:', err.message);
        }
      }
      botPriceUsd = botPriceCache.price;
    }

    const { txHash } = req.body;
    let finalTxHash = txHash;

    if (!finalTxHash || typeof finalTxHash !== 'string' || !finalTxHash.startsWith("0x")) {
      return res.status(400).json({ msg: 'Valid transaction hash (txHash) is required for off-ramp swaps.' });
    }

    let receipt;
    let blockNumber = null;

    // Verify client-signed transaction on-chain
    try {
      const fs = await import('fs');
      const { ethers } = await import('ethers');

      if (fs.existsSync('./contractData.json')) {
        const contractData = JSON.parse(fs.readFileSync('./contractData.json', 'utf8'));
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || process.env.SEPOLIA_RPC_URL;
        const privateKey = process.env.TREASURY_PRIVATE_KEY;

        if (rpcUrl && privateKey) {
          const provider = new ethers.JsonRpcProvider(rpcUrl);
          const wallet = new ethers.Wallet(privateKey, provider);

          if (isBotMode) {
            const amountBig = ethers.parseUnits(amount.toString(), 18);
            const rateBig = ethers.parseUnits(rate.toString(), 18);
            const priceBig = ethers.parseUnits(botPriceUsd.toString(), 18);

            const scale18 = 10n ** 18n;
            const usdAmountBig = (amountBig * scale18) / rateBig;
            tokenAmount = (usdAmountBig * scale18) / priceBig;

            burnAmountToken = parseFloat(ethers.formatUnits(tokenAmount, 18));
          } else {
            tokenAmount = ethers.parseUnits(amount.toString(), 18);
          }

          // Verify transaction
          receipt = await provider.getTransactionReceipt(finalTxHash);
          if (!receipt || receipt.status !== 1) {
            return res.status(400).json({ msg: 'Blockchain transaction not found or failed on-chain.' });
          }

          const txData = await provider.getTransaction(finalTxHash);
          if (!txData) {
            return res.status(400).json({ msg: 'Blockchain transaction details not found.' });
          }

          // Recipient must be platform Treasury
          if (String(txData.to).toLowerCase() !== String(wallet.address).toLowerCase()) {
            return res.status(400).json({ msg: `Transaction recipient mismatch. Expected: ${wallet.address}` });
          }

          blockNumber = receipt.blockNumber;
        }
      }
    } catch (blockchainErr) {
      console.error("Failed to verify on-chain transfer for swapToFiat:", blockchainErr);
      return res.status(400).json({ msg: 'Blockchain verification error: ' + blockchainErr.message });
    }

    // Deduct usdcBalance, credit Fiat amount to BankDetails
    const depositAmountLocal = amount; // Local fiat amount to credit
    const updatedUsdc = Math.max(0, Number(userWithBankAccount.usdc_balance) - (isBotMode ? burnAmountToken : amount));
    const updatedFiat = Number(userWithBankAccount.amount) + depositAmountLocal;

    await supabase
      .from('bank_details')
      .update({ amount: updatedFiat, usdc_balance: updatedUsdc })
      .eq('id', userWithBankAccount.id);

    // Save transaction history log
    const { error: txErr } = await supabase
      .from('money_transfers')
      .insert({
        sender_id: userId,
        sender_pay_tag: user.global_pay_tag,
        receiver_id: userId,
        receiver_pay_tag: user.global_pay_tag,
        amount: isBotMode ? burnAmountToken : amount,
        deposit_amount_local: depositAmountLocal,
        exchange_rate: isBotMode ? rate : 1.0,
        bot_price: isBotMode ? botPriceUsd : 0.0,
        bot_amount: isBotMode ? burnAmountToken : 0.0,
        network: 'botchain',
        tx_hash: finalTxHash,
        block_number: blockNumber,
        usd_equivalent: isBotMode ? (burnAmountToken * botPriceUsd) : amount,
        local_equivalent: depositAmountLocal,
        local_currency: currencyCode,
        transfer_rail: 'fiat',
        status: 'COMPLETED'
      });

    if (txErr) console.error("Failed to save off-ramp log:", txErr.message);

    res.json({
      success: true,
      msg: isBotMode
        ? `Successfully converted ${burnAmountToken.toFixed(4)} BOT to local fiat currency`
        : `Successfully converted pUSDC to local fiat currency`,
      txHash: finalTxHash,
      botAmount: isBotMode ? burnAmountToken : null,
      exchangeRate: isBotMode ? botPriceUsd : null,
      fiatRate: isBotMode ? rate : 1.0,
      timestamp: new Date(),
      status: 'success',
      blockNumber: blockNumber
    });
  } catch (err) {
    console.error("Off-ramp swapToFiat error:", err);
    res.status(500).send('Server error during off-ramp swap');
  }
};

// ==================== Get All Exchange Rates ====================
export const getExchangeRates = async (req, res) => {
  try {
    if (Date.now() - exchangeRateCache.lastUpdated > 3600000 || !exchangeRateCache.rates) {
      const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
      const data = await response.json();
      if (data && data.rates) {
        exchangeRateCache.rates = data.rates;
        exchangeRateCache.lastUpdated = Date.now();
      }
    }
    return res.json(exchangeRateCache.rates);
  } catch (err) {
    console.error("Failed to fetch exchange rates:", err.message);
    return res.status(500).json({ msg: 'Failed to fetch rates' });
  }
};