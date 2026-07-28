import { supabase } from '../config/supabaseClient.js';
import { ethers } from 'ethers';

const RPC_URL = process.env.BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
const RECOVERY_INTERVAL_MS = 35 * 1000;
const TIMEOUT_EXPIRED_MS = 15 * 60 * 1000;

export const startBroadcastRecoveryWorker = () => {
  console.log("🔄 [RECOVERY WORKER] Broadcast Reconciliation Worker Started.");

  setInterval(async () => {
    try {
      // Fetch transfers stuck in pending or broadcast state with non-null transaction hashes
      const { data: broadcastTxs } = await supabase
        .from('money_transfers')
        .select('*')
        .in('status', ['PENDING', 'pending', 'BROADCAST'])
        .not('tx_hash', 'is', null);

      if (!broadcastTxs || broadcastTxs.length === 0) return;

      const provider = new ethers.JsonRpcProvider(RPC_URL);

      for (const tx of broadcastTxs) {
        // Skip scheduled payments — only the scheduler worker should mark those as COMPLETED after on-chain release
        try {
          if (tx.raw_signed_tx === 'AWAITING_APPROVAL') continue;
          if (tx.raw_signed_tx) {
            const parsed = JSON.parse(tx.raw_signed_tx);
            if (parsed?.type === 'paymentManager') continue;
          }
        } catch { /* non-JSON raw_signed_tx, proceed */ }

        try {
          const receipt = await provider.getTransactionReceipt(tx.tx_hash);
          const ageMs = Date.now() - new Date(tx.created_at).getTime();

          if (receipt) {
            if (receipt.status === 1) {
              console.log(`✅ [RECOVERY WORKER] Reconciled TX ${tx.tx_hash} -> CONFIRMED`);
              
              await supabase
                .from('money_transfers')
                .update({ status: 'COMPLETED', block_number: receipt.blockNumber })
                .eq('id', tx.id);

              if (tx.receiver_id) {
                const { data: receiverBank } = await supabase
                  .from('bank_details')
                  .select('*')
                  .eq('user_id', tx.receiver_id)
                  .maybeSingle();

                if (receiverBank) {
                  const newBal = Number(receiverBank.usdc_balance || 0) + Number(tx.bot_amount || tx.amount || 0);
                  await supabase
                    .from('bank_details')
                    .update({ usdc_balance: newBal })
                    .eq('id', receiverBank.id);
                }
              }
            } else if (receipt.status === 0) {
              console.log(`❌ [RECOVERY WORKER] Reconciled TX ${tx.tx_hash} -> FAILED`);
              await supabase
                .from('money_transfers')
                .update({ status: 'FAILED' })
                .eq('id', tx.id);
            }
          } else if (ageMs > TIMEOUT_EXPIRED_MS) {
            console.log(`⏳ [RECOVERY WORKER] Transaction ${tx.id} timed out -> EXPIRED`);
            await supabase
              .from('money_transfers')
              .update({ status: 'FAILED' })
              .eq('id', tx.id);
          }
        } catch (singleErr) {
          console.error(`[RECOVERY WORKER] Failed to process TX ${tx.id}:`, singleErr.message);
        }
      }
    } catch (err) {
      console.error("[RECOVERY WORKER] Worker loop error:", err.message);
    }
  }, RECOVERY_INTERVAL_MS);
};
