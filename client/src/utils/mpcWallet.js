import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { usePrivy, useWallets } from '@privy-io/react-auth';

let activeWallet = null;

export const mpcChain = {
  chainId: Number(import.meta.env.VITE_BOTCHAIN_CHAIN_ID || 677),
  rpcUrl: import.meta.env.VITE_BOTCHAIN_RPC_URL || "https://rpc.botchain.ai"
};

/**
 * Saves the active Privy ConnectedWallet instance in file-level state
 */
export const setPrivyWallet = (wallet) => {
  activeWallet = wallet;
  console.log("🤖 [MPC WALLET] Privy wallet reference saved in memory:", wallet?.address);
};

/**
 * Backwards-compatible mock connector function (simply returns active signer state)
 */
export const connectMpcWallet = async (token) => {
  if (activeWallet) return activeWallet;
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      if (activeWallet) {
        clearInterval(interval);
        resolve(activeWallet);
      }
      attempts++;
      if (attempts > 50) {
        clearInterval(interval);
        reject(new Error("Timeout waiting for Privy embedded wallet initialization."));
      }
    }, 100);
  });
};

/**
 * Returns the EVM address of the active wallet
 */
export const getAddress = () => {
  if (!activeWallet) return "";
  return activeWallet.address;
};

/**
 * Signs and sends an on-chain transaction using Privy EIP-1193 provider
 */
export const sendTransaction = async (txOpts) => {
  if (!activeWallet) throw new Error("Wallet not connected.");
  
  if (activeWallet.chainId !== mpcChain.chainId) {
    try {
      await activeWallet.switchChain(mpcChain.chainId);
    } catch (err) {
      console.warn("🤖 [MPC WALLET] Chain switch failed:", err.message);
    }
  }

  const rawProvider = await activeWallet.getEthereumProvider();
  const provider = new ethers.providers.Web3Provider(rawProvider);
  const signer = provider.getSigner();

  const tx = await signer.sendTransaction({
    to: txOpts.to,
    value: txOpts.value,
    data: txOpts.data,
    gasLimit: txOpts.gasLimit
  });

  return tx;
};

/**
 * Signs a raw transaction without broadcasting — returns RLP-encoded signed tx hex
 * Used for scheduled payments (sign now, broadcast later)
 */
export const signRawTransaction = async (txOpts) => {
  if (!activeWallet) throw new Error("Wallet not connected.");

  if (activeWallet.chainId !== mpcChain.chainId) {
    try {
      await activeWallet.switchChain(mpcChain.chainId);
    } catch (err) {
      console.warn("🤖 [MPC WALLET] Chain switch failed:", err.message);
    }
  }

  const rawProvider = await activeWallet.getEthereumProvider();
  const provider = new ethers.providers.Web3Provider(rawProvider);
  const signer = provider.getSigner();

  const populatedTx = await signer.populateTransaction({
    to: txOpts.to,
    value: ethers.utils.parseUnits(txOpts.value.toString(), 18),
    gasLimit: txOpts.gasLimit || 21000,
  });

  const signedTx = await signer.signTransaction(populatedTx);
  return signedTx;
};

/**
 * Signs a cryptographic message using the active wallet
 */
export const signMessage = async (message) => {
  if (!activeWallet) throw new Error("Wallet not connected.");
  const rawProvider = await activeWallet.getEthereumProvider();
  const provider = new ethers.providers.Web3Provider(rawProvider);
  const signer = provider.getSigner();
  return signer.signMessage(message);
};

/**
 * Returns the Web3Provider Signer instance
 */
export const getSigner = () => {
  if (!activeWallet) return null;
  const rawProvider = window.ethereum; 
  const provider = new ethers.providers.Web3Provider(rawProvider);
  return provider.getSigner();
};

/**
 * Returns the Web3Provider instance
 */
export const getProvider = () => {
  return new ethers.providers.JsonRpcProvider(mpcChain.rpcUrl);
};

/**
 * Check connection status
 */
export const isMpcConnected = () => {
  return !!activeWallet;
};

export const getMpcAccount = () => {
  if (!activeWallet) return null;
  return {
    address: activeWallet.address,
    sendTransaction: async (txOpts) => {
      const tx = await sendTransaction(txOpts);
      return { transactionHash: tx.hash };
    }
  };
};

export const getMpcWallet = () => activeWallet;

// ==================== Backward Compatibility Hooks ====================

