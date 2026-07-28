import React, { useState, useEffect, useRef } from 'react';
import { useSDK, useAddress, getMpcAccount, mpcChain, useNetwork } from '../utils/mpcWallet';
import { ethers } from 'ethers';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import {
  FiCheckCircle,
  FiX,
  FiZap,
  FiShield,
  FiExternalLink,
  FiShare2,
  FiDownload,
  FiCopy,
  FiCheck,
  FiCreditCard,
  FiSmartphone,
  FiArrowRight
} from 'react-icons/fi';
import api from '../utils/api';

const QRPaymentModal = ({ isOpen, onClose, qrData, user }) => {
  const sdk = useSDK();
  const address = useAddress();
  const navigate = useNavigate();
  const [, switchChain] = useNetwork();

  const [loading, setLoading] = useState(false);
  const [successData, setSuccessData] = useState(null);
  const [copied, setCopied] = useState(false);

  // Editable Amount state (defaults to scanned amount or empty for user input)
  const initialAmt = qrData?.amount && Number(qrData.amount) > 0 ? String(qrData.amount) : '';
  const [editableAmount, setEditableAmount] = useState(initialAmt);
  const [editableMemo, setEditableMemo] = useState(qrData?.memo || '');
  const hasSelectedWalletRail = useRef(false);

  // Wallet Rail State: 'internal' | 'external'
  const internalBal = user?.bankDetails?.usdcBalance || user?.bankDetails?.internalBalance || 0;
  const [walletRail, setWalletRail] = useState('internal');

  // Refresh form values when invoice details arrive. Do not clear a completed
  // payment here: the parent can re-render while user/profile data loads and
  // would otherwise replace the receipt with the settlement form.
  useEffect(() => {
    if (qrData) {
      const amt = qrData.amount && Number(qrData.amount) > 0 ? String(qrData.amount) : '';
      setEditableAmount(amt);
      setEditableMemo(qrData.memo || '');
      const payNum = Number(amt) || 0;
      // Pick a sensible default while data is loading, but never override a
      // wallet rail selected by the user.
      if (!hasSelectedWalletRail.current) {
        if (internalBal >= payNum && payNum > 0) {
          setWalletRail('internal');
        } else {
          setWalletRail('external');
        }
      }
    }
  }, [qrData, internalBal]);

  const handleModalClose = () => {
    const isSuccess = Boolean(successData);
    const isExt = successData?.senderWalletType === 'external';
    setSuccessData(null);
    onClose();
    if (isSuccess) {
      if (isExt) {
        window.location.href = '/profile';
      } else {
        window.location.href = '/transfers';
      }
    }
  };

  if (!isOpen || !qrData) return null;

  const receiver = qrData.receiver || qrData.payTag || qrData.wallet || "Recipient";
  const walletAddress = qrData.wallet || "";
  const paymentId = qrData.paymentId || "";
  const estimatedGas = walletRail === 'internal' ? "0.0000 BOT (Vault Gasless)" : "0.0001 BOT";
  const explorerUrl = import.meta.env.VITE_BOTCHAIN_EXPLORER_URL || "https://scan.botchain.ai/";
  const currentPayAmt = Number(editableAmount) > 0 ? Number(editableAmount) : 0;

  // Handle Payment Execution
  const handleConfirmPayment = async () => {
    if (currentPayAmt <= 0) {
      toast.error("Please enter a valid BOT payment amount.");
      return;
    }

    setLoading(true);
    // Supabase request_money records use UUIDs. Keep legacy Mongo ObjectIds
    // valid too, so paymentWrite receives the invoice id and can mark it Paid.
    const validReqId = typeof paymentId === 'string' && (
      /^[0-9a-fA-F]{24}$/.test(paymentId) ||
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(paymentId)
    ) ? paymentId : undefined;

    // ─── RAIL A: INTERNAL VAULT PAYMENT (No Wallet Extension Needed) ───
    if (walletRail === 'internal') {
      if (internalBal < currentPayAmt) {
        toast.error(`Insufficient Internal Vault balance (${internalBal.toFixed(4)} BOT). Switch to External Wallet.`);
        setLoading(false);
        return;
      }

      const account = getMpcAccount();
      if (!account) {
        toast.error("Internal MPC Wallet not connected yet. Please refresh and try again.");
        setLoading(false);
        return;
      }

      const toastId = toast.loading("Resolving receiver and connecting to MPC Wallet...");

      try {
        // 1. Resolve receiver target wallet address
        let targetDestination = ethers.utils.isAddress(qrData?.wallet) ? qrData.wallet : '';

        if (!targetDestination) {
          const cleanTag = receiver.replace(/^@/, '').trim();
          try {
            const detailRes = await api.get(`/auth/fetchdetail?upi=${cleanTag}`);
            targetDestination = detailRes.data?.receiverWalletAddress || detailRes.data?.internalWalletAddress || detailRes.data?.metamask;
          } catch (lookupErr) {
            console.warn("Paytag lookup failed, falling back to QR wallet field:", lookupErr.message);
          }
        }

        // Last resort: raw qrData.wallet even if ethers says invalid
        if (!targetDestination) {
          targetDestination = qrData?.wallet || '';
        }

        if (!targetDestination) {
          throw new Error("Receiver does not have a valid receiving wallet address.");
        }

        toast.loading("Signing & broadcasting transaction from MPC Wallet...", { id: toastId });

        // Calculate value in bigint
        const tokenValueBig = BigInt(ethers.utils.parseUnits(currentPayAmt.toFixed(18), 18).toString());

        const txResult = await account.sendTransaction({
          to: targetDestination,
          value: tokenValueBig
        });

        const txHash = txResult.transactionHash;

        toast.loading("Recording transaction log on GlobalPay...", { id: toastId });

        try {
          await api.post("/pay/paymentWrite", {
            date: new Date().toISOString(),
            to: receiver,
            amt: currentPayAmt,
            sender: user?._id || user?.id,
            keyword: editableMemo || (qrData?.type === 'request' ? "Request Payment" : "QR Payment"),
            coin: "BOT",
            txHash: txHash,
            botAmountSnapshot: currentPayAmt,
            senderWalletType: "internal",
            destinationAddress: targetDestination,
            reqId: validReqId
          });
        } catch (writeErr) {
          console.warn("Payment log write failed (tx confirmed on-chain):", writeErr.message);
        }

        toast.dismiss(toastId);
        toast.success("Internal MPC Vault Payment Completed!");

        setSuccessData({
          txHash: txHash,
          amount: currentPayAmt,
          receiver: receiver,
          wallet: targetDestination,
          timestamp: new Date().toLocaleString(),
          rail: "Internal Vault",
          senderWalletType: "internal"
        });
        setLoading(false);
      } catch (err) {
        console.error("Internal Vault Payment Error:", err);
        toast.dismiss(toastId);
        toast.error(err.response?.data?.message || err.message || "Internal Vault payment failed.");
        setLoading(false);
      }
      return;
    }

    // ─── RAIL B: EXTERNAL WEB3 WALLET (MetaMask) ───
    if (!address) {
      toast.error("MetaMask not connected. Redirecting to CryptUPI Checkout...");
      setLoading(false);
      onClose();
      navigate(`/payments?upi=${encodeURIComponent(receiver)}&amount=${currentPayAmt}&memo=${encodeURIComponent(editableMemo)}&reqId=${paymentId}`);
      return;
    }

    const toastId = toast.loading("Sending payment request to wallet...");

    try {
      let targetDestination = ethers.utils.isAddress(qrData?.wallet) ? qrData.wallet : '';

      if (!targetDestination) {
        const cleanTag = receiver.replace(/^@/, '').trim();
        try {
          const detailRes = await api.get(`/auth/fetchdetail?upi=${cleanTag}`);
          targetDestination = detailRes.data?.receiverWalletAddress || detailRes.data?.internalWalletAddress || detailRes.data?.metamask;
        } catch (lookupErr) {
          console.warn("Paytag lookup failed, falling back to QR wallet field:", lookupErr.message);
        }
      }

      if (!targetDestination) {
        targetDestination = qrData?.wallet || '';
      }

      if (!targetDestination || !ethers.utils.isAddress(targetDestination)) {
        throw new Error("Could not resolve a valid destination address for this QR payment.");
      }

      const finalDestination = targetDestination;

      const signer = await sdk?.getSigner();
      if (!signer) {
        throw new Error("Wallet signer unavailable. Please check your Web3 wallet.");
      }

      // Switch chain to BOT Chain (Chain ID: 677) using Privy switch helper
      try {
        await switchChain(677);
      } catch (err) {
        console.warn("Privy switchChain helper failed, falling back to window.ethereum:", err);
      }

      // Ensure MetaMask is switched to BOT Chain (Chain ID: 677 / 0x2a5)
      if (window.ethereum) {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x2a5' }],
          });
        } catch (switchError) {
          if (switchError.code === 4902) {
            try {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: '0x2a5',
                  chainName: 'BOT Chain',
                  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
                  rpcUrls: ['https://rpc.botchain.ai'],
                  blockExplorerUrls: ['https://scan.botchain.ai/']
                }]
              });
            } catch (addError) {
              console.error("Failed to add BOT Chain to MetaMask:", addError);
            }
          } else {
            console.error("Failed to switch to BOT Chain:", switchError);
          }
        }
      }

      const tokenAmount = ethers.utils.parseUnits(currentPayAmt.toFixed(18), 18);

      const senderAddress = await signer.getAddress();
      const balance = await signer.getBalance();
      const gasPrice = await signer.getGasPrice();
      let estimatedGasLimit = ethers.BigNumber.from(21000);
      try {
        estimatedGasLimit = await signer.estimateGas({
          to: finalDestination,
          value: tokenAmount
        });
      } catch (err) {
        console.warn("Gas estimation failed:", err);
      }
      const estimatedFee = estimatedGasLimit.mul(gasPrice);
      const requiredAmount = tokenAmount.add(estimatedFee);

      if (balance.lt(requiredAmount)) {
        toast.dismiss(toastId);
        toast.error("Insufficient BOT balance");
        throw new Error("Insufficient BOT balance");
      }

      toast.loading("Confirming transaction on BOT Chain...", { id: toastId });

      const tx = await signer.sendTransaction({
        to: finalDestination,
        value: tokenAmount
      });

      await tx.wait();

      try {
        await api.post("/pay/paymentWrite", {
          date: new Date().toISOString(),
          to: receiver,
          amt: currentPayAmt,
          sender: user?._id || user?.id,
          keyword: editableMemo || (qrData?.type === 'request' ? "Request Payment" : "QR Payment"),
          coin: "BOT",
          txHash: tx.hash,
          botAmountSnapshot: currentPayAmt,
          // Dual-wallet: QR payment via external MetaMask/Web3 wallet
          senderWalletType: "external",
          destinationAddress: finalDestination,
          reqId: validReqId
        });
      } catch (writeErr) {
        console.warn("Payment log write failed (tx confirmed on-chain):", writeErr.message);
      }

      toast.dismiss(toastId);
      toast.success("External Wallet Payment Completed!");

      setSuccessData({
        txHash: tx.hash,
        amount: currentPayAmt,
        receiver: receiver,
        wallet: finalDestination,
        timestamp: new Date().toLocaleString(),
        rail: "External Web3 Wallet",
        senderWalletType: "external"
      });
      setLoading(false);
    } catch (err) {
      console.error("External Payment Failed:", err);
      toast.dismiss(toastId);
      toast.error(err.reason || err.message || "External payment execution failed.");
      setLoading(false);
    }
  };

  const copyTxHash = () => {
    if (!successData?.txHash) return;
    navigator.clipboard.writeText(successData.txHash);
    setCopied(true);
    toast.success("Transaction hash copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareReceipt = () => {
    if (!successData) return;
    const shareText = `⚡ GlobalPay Payment Receipt\nPaid: ${successData.amount} BOT to ${successData.receiver}\nRail: ${successData.rail}\nTx Hash: ${successData.txHash}\nExplorer: ${explorerUrl}/tx/${successData.txHash}`;
    if (navigator.share) {
      navigator.share({
        title: 'GlobalPay Payment Receipt',
        text: shareText,
        url: `${explorerUrl}/tx/${successData.txHash}`
      }).catch(() => { });
    } else {
      navigator.clipboard.writeText(shareText);
      toast.success("Receipt details copied to clipboard!");
    }
  };

  const downloadReceipt = () => {
    if (!successData) return;
    const content = `==================================
GLOBALPAY PAYMENT RECEIPT
BOT CHAIN MAINNET
==================================
Status: CONFIRMED
Amount: ${successData.amount} BOT
Payment Rail: ${successData.rail}
Recipient: ${successData.receiver}
Destination Wallet: ${successData.wallet}
Tx Hash: ${successData.txHash}
Timestamp: ${successData.timestamp}
==================================
Verified on BOT Chain Mainnet`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `GlobalPay_Receipt_${String(successData.txHash).substring(0, 8)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-zinc-800 w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col font-sans relative">

        {/* Header */}
        <div className="p-5 border-b border-zinc-800/80 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <FiZap size={18} />
            </div>
            <div>
              <h3 className="text-white text-base font-bold tracking-tight">
                {successData ? "Payment Receipt" : (qrData?.type === 'request' ? "Settle Invoice" : "Confirm QR Payment")}
              </h3>
              <p className="text-zinc-400 text-xs font-semibold">BOT Chain Mainnet Settlement</p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            className="w-8 h-8 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <FiX size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {successData ? (
            /* ─── SUCCESS RECEIPT VIEW ─── */
            <div className="flex flex-col items-center text-center space-y-4 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center text-emerald-400 text-3xl shadow-[0_0_25px_rgba(16,185,129,0.3)]">
                <FiCheckCircle />
              </div>

              <div>
                <h4 className="text-emerald-400 text-base font-black uppercase tracking-wider">Payment Confirmed!</h4>
                <p className="text-zinc-400 text-xs mt-1">Verified on BOT Chain Mainnet</p>
              </div>

              <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-4 w-full">
                <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Total Paid ({successData.rail})</p>
                <p className="text-3xl font-black text-white tracking-tight mt-1">{successData.amount.toFixed(4)} BOT</p>
                <p className="text-amber-400 text-xs font-bold mt-1">Receiver: {successData.receiver}</p>
              </div>

              <div className="bg-zinc-900/40 border border-zinc-800/80 rounded-2xl p-4 w-full text-left space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-500 font-medium">Tx Hash:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-white font-mono text-[11px] truncate max-w-[150px]">
                      {successData.txHash}
                    </span>
                    <button onClick={copyTxHash} className="text-zinc-400 hover:text-white">
                      {copied ? <FiCheck className="text-emerald-400" /> : <FiCopy />}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between">
                  <span className="text-zinc-500 font-medium">Payment Rail:</span>
                  <span className="text-amber-400 font-bold">{successData.rail}</span>
                </div>

                <div className="flex justify-between">
                  <span className="text-zinc-500 font-medium">Timestamp:</span>
                  <span className="text-zinc-300 font-semibold">{successData.timestamp}</span>
                </div>
              </div>

              <div className="flex flex-col w-full gap-2 pt-2">
                {successData.txHash.startsWith("0x") && (
                  <a
                    href={`${explorerUrl}/tx/${successData.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 transition-colors shadow-lg"
                  >
                    <FiExternalLink size={15} /> View on BOTScan ↗
                  </a>
                )}

                <div className="flex gap-2 w-full">
                  <button
                    onClick={shareReceipt}
                    className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 border border-zinc-700 transition-colors"
                  >
                    <FiShare2 size={14} /> Share Receipt
                  </button>
                  <button
                    onClick={downloadReceipt}
                    className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 border border-zinc-700 transition-colors"
                  >
                    <FiDownload size={14} /> Download Receipt
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* ─── CONFIRMATION VIEW WITH EDITABLE AMOUNT & WALLET RAIL SELECTOR ─── */
            <div className="space-y-4">

              {/* Editable BOT Amount Section */}
              {(() => {
                const hasEncodedAmount = Boolean(qrData && qrData.amount && Number(qrData.amount) > 0);
                return (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4 text-center">
                    <p className="text-amber-400 text-[10px] font-black uppercase tracking-widest mb-1.5">
                      {hasEncodedAmount ? (qrData?.type === 'request' ? "Requested Amount (BOT)" : "Merchant Locked Amount (BOT)") : "Enter Payment Amount (BOT)"}
                    </p>
                    <div className="flex items-center justify-center gap-1.5">
                      <input
                        type="number"
                        step="0.0001"
                        placeholder="0.0000"
                        value={editableAmount}
                        onChange={(e) => !hasEncodedAmount && setEditableAmount(e.target.value)}
                        readOnly={hasEncodedAmount}
                        disabled={hasEncodedAmount}
                        style={{ backgroundColor: '#09090b', color: '#ffffff' }}
                        className={`w-full max-w-[200px] text-center text-2xl font-black border border-amber-500/40 rounded-xl px-3 py-2 outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-all placeholder-zinc-600 ${hasEncodedAmount ? "opacity-75 cursor-not-allowed border-zinc-700 bg-zinc-950" : ""
                          }`}
                      />
                      <span className="text-amber-400 font-black text-sm">BOT</span>
                    </div>
                    {hasEncodedAmount && (
                      <p className="text-amber-500 text-[10px] font-black uppercase tracking-wider mt-2 flex items-center justify-center gap-1">
                        🔒 {qrData?.type === 'request' ? "Amount locked by payment request" : "Amount locked by merchant QR"}
                      </p>
                    )}
                    <p className="text-zinc-400 text-xs font-semibold mt-1">
                      Recipient: <span className="text-white font-bold">{receiver}</span>
                    </p>
                  </div>
                );
              })()}

              {/* Wallet Rail Selection: Internal Vault vs External Web3 Wallet */}
              <div className="space-y-2">
                <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider">Select Payment Wallet</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      hasSelectedWalletRail.current = true;
                      setWalletRail('internal');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${walletRail === 'internal'
                      ? 'bg-amber-500/10 border-amber-500 text-white shadow-md'
                      : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs text-amber-400 flex items-center gap-1">
                        <FiShield size={13} /> Internal Vault
                      </span>
                      {walletRail === 'internal' && <FiCheck className="text-amber-400" />}
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">
                      Bal: {internalBal.toFixed(4)} BOT
                    </span>
                    <span className="text-[9px] text-zinc-500 mt-1">No extension needed</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      hasSelectedWalletRail.current = true;
                      setWalletRail('external');
                    }}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${walletRail === 'external'
                      ? 'bg-secondary/10 border-secondary text-white shadow-md'
                      : 'bg-zinc-900/50 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                      }`}
                  >
                    <div className="flex items-center justify-between w-full mb-1">
                      <span className="font-bold text-xs text-secondary flex items-center gap-1">
                        <FiCreditCard size={13} /> External Web3
                      </span>
                      {walletRail === 'external' && <FiCheck className="text-secondary" />}
                    </div>
                    <span className="text-[11px] font-semibold text-zinc-300">
                      MetaMask / OKX
                    </span>
                    <span className="text-[9px] text-zinc-500 mt-1">On-chain signature</span>
                  </button>
                </div>
              </div>

              {/* Detailed Specs List */}
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-2.5 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-semibold">Payment Memo:</span>
                  <input
                    type="text"
                    placeholder="Memo / Order note"
                    value={editableMemo}
                    onChange={(e) => setEditableMemo(e.target.value)}
                    style={{ backgroundColor: '#09090b', color: '#ffffff' }}
                    className="px-2 py-1 border border-zinc-800 rounded-lg text-right text-xs font-semibold placeholder-zinc-600 outline-none focus:border-amber-500 max-w-[170px]"
                  />
                </div>

                <div className="flex justify-between items-center">
                  <span className="text-zinc-400 font-semibold">Network:</span>
                  <span className="text-amber-400 font-bold flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    BOT Chain Mainnet
                  </span>
                </div>

                <div className="flex justify-between items-center border-t border-zinc-800/80 pt-2">
                  <span className="text-zinc-400 font-semibold">Estimated Gas:</span>
                  <span className="text-zinc-400 font-bold">{estimatedGas}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleModalClose}
                  disabled={loading}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold rounded-xl text-xs border border-zinc-700 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmPayment}
                  disabled={loading}
                  className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black rounded-xl text-xs flex items-center justify-center gap-2 transition-colors shadow-lg disabled:opacity-50"
                >
                  {loading ? (
                    <span>Processing...</span>
                  ) : (
                    <>
                      <FiZap size={15} /> Pay {currentPayAmt > 0 ? `${currentPayAmt.toFixed(4)} BOT` : "BOT"}
                    </>
                  )}
                </button>
              </div>

              {/* Quick Checkout Link */}
              {walletRail === 'external' && (
                <button
                  onClick={() => {
                    onClose();
                    navigate(`/payments?upi=${encodeURIComponent(receiver)}&amount=${currentPayAmt}&memo=${encodeURIComponent(editableMemo)}&reqId=${paymentId}`);
                  }}
                  className="w-full text-center text-xs text-amber-400 font-bold hover:underline pt-1 flex items-center justify-center gap-1"
                >
                  Or Open Payments Full Checkout Page <FiArrowRight size={12} />
                </button>
              )}

            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between text-xs text-zinc-500 font-medium">
          <div className="flex items-center gap-1.5">
            <FiShield className="text-amber-500" />
            <span>Web3 Vault Protocol</span>
          </div>
          <span>Powered by BOT Chain</span>
        </div>

      </div>
    </div>
  );
};

export default QRPaymentModal;
