import React, { useState, useEffect } from "react";
import { FiFileText, FiClock, FiCheckCircle, FiZap } from "react-icons/fi";
import api, { fetchLiveBotPrice } from "../utils/api";
import QRPaymentModal from "./QRPaymentModal";

const Reqpay = ({
  name,
  sender,
  amount,
  currency,
  requestedAmount,
  requestedCurrency,
  exchangeRateSnapshot,
  botPriceSnapshot,
  botAmountSnapshot,
  status,
  isSentByMe,
  reqId,
  receiverWalletAddress,
  receivingWalletType,
  createdAt,
  onSettle,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [rateDetails, setRateDetails] = useState(null);
  const [currentStatus, setCurrentStatus] = useState(status || "Pending");
  const [timeLeftStr, setTimeLeftStr] = useState("");
  const [liveBotPriceState, setLiveBotPriceState] = useState(null);
  const [liveReceiverWallet, setLiveReceiverWallet] = useState(receiverWalletAddress || "");
  const [liveReceivingWalletType, setLiveReceivingWalletType] = useState(receivingWalletType || "internal");

  React.useEffect(() => {
    setCurrentStatus(status || "Pending");
  }, [status]);

  React.useEffect(() => {
    const updateBotPrice = () => {
      fetchLiveBotPrice().then(price => {
        if (price > 0) setLiveBotPriceState(price);
      });
    };
    updateBotPrice();
    const interval = setInterval(updateBotPrice, 10000);
    return () => clearInterval(interval);
  }, []);

  // Re-resolve receiver's current primary wallet so changes made after invoice
  // creation are reflected at payment time.
  useEffect(() => {
    if (isSentByMe || currentStatus === "Paid" || currentStatus === "Completed" || currentStatus === "Settled") return;
    let cancelled = false;
    const resolveReceiver = async () => {
      try {
        const cleanTag = (sender || '').replace(/^@/, '').trim();
        if (!cleanTag) return;
        const res = await api.get(`/auth/fetchdetail?upi=${cleanTag}`);
        const data = res.data;
        if (cancelled) return;
        const isExt = String(data.primaryReceivingWallet || 'internal').toLowerCase() === 'external';
        setLiveReceiverWallet(isExt
          ? (data.metamask || data.receiverWalletAddress || '')
          : (data.internalWalletAddress || data.receiverWalletAddress || ''));
        setLiveReceivingWalletType(isExt ? 'external' : 'internal');
      } catch (err) {
        console.warn("Reqpay: failed to re-resolve receiver wallet:", err.message);
      }
    };
    resolveReceiver();
    return () => { cancelled = true; };
  }, [sender, isSentByMe, currentStatus]);

  React.useEffect(() => {
    const fetchUser = async () => {
      try {
        const cached = sessionStorage.getItem("reqpay_user_cache");
        if (cached) {
          const user = JSON.parse(cached);
          setCurrentUser(user);
          const region = user.region || "India";
          const cur = region === "Mexico" ? "MXN" : region === "Brazil" ? "BRL" : "INR";
          setRateDetails({
            currency: cur,
            botPrice: Number(user.bankDetails?.botPrice) || null,
          });
          return;
        }
        const res = await api.get("/auth/fetchdetail");
        const user = res.data;
        sessionStorage.setItem("reqpay_user_cache", JSON.stringify(user));
        setCurrentUser(user);
        const region = user.region || "India";
        const cur = region === "Mexico" ? "MXN" : region === "Brazil" ? "BRL" : "INR";
        setRateDetails({
          currency: cur,
          botPrice: Number(user.bankDetails?.botPrice) || null,
        });
      } catch (err) {
        console.warn("Reqpay: failed to fetch user:", err);
      }
    };
    fetchUser();
  }, []);

  // 24-Hour Countdown Timer Effect
  React.useEffect(() => {
    if (currentStatus === "Paid" || currentStatus === "Completed" || currentStatus === "Settled" || currentStatus === "Expired" || currentStatus === "Rejected") {
      setTimeLeftStr(currentStatus);
      return;
    }

    const createdMs = createdAt ? new Date(createdAt).getTime() : Date.now();
    const expiryMs = createdMs + 24 * 60 * 60 * 1000;

    const updateTimer = () => {
      const now = Date.now();
      const diff = expiryMs - now;

      if (diff <= 0) {
        setCurrentStatus("Expired");
        setTimeLeftStr("Expired");
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        const hStr = hours > 0 ? `${hours}h ` : "";
        const mStr = `${minutes}m `;
        const sStr = `${seconds}s remaining`;
        setTimeLeftStr(`${hStr}${mStr}${sStr}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [createdAt, currentStatus]);

  // Dynamic live BOT calculation protecting merchant USD value from price fluctuations
  const reqAmount = requestedAmount !== undefined && requestedAmount !== null ? Number(requestedAmount) : Number(amount || 0);
  const reqCurrency = (requestedCurrency || currency || "INR").toUpperCase();
  const rateSnapshot = Number(exchangeRateSnapshot) || 83.5;
  const liveBotPrice = Number(liveBotPriceState || rateDetails?.botPrice || botPriceSnapshot || 0);

  // Exact target USD value requested by merchant
  const targetUSD = reqCurrency === "USD" ? reqAmount : (reqAmount / rateSnapshot);
  // Recalculated required BOT amount based on LIVE BOT price so merchant receives exact USD value
  const liveBotRequiredAmount = liveBotPrice > 0 ? (targetUSD / liveBotPrice) : (botAmountSnapshot || 0);

  // Build the qrData object that QRPaymentModal expects.
  // Uses live-resolved wallet address so receiver's primary wallet changes are picked up.
  const qrData = {
    receiver: sender,
    payTag: sender,
    wallet: liveReceiverWallet || receiverWalletAddress || "",
    amount: Number(liveBotRequiredAmount) || 0,
    memo: name && name !== "Unknown" ? name : "",
    paymentId: reqId || "",
    receivingWalletType: liveReceivingWalletType || receivingWalletType || "internal",
    type: "request",
  };

  const handleSettle = () => {
    if (isSentByMe || currentStatus === "Paid" || currentStatus === "Completed" || currentStatus === "Settled" || currentStatus === "Expired") return;
    setShowModal(true);
  };

  const handleClose = () => {
    setShowModal(false);
    if (onSettle) onSettle();
  };

  const isPaid = currentStatus === "Paid" || currentStatus === "Completed" || currentStatus === "Settled";
  const isExpired = currentStatus === "Expired";

  return (
    <>
      {/* ─── INBOX CARD ─── */}
      <div
        className={`bg-[#0a0a0a] border-zinc-800/50 border p-4 sm:p-5 rounded-2xl w-full max-w-4xl mx-auto shadow-lg relative overflow-hidden group mb-3 sm:mb-4 transition-all ${
          isPaid
            ? "border-emerald-500/30"
            : isExpired
            ? "border-red-500/30"
            : isSentByMe
            ? "hover:border-emerald-500/30"
            : "hover:border-blue-500/30"
        }`}
      >
        <div
          className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 transition-all duration-700 ${
            isPaid
              ? "bg-emerald-500/10"
              : isExpired
              ? "bg-red-500/10"
              : isSentByMe
              ? "bg-emerald-500/5 group-hover:bg-emerald-500/10"
              : "bg-blue-500/5 group-hover:bg-blue-500/10"
          }`}
        />

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center relative z-10 w-full gap-3 sm:gap-0">
          {/* Left: icon + name + sender + live timer */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div
              className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center border shrink-0 ${
                isPaid
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : isExpired
                  ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : isSentByMe
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"
              }`}
            >
              <FiFileText size={18} className="sm:w-5 sm:h-5" />
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-white font-bold text-sm sm:text-lg truncate max-w-[140px] sm:max-w-none">
                  {name === "Unknown"
                    ? isSentByMe
                      ? "Requested Payment"
                      : "Pending Invoice"
                    : name}
                </p>
                {isExpired && (
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                    EXPIRED
                  </span>
                )}
                {isPaid && (
                  <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                    PAID
                  </span>
                )}
              </div>

              <p className="text-zinc-500 text-[11px] sm:text-xs font-medium tracking-wide flex items-center gap-1.5 mt-0.5 truncate">
                {isSentByMe ? (
                  <FiCheckCircle className="text-emerald-400 shrink-0" size={12} />
                ) : (
                  <FiClock className="text-blue-400 shrink-0" size={12} />
                )}
                {isSentByMe ? "To: " : "From: "}
                {sender}
              </p>

              {!isPaid && !isExpired && (
                <p className="text-amber-400 text-[11px] sm:text-xs font-semibold tracking-wide flex items-center gap-1.5 mt-1 animate-pulse">
                  <FiClock size={11} />
                  <span className="truncate">{timeLeftStr}</span>
                </p>
              )}
            </div>
          </div>

          {/* Right: amount + action button */}
          <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6">
            <div className="text-left sm:text-right flex flex-col">
              <p className="text-zinc-500 text-[9px] sm:text-[10px] font-bold uppercase tracking-widest mb-0.5">
                Amount Due
              </p>
              <p className="font-black text-base sm:text-2xl text-amber-400 tracking-tight">
                {Number(liveBotRequiredAmount).toFixed(4)} BOT
              </p>
              <p className="text-[11px] sm:text-xs text-zinc-400 font-bold mt-0.5">
                ≈ ${targetUSD.toFixed(2)} USD
              </p>
            </div>

            {isPaid ? (
              <button
                disabled
                className="px-4 sm:px-8 py-2.5 sm:py-3.5 bg-emerald-950/30 text-emerald-400 rounded-xl font-bold text-[11px] sm:text-sm uppercase tracking-widest border border-emerald-500/30 cursor-not-allowed flex items-center gap-1.5 shrink-0"
              >
                <FiCheckCircle size={14} /> Paid
              </button>
            ) : isExpired ? (
              <button
                disabled
                className="px-4 sm:px-8 py-2.5 sm:py-3.5 bg-red-950/30 text-red-400 rounded-xl font-bold text-[11px] sm:text-sm uppercase tracking-widest border border-red-500/30 cursor-not-allowed shrink-0"
              >
                Expired
              </button>
            ) : isSentByMe ? (
              <button
                disabled
                className="px-4 sm:px-8 py-2.5 sm:py-3.5 bg-zinc-900 text-zinc-500 rounded-xl font-bold text-[11px] sm:text-sm uppercase tracking-widest border border-zinc-800 cursor-not-allowed shrink-0"
              >
                Awaiting
              </button>
            ) : (
              <button
                onClick={handleSettle}
                className="px-4 sm:px-8 py-2.5 sm:py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white rounded-xl font-bold text-[11px] sm:text-sm uppercase tracking-widest shadow-lg transition-all border border-blue-400/30 flex items-center gap-2 shrink-0"
              >
                <FiZap size={13} /> Settle
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── QR PAYMENT MODAL — overlays on Settle click ─── */}
      {showModal && (
        <QRPaymentModal
          isOpen={showModal}
          onClose={handleClose}
          qrData={qrData}
          user={currentUser}
        />
      )}
    </>
  );
};

export default Reqpay;