export const useAddress = () => {
  const { wallets } = useWallets();
  const external = wallets.find(w => w.walletClientType !== 'privy');
  
  const checkDisconnected = () => typeof window !== 'undefined' && (
    localStorage.getItem('external_wallet_disconnected') === 'true' ||
    localStorage.getItem('wallet_disconnected') === 'true' ||
    sessionStorage.getItem('wallet_disconnected') === 'true'
  );

  const [address, setAddress] = useState(() => {
    return (external && !checkDisconnected()) ? external.address : "";
  });

  useEffect(() => {
    const live = (external && !checkDisconnected()) ? external.address : "";
    if (live !== address) setAddress(live);
  }, [wallets, external, address]);

  return checkDisconnected() ? "" : address;
};

export const useBalance = (tokenAddress) => {
  const [data, setData] = useState({ displayValue: "0", symbol: "BOT" });
  const [isLoading, setIsLoading] = useState(true);
  const address = useAddress();

  useEffect(() => {
    if (!address) {
      setData({ displayValue: "0", symbol: "BOT" });
      setIsLoading(false);
      return;
    }

    const fetchBalance = async () => {
      try {
        const provider = getProvider();
        if (!tokenAddress) {
          const bal = await provider.getBalance(address);
          setData({
            displayValue: ethers.utils.formatEther(bal),
            symbol: "BOT"
          });
        } else {
          const abi = ["function balanceOf(address) view returns (uint256)"];
          const contract = new ethers.Contract(tokenAddress, abi, provider);
          const bal = await contract.balanceOf(address);
          setData({
            displayValue: ethers.utils.formatUnits(bal, 18),
            symbol: "USDC"
          });
        }
      } catch (err) {
        console.warn("🤖 [MPC WALLET] Balance query failed:", err.message);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBalance();
    const interval = setInterval(fetchBalance, 10000);
    return () => clearInterval(interval);
  }, [address, tokenAddress]);

  return { data, isLoading };
};

export const useNetwork = () => {
  const { wallets } = useWallets();
  const external = wallets.find(w => w.walletClientType !== 'privy');

  const switchChain = async (chainId) => {
    if (external) {
      try {
        await external.switchChain(chainId);
      } catch (err) {
        console.error("Failed to switch external wallet chain:", err);
      }
    }
  };

  return [
    { data: { chain: { id: external ? external.chainId : mpcChain.chainId } } },
    switchChain
  ];
};

export const useSDK = () => {
  const { wallets } = useWallets();
  const external = wallets.find(w => w.walletClientType !== 'privy');

  return {
    getSigner: async () => {
      if (!external) return null;
      const rawProvider = await external.getEthereumProvider();
      const provider = new ethers.providers.Web3Provider(rawProvider);
      return provider.getSigner();
    },
    getProvider: () => {
      return getProvider();
    }
  };
};

export const useContract = (contractAddress) => {
  return { contract: contractAddress || null };
};

export const useTransferToken = () => {
  return {
    mutateAsync: async (transferOpts) => {
      console.log("Mock transferToken called:", transferOpts);
    },
    isLoading: false,
    error: null
  };
};

export const useContractRead = () => {
  return { data: ethers.BigNumber.from(0), isLoading: false, error: null };
};

export const useContractWrite = () => {
  return {
    mutateAsync: async () => {
      console.log("Mock contract write executed.");
    },
    isLoading: false,
    error: null
  };
};

export const useDisconnect = () => {
  const { logout } = usePrivy();
  const { wallets } = useWallets();
  return async () => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('external_wallet_disconnected', 'true');
      localStorage.setItem('wallet_disconnected', 'true');
      sessionStorage.setItem('wallet_disconnected', 'true');
    }
    const external = wallets.find(w => w.walletClientType !== 'privy');
    if (external) {
      try {
        await external.disconnect();
      } catch (err) {
        console.error("Failed to disconnect external wallet:", err);
      }
    } else {
      try {
        await logout();
      } catch (err) {
        console.error("Failed to logout Privy:", err);
      }
    }
  };
};

// Custom Connect Wallet button component
export const ConnectWallet = ({ className }) => {
  const address = useAddress();
  const { connectWallet } = usePrivy();

  if (!address) {
    return React.createElement(
      'button',
      {
        onClick: () => {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('external_wallet_disconnected');
            localStorage.removeItem('wallet_disconnected');
            sessionStorage.removeItem('wallet_disconnected');
          }
          connectWallet && connectWallet();
        },
        className: `bg-zinc-800 hover:bg-zinc-700 text-white font-medium px-4 py-2 rounded-lg border border-zinc-700 text-sm ${className || ''}`
      },
      'Connect Wallet'
    );
  }

  return React.createElement(
    'button',
    {
      className: `bg-zinc-800 text-white font-medium px-4 py-2 rounded-lg border border-zinc-700 text-sm ${className || ''}`
    },
    `${address.slice(0, 6)}...${address.slice(-4)}`
  );
};
