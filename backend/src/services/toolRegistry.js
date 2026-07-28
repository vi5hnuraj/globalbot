import { supabase } from '../config/supabaseClient.js';
import { createClient } from '@supabase/supabase-js';
import { getLiveBotPrice } from './liveRateService.js';
import crypto from 'crypto';

/**
 * Tool Definitions for Groq / LLM Tool Calling Architecture
 */
export const toolDefinitions = [
  {
    name: "sendBot",
    description: "Send BOT or crypto tokens to a recipient via PayTag (@username), UPI ID, or wallet address.",
    parameters: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "The PayTag (e.g. @alice) or receiver UPI ID" },
        amount: { type: "number", description: "Amount of BOT tokens to send" },
        currency: { type: "string", description: "Currency code (default BOT)" }
      },
      required: ["recipient", "amount"]
    }
  },
  {
    name: "payMerchant",
    description: "Pay a merchant (e.g., Starbucks, Amazon) using BOT tokens or linked account.",
    parameters: {
      type: "object",
      properties: {
        merchant: { type: "string", description: "Name or UPI ID of the merchant" },
        amount: { type: "number", description: "Amount to pay" },
        coin: { type: "string", description: "Token/Coin used (default BOT)" }
      },
      required: ["merchant", "amount"]
    }
  },
  {
    name: "payQR",
    description: "Pay a QR code string, merchant QR payload, or payment barcode.",
    parameters: {
      type: "object",
      properties: {
        qrData: { type: "string", description: "The QR payload, merchant ID, or payment URI" },
        amount: { type: "number", description: "Amount to pay" }
      },
      required: ["qrData"]
    }
  },
  {
    name: "checkBalance",
    description: "Check user's current available fiat bank account balance and BOT vault balance.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "getTransactionHistory",
    description: "Get user's recent transaction activity log and spending history.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum number of transactions to retrieve" }
      }
    }
  },
  {
    name: "findUser",
    description: "Find a user by PayTag (@username), UPI ID, email, or name.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "PayTag, UPI ID, email, or name to search for" }
      },
      required: ["query"]
    }
  },
  {
    name: "schedulePayment",
    description: "Schedule a future or recurring payment to a recipient.",
    parameters: {
      type: "object",
      properties: {
        recipient: { type: "string", description: "PayTag or UPI ID of recipient" },
        amount: { type: "number", description: "Amount to send" },
        date: { type: "string", description: "Scheduled date/time for payment" },
        note: { type: "string", description: "Optional note or description" }
      },
      required: ["recipient", "amount"]
    }
  },
  {
    name: "createInvoice",
    description: "Create a payment request invoice for a customer or client.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Invoice amount" },
        currency: { type: "string", description: "Currency, e.g. USD, INR, BOT" },
        recipient: { type: "string", description: "Target recipient PayTag or email" },
        note: { type: "string", description: "Invoice description" }
      },
      required: ["amount"]
    }
  },
  {
    name: "getRate",
    description: "Get the current live BOT/USD exchange rate.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "getWallet",
    description: "Show your Internal Vault and External Web3 wallet addresses.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "switchPrimary",
    description: "Switch your primary receiving wallet between Internal Vault and External Web3 wallet.",
    parameters: {
      type: "object",
      properties: {
        target: { type: "string", description: "Target wallet type: 'internal' or 'external'. Omit to auto-toggle." }
      }
    }
  },
  {
    name: "getHelp",
    description: "List all available AI Agent commands with descriptions.",
    parameters: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "cancelSchedulePayment",
    description: "Cancel a scheduled payment and refund the locked BOT. Requires a transfer ID or will find the latest one.",
    parameters: {
      type: "object",
      properties: {
        transferId: { type: "string", description: "Optional transfer ID to cancel. Omit to cancel the most recent pending/funded schedule." }
      }
    }
  },
];

/**
 * Execute tool handler functions using Supabase client
 */
const createUserScopedClient = (accessToken) => {
  const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!accessToken || !url || !anonKey) return supabase;

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } }
  });
};

