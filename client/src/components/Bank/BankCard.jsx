import React, { useEffect, useState } from 'react';
import { FiCopy, FiCheck, FiExternalLink, FiPower } from 'react-icons/fi';
import { toast, Toaster } from 'react-hot-toast';
import { ConnectWallet, useAddress, useDisconnect } from '../../utils/mpcWallet';
import api from '../../utils/api';

const BankCard = ({ userData }) => {
  const connectedAddress = useAddress();
  const disconnectWallet = useDisconnect();

  const [copied, setCopied] = useState('');

  const copyToClipboard = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`Copied ${label}!`, { duration: 1200 });
    setTimeout(() => setCopied(''), 1500);
  };

  const isDisconnectedFlag = typeof window !== 'undefined' && (
    localStorage.getItem('external_wallet_disconnected') === 'true' ||
    localStorage.getItem('wallet_disconnected') === 'true' ||
    sessionStorage.getItem('wallet_disconnected') === 'true'
  );

  const internalAddr = userData?.internalWalletAddress || '';
  const dbExternalAddr = isDisconnectedFlag ? '' : (userData?.metamaskId || userData?.metamask || '');
  const activeConnectedAddress = isDisconnectedFlag ? '' : connectedAddress;
  const displayAddress = activeConnectedAddress || dbExternalAddr;

  const globalPayTag = userData?.globalPayTag || '';
  const botBalance = Number(userData?.bankDetails?.usdcBalance || 0);
  const extBalance = Number(userData?.bankDetails?.externalBalance || 0);
  const botPrice = Number(userData?.bankDetails?.botPrice || 0);

  const [liveExtBalance, setLiveExtBalance] = useState(0);

  const isConnected = Boolean(displayAddress && displayAddress !== 'Not Connected' && !isDisconnectedFlag);

  // Auto-sync Thirdweb connected address with backend database only when not manually disconnected
  useEffect(() => {
    if (!isDisconnectedFlag && connectedAddress && connectedAddress !== dbExternalAddr) {
      api.put('/auth/update-external-wallet', { walletAddress: connectedAddress })
        .then(() => {
          toast.success(`Connected wallet: ${connectedAddress.slice(0, 6)}...${connectedAddress.slice(-4)}`);
        })
        .catch((err) => console.error("Failed to sync wallet with backend:", err));
    }
  }, [connectedAddress, dbExternalAddr, isDisconnectedFlag]);

  // Live RPC balance query for external wallet
  useEffect(() => {
    if (displayAddress && displayAddress.startsWith('0x') && displayAddress.length >= 40) {
      import('ethers').then(async ({ ethers }) => {
        try {
          const provider = new ethers.providers.JsonRpcProvider(import.meta.env.VITE_BOTCHAIN_RPC_URL || 'https://rpc.botchain.ai');
          const rawBal = await provider.getBalance(displayAddress);
          setLiveExtBalance(parseFloat(ethers.utils.formatUnits(rawBal, 18)));
        } catch (err) {
          console.error("BankCard RPC error:", err);
        }
      }).catch(e => console.error(e));
    } else {
      setLiveExtBalance(0);
    }
  }, [displayAddress]);

  const shortAddr = (addr) =>
    addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : 'Not connected';

  const explorerUrl = import.meta.env.VITE_BOTCHAIN_EXPLORER_URL || 'https://scan.botchain.ai/';

  // Disconnect wallet
  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect your external Web3 wallet?')) return;
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('external_wallet_disconnected', 'true');
        localStorage.setItem('wallet_disconnected', 'true');
        sessionStorage.setItem('wallet_disconnected', 'true');
      }
      if (disconnectWallet) await disconnectWallet();
      await api.put('/auth/update-external-wallet', { walletAddress: '' });
      toast.success('External wallet disconnected.');
      window.location.reload();
    } catch (err) {
      console.error(err);
      toast.error('Failed to disconnect wallet');
    }
  };

  return (
    <>
      <Toaster />
      {/* ─── Box 1: External Web3 Wallet ─── */}
      <div className="bg-gradient-to-br from-cyan-950 to-zinc-900 border border-cyan-700/40 p-6 h-80 w-full rounded-2xl relative shadow-xl font-mono overflow-hidden flex flex-col justify-between">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent pointer-events-none" />

        <div className="relative z-10 h-full flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-cyan-400 font-black tracking-[0.2em] uppercase">
                External Web3 Wallet
              </p>
              <div className="flex items-center gap-1.5">
                <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${isConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
                  {isConnected ? 'Connected' : 'Disconnected'}
                </span>
                {isConnected && (
                  <button
                    onClick={handleDisconnect}
                    title="Disconnect Wallet"
                    className="p-1 text-zinc-500 hover:text-red-400 transition-colors rounded hover:bg-zinc-800"
                  >
                    <FiPower size={11} />
                  </button>
                )}
              </div>
            </div>

            <p className="text-white text-sm font-bold truncate mt-1">
              {isConnected ? shortAddr(displayAddress) : 'No Wallet Connected'}
            </p>

            {isConnected ? (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <button
                  onClick={() => copyToClipboard(displayAddress, 'Wallet Address')}
                  className="flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300 transition-all bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/40"
                >
                  {copied === 'Wallet Address' ? <FiCheck size={10} /> : <FiCopy size={10} />}
                  {copied === 'Wallet Address' ? 'Copied' : 'Copy Address'}
                </button>
                <a
                  href={`${explorerUrl}/address/${displayAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-cyan-400 transition-all bg-zinc-900/60 px-2 py-0.5 rounded border border-zinc-800"
                >
                  <FiExternalLink size={10} /> Explorer
                </a>
              </div>
            ) : (
              <div className="mt-3">
                <ConnectWallet
                  theme="dark"
                  btnTitle="Connect Web3 Wallet"
                  className="!bg-cyan-500 hover:!bg-cyan-400 !text-zinc-950 !font-black !text-[10px] !uppercase !py-2 !px-4 !rounded-xl"
                />
              </div>
            )}
          </div>

          {/* External Balance Display */}
          <div>
            <p className="text-cyan-400 text-[9px] font-black uppercase tracking-widest">External Balance</p>
            <p className="text-xl font-black text-white mt-0.5">
              {(isConnected ? (liveExtBalance || extBalance) : 0).toFixed(4)} BOT
            </p>
            {isConnected && botPrice > 0 && (liveExtBalance || extBalance) > 0 && (
              <p className="text-zinc-400 text-[10px] mt-0.5">≈ ${((liveExtBalance || extBalance) * botPrice).toFixed(2)} USD</p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-cyan-900/30">
            <span className="text-cyan-500 font-black text-sm tracking-tight">🔗 WEB3</span>
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">External</span>
          </div>
        </div>
      </div>

      {/* ─── Box 2: Internal Vault (BOT) ─── */}
      <div className="bg-gradient-to-br from-amber-950 to-zinc-900 border border-amber-700/40 p-6 h-80 w-full rounded-2xl relative shadow-xl font-mono overflow-hidden flex flex-col justify-between">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent pointer-events-none" />

        <div className="relative z-10 h-full flex flex-col justify-between">
          <div>
            <p className="text-[10px] text-amber-400 font-black tracking-[0.2em] uppercase mb-3">
              Internal Vault (BOT)
            </p>
            <p className="text-white text-sm font-bold truncate">
              {internalAddr ? shortAddr(internalAddr) : 'Generating...'}
            </p>
            {internalAddr && (
              <button
                onClick={() => copyToClipboard(internalAddr, 'Vault Address')}
                className="flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300 mt-2 transition-all bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40 w-fit"
              >
                {copied === 'Vault Address' ? <FiCheck size={10} /> : <FiCopy size={10} />}
                {copied === 'Vault Address' ? 'Copied' : 'Copy Address'}
              </button>
            )}
            {globalPayTag && (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-[9px] text-zinc-500 uppercase tracking-widest">Tag:</span>
                <span className="text-amber-400 text-xs font-black bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">{globalPayTag}</span>
                <button
                  onClick={() => copyToClipboard(globalPayTag, 'Tag')}
                  className="text-zinc-500 hover:text-amber-400 transition-all"
                >
                  {copied === 'Tag' ? <FiCheck size={10} /> : <FiCopy size={10} />}
                </button>
              </div>
            )}
          </div>

          <div>
            <p className="text-amber-400 text-[9px] font-black uppercase tracking-widest">On-Chain BOT Balance</p>
            <p className="text-xl font-black text-white mt-0.5">{botBalance.toFixed(4)} BOT</p>
            {botPrice > 0 && (
              <p className="text-zinc-400 text-[10px] mt-0.5">
                ≈ ${(botBalance * botPrice).toFixed(2)} USD
              </p>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-amber-900/30">
            <span className="text-amber-500 font-black text-sm">⚡ BOT</span>
            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">BOT Chain Mainnet</span>
          </div>
        </div>
      </div>
    </>
  );
};

export default BankCard;