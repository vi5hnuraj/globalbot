import { supabase } from '../config/supabaseClient.js';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';

const RPC_URL = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
const POLL_INTERVAL_MS = 30 * 1000;

function getContractData() {
  const filePath = path.resolve('globalPayData.json');
  if (!fs.existsSync(filePath)) {
    return {
      address: process.env.GLOBAL_PAY_MANAGER_ADDRESS || "0x6F3B1DC09A8C968F0B829276570bCF10AB9858c1",
      abi: [
        {
          "inputs": [{"internalType": "bytes32","name": "id","type": "bytes32"}],
          "name": "release","outputs": [],"stateMutability": "nonpayable","type": "function"
        },
        {
          "inputs": [{"internalType": "bytes32","name": "id","type": "bytes32"}],
          "name": "getPayment","outputs": [
            {"internalType": "uint8","name":"","type":"uint8"},
            {"internalType": "uint8","name":"","type":"uint8"},
            {"internalType": "address","name":"","type":"address"},
            {"internalType": "address","name":"","type":"address"},
            {"internalType": "uint256","name":"","type":"uint256"},
            {"internalType": "uint256","name":"","type":"uint256"},
            {"internalType": "bytes32","name":"","type":"bytes32"}
          ],"stateMutability": "view","type": "function"
        }
      ]
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

const createPaymentsRecord = async (payment, txHash) => {
  // Check if a payments record already exists for this release tx
  if (txHash) {
    const { data: existing } = await supabase
      .from('payments')
      .select('id, keyword')
      .eq('tx_hash', txHash)
      .maybeSingle();
    if (existing) {
      if (existing.keyword !== 'Scheduled Payment (Released)') {
        await supabase.from('payments').update({ keyword: 'Scheduled Payment (Released)' }).eq('id', existing.id);
      }
      return;
    }
  }
  await supabase.from('payments').insert({
    sender_id: payment.sender_id,
    sender_pay_tag: payment.sender_pay_tag,
    receiver_id: payment.receiver_id,
    amount: payment.amount,
    bot_amount_snapshot: payment.bot_amount || payment.amount,
    coin: 'BOT',
    tx_hash: txHash || payment.tx_hash,
    recipient_pay_tag: payment.receiver_pay_tag,
    keyword: 'Scheduled Payment (Released)',
    sender_wallet_type: payment.sender_wallet_type || 'external',
    receiving_wallet_type: payment.receiving_wallet_type || 'internal',
    destination_address: payment.destination_address || payment.receiver_wallet_address,
    sender_wallet_address: payment.sender_wallet_address || null,
    receiver_wallet_address: payment.receiver_wallet_address || null,
    created_at: new Date().toISOString()
  }).select().maybeSingle();
};

/** Recover stuck schedules where raw_signed_tx = 'AWAITING_APPROVAL' or raw_signed_tx is not a valid JSON (funded on-chain but storeContractFunding never called). */
const recoverStuckSchedules = async () => {
  try {
    const { data: stuck } = await supabase
      .from('money_transfers')
      .select('id, tx_hash, amount, sender_wallet_address, receiver_wallet_address, sender_id, raw_signed_tx')
      .eq('status', 'PENDING');
    if (!stuck || stuck.length === 0) return;
    const toRecover = stuck.filter(r => {
      if (r.raw_signed_tx === 'AWAITING_APPROVAL') return true;
      if (!r.raw_signed_tx || !r.tx_hash) return false;
      try { const m = JSON.parse(r.raw_signed_tx); return !(m?.type === 'paymentManager' && m?.paymentId); }
      catch { return true; }
    });
    if (toRecover.length === 0) return;
    console.log(`⏰ [SCHEDULER WORKER] Found ${toRecover.length} stuck schedules to recover`);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contractData = getContractData();
    const contract = new ethers.Contract(contractData.address, contractData.abi, provider);

    for (const record of toRecover) {
      try {
        console.log(`⏰ [SCHEDULER WORKER] Processing stuck ${record.id}: amt=${record.amount} recv=${(record.receiver_wallet_address || '').substring(0, 24)} tx=${(record.tx_hash || '').substring(0, 20)}`);
        // First try to find PaymentCreated from the tx_hash if available
        let paymentId = null;
        let fundingTx = null;
        if (record.tx_hash?.startsWith('0x')) {
          try {
            const receipt = await provider.waitForTransaction(record.tx_hash, 1, 30000);
            if (receipt && receipt.status === 1) {
              const recoveryContract = new ethers.Contract(contractData.address, contractData.abi, provider);
              for (const log of receipt.logs) {
                try {
                  const parsed = recoveryContract.interface.parseLog({ topics: log.topics, data: log.data });
                  if (parsed?.name === 'PaymentCreated') {
                    paymentId = parsed.args.id;
                    fundingTx = record.tx_hash;
                    break;
                  }
                } catch (pl) { continue; }
              }
            }
          } catch (txErr) {
            console.log(`⏰ [SCHEDULER WORKER] Tx fetch failed for ${record.id}: ${txErr.message}`);
          }
        }
        // Fallback: scan recent events by receiver + amount
        if (!paymentId) {
          const currentBlock = await provider.getBlockNumber();
          const fromBlock = Math.max(0, currentBlock - 200000);
          const events = await contract.queryFilter('PaymentCreated', fromBlock, currentBlock);
          console.log(`⏰ [SCHEDULER WORKER] Scanned ${events.length} PaymentCreated events from ${fromBlock} to ${currentBlock}`);
          const amtExpected = ethers.parseUnits(Number(record.amount || 0).toFixed(18), 18).toString();
          const recvExpected = (record.receiver_wallet_address || '').toLowerCase();
          const matched = events.find(e => {
            const recvOnChain = String(e.args?.receiver || '').toLowerCase();
            const amtOnChain = String(e.args?.amount || '');
            return recvOnChain === recvExpected && amtOnChain === amtExpected;
          });
          if (!matched) {
            console.log(`⏰ [SCHEDULER WORKER] No match for ${record.id}`);
            continue;
          }
          paymentId = matched.args.id;
          fundingTx = matched.transactionHash;
        }
        if (!paymentId || !fundingTx) {
          console.log(`⏰ [SCHEDULER WORKER] Could not determine paymentId for ${record.id}`);
          continue;
        }
        const rawSignedTx = JSON.stringify({ type: 'paymentManager', paymentId, fundingTx });
        await supabase.from('money_transfers').update({ raw_signed_tx: rawSignedTx, tx_hash: fundingTx }).eq('id', record.id);
        console.log(`✅ [SCHEDULER WORKER] Recovered stuck schedule ${record.id} -> paymentId ${String(paymentId).substring(0, 30)}...`);
      } catch (rErr) {
        console.error(`⏰ [SCHEDULER WORKER] Recovery error for ${record.id}:`, rErr.message);
      }
    }
  } catch (err) {
    console.error("⏰ [SCHEDULER WORKER] recoverStuckSchedules error:", err.message);
  }
};

/** Backfill payments records for schedules released before the payments insert was added. */
const backfillMissingPayments = async () => {
  try {
    const { data: completed } = await supabase
      .from('money_transfers')
      .select('id, tx_hash, sender_id, receiver_id, amount, bot_amount, receiver_pay_tag, sender_wallet_type, receiving_wallet_type, destination_address, receiver_wallet_address, sender_wallet_address, raw_signed_tx')
      .eq('status', 'COMPLETED')
      .not('raw_signed_tx', 'is', null);
    if (!completed || completed.length === 0) return;
    for (const record of completed) {
      const releaseTxHash = record.tx_hash;
      if (!releaseTxHash) continue;
      const { data: existingPay } = await supabase
        .from('payments')
        .select('id')
        .eq('tx_hash', releaseTxHash)
        .maybeSingle();
      if (existingPay) continue;
      await supabase.from('payments').insert({
        sender_id: record.sender_id,
        sender_pay_tag: record.sender_pay_tag,
        receiver_id: record.receiver_id,
        amount: record.amount,
        bot_amount_snapshot: record.bot_amount || record.amount,
        coin: 'BOT',
        tx_hash: releaseTxHash,
        recipient_pay_tag: record.receiver_pay_tag,
        keyword: 'Scheduled Payment (Released)',
        sender_wallet_type: record.sender_wallet_type || 'external',
        receiving_wallet_type: record.receiving_wallet_type || 'internal',
        destination_address: record.destination_address || record.receiver_wallet_address,
        sender_wallet_address: record.sender_wallet_address || null,
        receiver_wallet_address: record.receiver_wallet_address || null
      }).select().maybeSingle();
      console.log(`✅ [SCHEDULER WORKER] Backfilled payments record for schedule ${record.id}`);
    }
  } catch (err) {
    console.error("⏰ [SCHEDULER WORKER] Backfill error:", err.message);
  }
};

export const startScheduledPaymentWorker = () => {
  console.log("⏰ [SCHEDULER WORKER] Started — auto-release relayer (non-custodial).");
  (async () => {
    await backfillMissingPayments();
    await recoverStuckSchedules();
    // Debug: dump ALL money_transfers to understand DB state
    try {
      const { data: all } = await supabase.from('money_transfers').select('id, status, raw_signed_tx, tx_hash, amount, sender_pay_tag').not('status', 'is', null);
      if (all) {
        for (const r of all) {
          const rtx = typeof r.raw_signed_tx === 'string' ? r.raw_signed_tx.substring(0, 80) : JSON.stringify(r.raw_signed_tx).substring(0, 80);
          console.log(`🔍 [SCHEDULER WORKER] DB: ${r.id.substring(0, 12)}... status=${r.status} raw=${rtx} tx=${(r.tx_hash || '').substring(0, 20)}`);
        }
      }
    } catch (e) {
      console.error("⏰ [SCHEDULER WORKER] DB dump error:", e.message);
    }
    // First immediate check so we don't wait 30s
    try {
      const { data: pending } = await supabase
        .from('money_transfers')
        .select('id, status, raw_signed_tx, sender_pay_tag')
        .eq('status', 'PENDING')
        .not('raw_signed_tx', 'is', null);
      console.log(`⏰ [SCHEDULER WORKER] Initial scan: ${pending?.length || 0} pending funded schedules`);
    } catch (e) {
      console.error("⏰ [SCHEDULER WORKER] Initial scan error:", e.message);
    }
  })();

  let lastCheckedBlock = null;

  setInterval(async () => {
    try {
      console.log("⏰ [SCHEDULER WORKER] Poll cycle...");
      const nowSeconds = Math.floor(Date.now() / 1000);

      const { data: duePayments } = await supabase
        .from('money_transfers')
        .select('*')
        .eq('status', 'PENDING')
        .not('raw_signed_tx', 'is', null);

      console.log(`⏰ [SCHEDULER WORKER] duePayments: ${duePayments?.length || 0}`);
      if (!duePayments || duePayments.length === 0) return;

      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const relayerKey = process.env.RELAYER_PRIVATE_KEY;

      if (!relayerKey) {
        console.error("⏰ [SCHEDULER WORKER] RELAYER_PRIVATE_KEY not set in .env");
        return;
      }

      const relayer = new ethers.Wallet(relayerKey, provider);
      const contractData = getContractData();
      const contract = new ethers.Contract(contractData.address, contractData.abi, relayer);

      for (const payment of duePayments) {
        try {
          let meta;
          let paymentId;
          try {
            meta = JSON.parse(payment.raw_signed_tx);
            if (meta?.type === 'paymentManager' && meta?.paymentId) {
              paymentId = meta.paymentId;
              // Repair missing fundingTx from old recovery code
              if (payment.tx_hash?.startsWith('0x') && !meta.fundingTx) {
                const fixed = JSON.stringify({ type: 'paymentManager', paymentId, fundingTx: payment.tx_hash });
                await supabase.from('money_transfers').update({ raw_signed_tx: fixed }).eq('id', payment.id);
                console.log(`⏰ [SCHEDULER WORKER] Repaired fundingTx for ${payment.id}`);
              }
            }
          } catch (e) {
            const raw = String(payment.raw_signed_tx || '').trim();
            if (payment.tx_hash?.startsWith('0x')) {
              // Try recovery for any non-JSON raw_signed_tx that has a tx_hash
              console.log(`⏰ [SCHEDULER WORKER] Attempting recovery for ${payment.id} from tx ${String(payment.tx_hash).substring(0, 20)}...`);
              try {
                const receipt = await provider.waitForTransaction(payment.tx_hash, 1, 30000);
                if (receipt && receipt.status === 1) {
                  const recoveryContract = new ethers.Contract(contractData.address, contractData.abi, provider);
                  for (const log of receipt.logs) {
                    try {
                      const parsed = recoveryContract.interface.parseLog({ topics: log.topics, data: log.data });
                      if (parsed?.name === 'PaymentCreated') {
                        paymentId = parsed.args.id;
                        const rawSignedTx = JSON.stringify({ type: 'paymentManager', paymentId, fundingTx: payment.tx_hash });
                        await supabase.from('money_transfers').update({ raw_signed_tx: rawSignedTx }).eq('id', payment.id);
                        console.log(`⏰ [SCHEDULER WORKER] Recovered paymentId for ${payment.id}: ${String(paymentId).substring(0, 30)}...`);
                        break;
                      }
                    } catch (pl) { continue; }
                  }
                }
              } catch (recoverErr) {
                console.log(`⏰ [SCHEDULER WORKER] Recovery failed for ${payment.id}: ${recoverErr.message}`);
              }
            }
            if (!paymentId) {
              console.log(`⏰ [SCHEDULER WORKER] Skipping ${payment.id}: raw=${raw.substring(0, 60)} tx_hash=${String(payment.tx_hash || '').substring(0, 20)}`);
            }
          }
          if (!paymentId) {
            const raw = String(payment.raw_signed_tx || '').trim();
            if (/^0x[a-fA-F0-9]{64}$/.test(raw)) {
              // Use the raw funding tx hash as the paymentId lookup fallback
              paymentId = raw;
            } else {
              console.log(`⏰ [SCHEDULER WORKER] Cannot determine paymentId for ${payment.id}`);
              continue;
            }
          }

          console.log(`⏰ [SCHEDULER WORKER] Checking payment ${payment.id} on-chain (paymentId=${(paymentId || '').substring(0, 20)}...)`);
          const onChain = await contract.getPayment(paymentId);
          console.log(`⏰ [SCHEDULER WORKER] Payment ${payment.id}: on-chain status=${Number(onChain[1])} releaseTime=${Number(onChain[5])} now=${nowSeconds}`);
          const pStatus = Number(onChain[1]);
          const releaseTime = Number(onChain[5]);

          // Check terminal on-chain states FIRST — these take priority even if release time is in the future
          if (pStatus === 2) {
            await supabase.from('money_transfers').update({ status: 'COMPLETED' }).eq('id', payment.id);
            console.log(`⏰ [SCHEDULER WORKER] Payment ${payment.id} already released on chain`);
            await createPaymentsRecord(payment, payment.tx_hash);
            continue;
          }

          if (pStatus === 3) {
            await supabase.from('money_transfers').update({ status: 'FAILED' }).eq('id', payment.id);
            console.log(`⏰ [SCHEDULER WORKER] Payment ${payment.id} already cancelled on chain`);
            continue;
          }

          if (nowSeconds < releaseTime) {
            const remain = releaseTime - nowSeconds;
            console.log(`⏰ [SCHEDULER WORKER] Payment ${payment.id}: skipping (release in ${Math.round(remain / 60)} min)`);
            continue;
          }

          if (pStatus !== 1) continue;

          console.log(`⏰ [SCHEDULER WORKER] Releasing payment ${payment.id} (${payment.amount} BOT → ${payment.receiver_pay_tag})`);
          const tx = await contract.release(paymentId);
          const receipt = await tx.wait(1);

          if (receipt.status !== 1) {
            await supabase.from('money_transfers').update({ status: 'FAILED' }).eq('id', payment.id);
            console.warn(`⏰ [SCHEDULER WORKER] Payment ${payment.id} release reverted`);
            continue;
          }

          await supabase
            .from('money_transfers')
            .update({ status: 'COMPLETED', tx_hash: receipt.hash, block_number: receipt.blockNumber })
            .eq('id', payment.id);

          // Create payments record so both sender and receiver see it in Profile activity
          await createPaymentsRecord(payment, receipt.hash);

          console.log(`✅ [SCHEDULER WORKER] Payment ${payment.id} released. TX: ${receipt.hash}`);
        } catch (singleErr) {
          console.error(`⏰ [SCHEDULER WORKER] Payment ${payment.id} error:`, singleErr.message);
          await supabase.from('money_transfers').update({ status: 'FAILED' }).eq('id', payment.id);
        }
      }

      // also listen for PaymentReleased events (catches releases by other callers)
      const contractDataFallback = getContractData();
      const readContract = new ethers.Contract(contractDataFallback.address, [
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"id","type":"bytes32"}],"name":"PaymentReleased","type":"event"},
        {"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"id","type":"bytes32"},{"indexed":false,"internalType":"uint256","name":"refundAmount","type":"uint256"}],"name":"PaymentCancelled","type":"event"}
      ], provider);

      const currentBlock = await provider.getBlockNumber();
      const fromBlock = lastCheckedBlock !== null ? lastCheckedBlock + 1 : currentBlock - 100;
      console.log(`⏰ [SCHEDULER WORKER] Event check: blocks ${fromBlock} -> ${currentBlock} (prev=${lastCheckedBlock})`);
      if (fromBlock <= currentBlock) {
        lastCheckedBlock = currentBlock;
        const events = await readContract.queryFilter('PaymentReleased', fromBlock, currentBlock);
        if (events.length > 0) console.log(`⏰ [SCHEDULER WORKER] Found ${events.length} PaymentReleased event(s) in range`);
        for (const event of events) {
          const eventPaymentId = event.args.id;
          console.log(`⏰ [SCHEDULER WORKER] PaymentReleased event: id=${String(eventPaymentId).substring(0, 30)}...`);
          const { data: matches } = await supabase
            .from('money_transfers')
            .select('id')
            .eq('status', 'PENDING')
            .not('raw_signed_tx', 'is', null);

          if (!matches) continue;
          for (const record of matches) {
            let meta;
            try { meta = JSON.parse(record.raw_signed_tx); } catch { continue; }
            if (meta?.type === 'paymentManager' && meta?.paymentId?.toLowerCase() === eventPaymentId.toLowerCase()) {
              await supabase.from('money_transfers').update({ status: 'COMPLETED', tx_hash: event.transactionHash, block_number: event.blockNumber }).eq('id', record.id);
              console.log(`✅ [SCHEDULER WORKER] Payment ${record.id} completed via event. TX: ${event.transactionHash}`);
            } else {
              console.log(`⏰ [SCHEDULER WORKER]   No match: rec=${record.id.substring(0, 12)}... metaPID=${(meta?.paymentId || '').substring(0, 20)}... eventPID=${String(eventPaymentId).substring(0, 20)}...`);
            }
          }
        }

        const cancelEvents = await readContract.queryFilter('PaymentCancelled', fromBlock, currentBlock);
        if (cancelEvents.length > 0) console.log(`⏰ [SCHEDULER WORKER] Found ${cancelEvents.length} PaymentCancelled event(s) in range`);
        for (const event of cancelEvents) {
          const eventPaymentId = event.args.id;
          const { data: matches } = await supabase
            .from('money_transfers')
            .select('id')
            .in('status', ['PENDING'])
            .not('raw_signed_tx', 'is', null);

          if (!matches) continue;
          for (const record of matches) {
            let meta;
            try { meta = JSON.parse(record.raw_signed_tx); } catch { continue; }
            if (meta?.type === 'paymentManager' && meta?.paymentId?.toLowerCase() === eventPaymentId.toLowerCase()) {
              await supabase.from('money_transfers').update({ status: 'FAILED', tx_hash: event.transactionHash }).eq('id', record.id);
              console.log(`✅ [SCHEDULER WORKER] Payment ${record.id} cancelled via event. TX: ${event.transactionHash}`);
            }
          }
        }
      }
    } catch (err) {
      console.error("[SCHEDULER WORKER] Loop error:", err.message);
    }
  }, POLL_INTERVAL_MS);
};