export const executeTool = async (name, args, user, accessToken) => {
  const userId = user.id;
  const userScopedSupabase = createUserScopedClient(accessToken);

  switch (name) {
    case "sendBot": {
      const { recipient, amount, currency = "BOT" } = args;
      if (!recipient || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
        return { tool: "sendBot", success: false, message: "❌ Include a valid recipient and an amount greater than zero." };
      }
      const cleanTag = recipient.replace(/^@/, '').trim();
      const tagWithAt = `@${cleanTag}`;

      // Resolve receiver user profile — try multiple strategies
      let receiverUser = null;
      let lookupErr = null;

      // Strategy 1: by global_pay_tag (try each format individually to avoid .or() parsing issues with @)
      for (const tag of [recipient, cleanTag, tagWithAt]) {
        if (!tag) continue;
        console.log(`sendBot lookup: profiles.global_pay_tag eq "${tag}"`);
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('global_pay_tag', tag)
          .maybeSingle();
        console.log(`sendBot lookup result:`, data ? `found ${data.name} (${data.global_pay_tag})` : 'not found');
        if (data) { receiverUser = data; break; }
      }

      // Strategy 2: by email
      if (!receiverUser) {
        const { data: r2 } = await supabase
          .from('profiles')
          .select('*')
          .or(`email.eq.${recipient},email.eq.${cleanTag}`)
          .maybeSingle();
        if (r2) receiverUser = r2;
        else lookupErr = r2 ? null : lookupErr;
      }

      // Strategy 3: by name (case-insensitive)
      if (!receiverUser) {
        const { data: r3 } = await supabase
          .from('profiles')
          .select('*')
          .ilike('name', cleanTag)
          .maybeSingle();
        if (r3) receiverUser = r3;
      }

      // Strategy 4: lookup user_id from bank_details by global_pay_tag
      if (!receiverUser) {
        for (const tag of [recipient, cleanTag, tagWithAt]) {
          if (!tag) continue;
          const { data: bankUser } = await supabase
            .from('bank_details')
            .select('user_id')
            .eq('global_pay_tag', tag)
            .maybeSingle();
          if (bankUser?.user_id) {
            const { data: r4 } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', bankUser.user_id)
              .maybeSingle();
            if (r4) { receiverUser = r4; break; }
          }
        }
      }

      if (!receiverUser) {
        console.error(`sendBot lookup failed for ${recipient}:`, lookupErr?.message, { cleanTag, tagWithAt });
        return { tool: "sendBot", success: false, message: `❌ No user found with that paytag, email, or wallet address.` };
      }

      const { data: senderUser } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const isExternalReceiver = String(receiverUser?.primary_receiving_wallet).toLowerCase() === 'external';
      const extAddr = receiverUser?.metamask_id || receiverUser?.external_wallet;
      const targetAddress = (isExternalReceiver && extAddr)
        ? extAddr
        : receiverUser?.internal_wallet_address || extAddr;
      if (!targetAddress) {
        return { tool: "sendBot", success: false, message: `❌ Recipient ${recipient} does not have a payable wallet.` };
      }
      return {
        tool: "sendBot",
        success: true,
        actionRequired: true,
        action: {
          recipient: receiverUser.global_pay_tag || recipient,
          targetAddress,
          amount: Number(amount),
          currency
        },
        message: `Ready to send ${Number(amount)} ${currency} to ${receiverUser.global_pay_tag || recipient}. Review the details and choose your wallet below.`
      };
    }

    case "payMerchant": {
      return { tool: "payMerchant", success: false, message: "🔐 Merchant payments must be approved from your connected wallet in the Pay screen." };
    }

    case "payQR": {
      return { tool: "payQR", success: false, message: "🔐 QR payments must be approved from your connected wallet in the Pay screen." };
    }

    case "checkBalance": {
      const { data: bankDetails } = await supabase
        .from('bank_details')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      const { data: userObj } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      const fiatAmount = bankDetails ? Number(bankDetails.amount || 0) : 0;
      const region = bankDetails ? bankDetails.region || 'India' : 'India';

      const currencyMap = { India: 'INR', Brazil: 'BRL', Mexico: 'MXN', France: 'EUR' };
      const currencySymbolMap = { India: '₹', Brazil: 'R$', Mexico: 'MX$', France: '€' };

      const currSymbol = currencySymbolMap[region] || '₹';

      let internalBotBal = 0;
      let externalBotBal = 0;

      try {
        const { ethers } = await import('ethers');
        const rpcUrl = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
        const provider = new ethers.JsonRpcProvider(rpcUrl);

        if (userObj?.internal_wallet_address) {
          const rawInt = await provider.getBalance(userObj.internal_wallet_address);
          internalBotBal = parseFloat(ethers.formatUnits(rawInt, 18));
        }

        if (userObj?.metamask_id && userObj.metamask_id.startsWith('0x')) {
          const rawExt = await provider.getBalance(userObj.metamask_id);
          externalBotBal = parseFloat(ethers.formatUnits(rawExt, 18));
        }
      } catch (err) {
        console.error("Tool checkBalance RPC Error:", err.message);
        internalBotBal = bankDetails?.usdc_balance || 0;
      }

      let botPrice = 9.72;
      try {
        const priceRes = await fetch('https://dex-wallet.botchain.ai/api/graph/price?token=0xD5452816194a3784dBa983426cCe7c122F4abd30');
        const priceData = await priceRes.json();
        if (priceData?.success && priceData.data?.price) {
          botPrice = parseFloat(priceData.data.price);
        }
      } catch (e) { }

      const totalBotBal = internalBotBal + externalBotBal;
      const totalUsd = (totalBotBal * botPrice).toFixed(2);
      const internalUsd = (internalBotBal * botPrice).toFixed(2);

      let msg = `🤖 Web3 BOT Chain Balances:\n`;
      msg += `🏦 Internal Vault: ${internalBotBal.toFixed(4)} BOT (≈ $${internalUsd} USD)\n`;

      if (userObj?.metamask_id && userObj.metamask_id !== 'Not Connected') {
        const externalUsd = (externalBotBal * botPrice).toFixed(2);
        msg += `🔗 External Web3 Wallet: ${externalBotBal.toFixed(4)} BOT (≈ $${externalUsd} USD)\n`;
      }

      msg += `💎 Total On-Chain Balance: ${totalBotBal.toFixed(4)} BOT (≈ $${totalUsd} USD)`;

      return {
        tool: "checkBalance",
        success: true,
        totalBotBalance: totalBotBal,
        internalBotBalance: internalBotBal,
        externalBotBalance: externalBotBal,
        botPrice,
        message: msg
      };
    }

    case "getTransactionHistory": {
      const { limit = 5 } = args;

      // Query transfers and payments concurrently
      const [transfersRes, paymentsRes] = await Promise.all([
        supabase
          .from('money_transfers')
          .select('*')
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(limit),
        supabase
          .from('payments')
          .select('*')
          .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
          .order('created_at', { ascending: false })
          .limit(limit)
      ]);

      const transfers = transfersRes.data || [];
      const payments = paymentsRes.data || [];

      let allTxs = [
        ...transfers.map(t => ({
          _id: t.id,
          sender: t.sender_id,
          receiver: t.receiver_id,
          senderUPI: t.sender_pay_tag,
          receiverUPI: t.receiver_pay_tag,
          amount: t.bot_amount || t.amount || 0,
          coin: 'BOT',
          txHash: t.tx_hash,
          date: t.created_at
        })),
        ...payments.map(p => ({
          _id: p.id,
          sender: p.sender_id,
          senderUPI: p.sender_pay_tag,
          receiverUPI: p.recipient_pay_tag,
          amount: p.bot_amount_snapshot || p.amount || 0,
          coin: p.coin || 'BOT',
          txHash: p.tx_hash,
          date: p.created_at
        }))
      ];

      // De-duplicate by txHash (transfer version wins since it comes first)
      const seen = new Set();
      allTxs = allTxs.filter(t => {
        const key = t.txHash || String(t._id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Resolve missing sender paytags for payments-table records
      const missingPaytags = allTxs.filter(t => t.sender && !t.senderUPI).map(t => t.sender);
      if (missingPaytags.length > 0) {
        const uniqueIds = [...new Set(missingPaytags)];
        const { data: senderProfiles } = await supabase
          .from('profiles')
          .select('id, global_pay_tag')
          .in('id', uniqueIds);
        const paytagMap = {};
        if (senderProfiles) {
          senderProfiles.forEach(sp => { paytagMap[sp.id] = sp.global_pay_tag; });
        }
        allTxs.forEach(t => {
          if (t.sender && !t.senderUPI && paytagMap[t.sender]) {
            t.senderUPI = paytagMap[t.sender];
          }
        });
      }

      // Sort newest first (handle null dates safely)
      allTxs.sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      });
      const sliced = allTxs.slice(0, Number(limit));

      if (sliced.length === 0) {
        return {
          tool: "getTransactionHistory",
          success: true,
          count: 0,
          history: [],
          message: "📜 No recent transaction history found."
        };
      }

      const explorerUrl = process.env.BOTCHAIN_EXPLORER_URL || "https://scan.botchain.ai/";
      // The chat bubble renders links itself but does not parse Markdown
      // emphasis. Keep transaction history as clean plain text so users do
      // not see literal ** and * markers.
      let msg = `📜 Recent Transactions (${sliced.length}):\n`;

      sliced.forEach((tx, i) => {
        const isSender = String(tx.sender) === String(userId);
        const icon = isSender ? '💸' : '📥';
        const direction = isSender ? `To ${tx.receiverUPI || 'Recipient'}` : `From ${tx.senderUPI || 'Sender'}`;
        const amountStr = `${Number(tx.amount).toFixed(4)} ${tx.coin || 'BOT'}`;
        const dateStr = new Date(tx.date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

        msg += `\n${i + 1}. ${icon} ${amountStr} (${direction}) • ${dateStr}`;
        if (tx.txHash) {
          msg += `\n    🔗 [BOTScan Verified ↗](${explorerUrl}/tx/${tx.txHash})`;
        }
      });

      return {
        tool: "getTransactionHistory",
        success: true,
        count: sliced.length,
        history: sliced,
        message: msg
      };
    }

    case "findUser": {
      const { query } = args;
      const cleanTag = query.replace(/^@/, '').trim();
      const tagWithAt = `@${cleanTag}`;

      // Try multiple search strategies sequentially for broader matching
      let foundUser = null;

      for (const tag of [tagWithAt, cleanTag, query]) {
        if (!tag) continue;
        console.log(`findUser: profiles.global_pay_tag eq "${tag}"`);
        const { data } = await supabase
          .from('profiles')
          .select('name, email, global_pay_tag, region, primary_receiving_wallet')
          .eq('global_pay_tag', tag)
          .maybeSingle();
        console.log(`findUser result:`, data ? `found ${data.name} (${data.global_pay_tag})` : 'not found');
        if (data) { foundUser = data; break; }
      }

      if (!foundUser) {
        for (const emailTag of [query, cleanTag]) {
          if (!emailTag) continue;
          const { data } = await supabase
            .from('profiles')
            .select('name, email, global_pay_tag, region, primary_receiving_wallet')
            .eq('email', emailTag)
            .maybeSingle();
          if (data) { foundUser = data; break; }
        }
      }

      if (!foundUser) {
        const { data } = await supabase
          .from('profiles')
          .select('name, email, global_pay_tag, region, primary_receiving_wallet')
          .ilike('name', `%${cleanTag}%`)
          .maybeSingle();
        foundUser = data;
      }

      // Strategy 4: lookup user_id from bank_details by global_pay_tag
      if (!foundUser) {
        for (const tag of [tagWithAt, cleanTag, query]) {
          if (!tag) continue;
          const { data: bankUser } = await supabase
            .from('bank_details')
            .select('user_id')
            .eq('global_pay_tag', tag)
            .maybeSingle();
          if (bankUser?.user_id) {
            const { data: r4 } = await supabase
              .from('profiles')
              .select('name, email, global_pay_tag, region, primary_receiving_wallet')
              .eq('id', bankUser.user_id)
              .maybeSingle();
            if (r4) { foundUser = r4; break; }
          }
        }
      }

      if (!foundUser) {
        return {
          tool: "findUser",
          success: false,
          message: `🔍 User '${query}' not found on GlobalPay.`
        };
      }

      const walletType = String(foundUser.primary_receiving_wallet || 'internal').toLowerCase() === 'external' ? 'External Web3' : 'Internal Vault';

      return {
        tool: "findUser",
        success: true,
        user: {
          name: foundUser.name,
          payTag: foundUser.global_pay_tag,
          region: foundUser.region || "Global"
        },
        message: `✅ Verified User Found!\n👤 Name: ${foundUser.name}\n🏷️ PayTag: ${foundUser.global_pay_tag}\n📧 Email: ${foundUser.email}\n🌍 Region: ${foundUser.region || 'Global'}\n💳 Receives via: ${walletType}`
      };
    }

    case "schedulePayment": {
      const { recipient, amount, date } = args;

      const { data: senderUser } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!senderUser?.metamask_id) {
        return { tool: "schedulePayment", success: false, message: "❌ Scheduled Payments are currently available only for external wallets (MetaMask, Rabby, WalletConnect). Connect an external wallet and try again." };
      }

      const senderTag = senderUser?.global_pay_tag || senderUser?.email;
      const scheduledAt = date
        ? (typeof date === 'string' && date.endsWith('Z')
          ? new Date(new Date(date).getTime() + new Date(date).getTimezoneOffset() * 60000)
          : new Date(date))
        : new Date(Date.now() + 86400000);

      if (isNaN(scheduledAt.getTime())) {
        return { tool: "schedulePayment", success: false, message: "❌ Invalid date/time format. Try: 'Schedule 5 BOT to @user tomorrow at 3pm'." };
      }

      const cleanTag = recipient.replace(/^@/, '').trim();
      const tagWithAt = `@${cleanTag}`;

      let receiverUser = null;
      for (const tag of [tagWithAt, cleanTag]) {
        if (!tag) continue;
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('global_pay_tag', tag)
          .maybeSingle();
        if (data) { receiverUser = data; break; }
      }

      if (!receiverUser) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .or(`email.eq.${recipient},email.eq.${cleanTag}`)
          .maybeSingle();
        receiverUser = data;
      }

      if (!receiverUser) {
        return { tool: "schedulePayment", success: false, message: `❌ User "${recipient}" not found. Make sure the PayTag or email is correct.` };
      }

      const isExternalReceiver = String(receiverUser?.primary_receiving_wallet).toLowerCase() === 'external';
      const extAddr = receiverUser?.metamask_id || receiverUser?.external_wallet;
      const targetAddress = (isExternalReceiver && extAddr)
        ? extAddr
        : receiverUser?.internal_wallet_address || extAddr;
      if (!targetAddress) {
        return { tool: "schedulePayment", success: false, message: `❌ ${receiverUser.global_pay_tag || recipient} has no wallet address linked. They need to set up their wallet first.` };
      }

      const releaseTime = Math.floor(scheduledAt.getTime() / 1000);

      const { data: scheduledTx, error } = await supabase
        .from('money_transfers')
        .insert({
          sender_id: userId,
          sender_pay_tag: senderTag,
          receiver_id: receiverUser.id,
          receiver_pay_tag: recipient,
          amount: Number(amount),
          network: 'botchain',
          status: 'PENDING',
          bot_amount: Number(amount),
          created_at: new Date().toISOString(),
          sender_wallet_type: 'external',
          sender_wallet_address: senderUser?.metamask_id || senderUser?.internal_wallet_address || null,
          receiving_wallet_type: isExternalReceiver ? 'external' : 'internal',
          receiver_wallet_address: targetAddress,
          destination_address: targetAddress,
          raw_signed_tx: JSON.stringify({ releaseAt: releaseTime })
        })
        .select()
        .single();

      if (error) throw error;

      const managerAddress = process.env.GLOBAL_PAY_MANAGER_ADDRESS || "0x6F3B1DC09A8C968F0B829276570bCF10AB9858c1";
      const receiverTag = receiverUser.global_pay_tag || recipient;

        return {
          tool: "schedulePayment",
          success: true,
          recipient: receiverTag,
          amount: Number(amount),
          scheduledDate: scheduledTx.created_at,
          transferId: scheduledTx.id,
          targetAddress,
          contractAddress: managerAddress,
          releaseTime,
          requiresAuth: true,
          message: `⏰ Scheduled ${amount} BOT to ${receiverTag}\n\n📬 Recipient: ${receiverTag}\n🔗 Wallet: ${targetAddress}\n⏱ Release: ${new Date(releaseTime * 1000).toLocaleString()}`
        };
    }

    case "createInvoice": {
      const { amount, currency = "USD", recipient, note = "" } = args;

      const { data: userProfile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (!recipient) {
        return { tool: "createInvoice", success: false, message: "❌ Include an invoice recipient—for example: Create invoice 10 USD for @username." };
      }

      const normalizedCurrency = String(currency).toUpperCase();
      const liveBotPrice = normalizedCurrency === 'USD' ? await getLiveBotPrice() : null;
      const botAmount = normalizedCurrency === 'USD' ? Number(amount) / liveBotPrice : Number(amount);
      const invoiceItem = {
        user_id: userId,
        recipient_pay_tag: recipient || "Open Customer",
        metamask: userProfile.metamask_id,
        name: note || "Invoice",
        sender: userProfile.global_pay_tag || userProfile.email,
        amount: Number(amount),
        currency: normalizedCurrency,
        requested_amount: Number(amount),
        requested_currency: normalizedCurrency,
        bot_price_snapshot: liveBotPrice,
        bot_amount_snapshot: botAmount,
        status: "Pending"
      };

      const { data: invoice } = await supabase
        .from('request_money')
        .insert(invoiceItem)
        .select()
        .single();

      return {
        tool: "createInvoice",
        success: true,
        amount: Number(amount),
        currency: normalizedCurrency,
        recipient: recipient || "Open Customer",
        message: normalizedCurrency === 'USD'
          ? `📄 Created a $${Number(amount).toFixed(2)} invoice for ${recipient}. Current estimate: ${botAmount.toFixed(8)} BOT at $${liveBotPrice.toFixed(6)}/BOT; payment uses the live Coinstore rate.`
          : `📄 Created Invoice for ${amount} ${normalizedCurrency}.`
      };
    }

    case "getRate": {
      let botPrice = 9.72;
      try {
        const priceRes = await fetch('https://dex-wallet.botchain.ai/api/graph/price?token=0xD5452816194a3784dBa983426cCe7c122F4abd30');
        const priceData = await priceRes.json();
        if (priceData?.success && priceData.data?.price) {
          botPrice = parseFloat(priceData.data.price);
        }
      } catch (e) {}
      return {
        tool: "getRate",
        success: true,
        rate: botPrice,
        message: `💎 Current BOT/USD Rate: $${botPrice.toFixed(6)} per BOT`
      };
    }

    case "getWallet": {
      const { data: userObj } = await supabase
        .from('profiles')
        .select('internal_wallet_address, metamask_id, external_wallet')
        .eq('id', userId)
        .single();

      const internalAddr = userObj?.internal_wallet_address || 'Not set';
      const externalAddr = userObj?.metamask_id || userObj?.external_wallet || 'Not connected';

      const msg = `🏦 Internal Vault: ${internalAddr}\n🔗 External Web3: ${externalAddr}`;

      return {
        tool: "getWallet",
        success: true,
        internalAddress: internalAddr,
        externalAddress: externalAddr,
        message: msg
      };
    }

    case "switchPrimary": {
      const { data: userObj } = await supabase
        .from('profiles')
        .select('primary_receiving_wallet')
        .eq('id', userId)
        .single();

      const current = String(userObj?.primary_receiving_wallet || 'internal').toLowerCase();
      const { target } = args;
      const targetType = target && ['internal', 'external'].includes(target.toLowerCase())
        ? target.toLowerCase()
        : null;

      if (targetType && targetType === current) {
        return {
          tool: "switchPrimary",
          success: true,
          primaryReceivingWallet: current,
          message: `ℹ️ Primary receiving wallet is already set to ${current === 'external' ? 'External Web3 Wallet' : 'Internal Vault'}. No change needed.`
        };
      }

      const newType = targetType || (current === 'external' ? 'internal' : 'external');

      const { error } = await supabase
        .from('profiles')
        .update({ primary_receiving_wallet: newType })
        .eq('id', userId);

      if (error) {
        return { tool: "switchPrimary", success: false, message: `❌ Failed to update primary wallet: ${error.message}` };
      }

      return {
        tool: "switchPrimary",
        success: true,
        primaryReceivingWallet: newType,
        message: `✅ Primary receiving wallet switched to ${newType === 'external' ? 'External Web3 Wallet' : 'Internal Vault'}.`
      };
    }

    case "getHelp": {
      const helpMsg = `📋 Commands\n\n/send — Send BOT\n/balance — View balances\n/history — Transaction log\n/rate — Live BOT price\n/wallet — Your addresses\n/primary — Switch wallet\n/find — Search users\n/schedule — Future payment\n/cancel — Cancel a schedule\n/invoice — Create invoice\n\nTip: Type naturally like "Send 5 BOT to @user"`;

      return {
        tool: "getHelp",
        success: true,
        message: helpMsg
      };
    }

    case "cancelSchedulePayment": {
      const { transferId } = args;

      let transfer;
      if (transferId) {
        const { data } = await supabase
          .from('money_transfers')
          .select('*')
          .eq('id', transferId)
          .eq('sender_id', userId)
          .maybeSingle();
        transfer = data;
      } else {
        const { data } = await supabase
          .from('money_transfers')
          .select('*')
          .eq('sender_id', userId)
          .in('status', ['PENDING', 'FUNDED'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        transfer = data;
      }

      if (!transfer) {
        return { tool: "cancelSchedulePayment", success: false, message: "❌ No scheduled payment found to cancel." };
      }

      const managerAddress = process.env.GLOBAL_PAY_MANAGER_ADDRESS || "0x6F3B1DC09A8C968F0B829276570bCF10AB9858c1";

      let meta = null;
      try { meta = JSON.parse(transfer.raw_signed_tx || '{}'); } catch { meta = null; }
      const contractPaymentId = meta?.paymentId || null;

      if (transfer.status === 'FUNDED' || (transfer.status === 'PENDING' && contractPaymentId)) {
        // Already on-chain — requires MetaMask cancel tx
        return {
          tool: "cancelSchedulePayment",
          success: true,
          requiresAuth: true,
          actionRequired: true,
          cancelAction: true,
          transferId: transfer.id,
          contractPaymentId,
          contractAddress: managerAddress,
          recipient: transfer.receiver_pay_tag || 'Unknown',
          amount: Number(transfer.bot_amount || transfer.amount || 0),
          message: `🔍 Found scheduled transfer #${transfer.id} (${transfer.status}) to ${transfer.receiver_pay_tag || 'Unknown'} for ${Number(transfer.bot_amount || transfer.amount || 0)} BOT.\n\nTo cancel and refund, click "Cancel & Refund" below. This will send a cancel transaction to the GlobalPay Manager contract via MetaMask.`
        };
      }

      // Not yet funded — just mark FAILED in DB (CANCELLED is not in the status check constraint)
      const { error } = await supabase
        .from('money_transfers')
        .update({ status: 'FAILED' })
        .eq('id', transfer.id);

      if (error) {
        return { tool: "cancelSchedulePayment", success: false, message: `❌ Failed to cancel: ${error.message}` };
      }

      return {
        tool: "cancelSchedulePayment",
        success: true,
        message: `✅ Scheduled payment #${transfer.id} cancelled (not yet funded on-chain).`
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
};
