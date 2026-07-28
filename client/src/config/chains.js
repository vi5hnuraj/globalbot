// client/src/config/chains.js

const chainId = Number(import.meta.env.VITE_BOTCHAIN_CHAIN_ID || 677);
const rpcUrl = import.meta.env.VITE_BOTCHAIN_RPC_URL || "https://rpc.botchain.ai";
const chainName = import.meta.env.VITE_BOTCHAIN_CHAIN_NAME || "BOT Chain";
const explorerUrl = import.meta.env.VITE_BOTCHAIN_EXPLORER_URL || "https://scan.botchain.ai/";
const symbol = import.meta.env.VITE_BOTCHAIN_SYMBOL || "BOT";

export const activeChain = {
  chainId: chainId,
  rpc: [rpcUrl],
  nativeCurrency: {
    decimals: 18,
    name: symbol,
    symbol: symbol,
  },
  shortName: chainName.toLowerCase().replace(/\s+/g, "-"),
  slug: chainName.toLowerCase().replace(/\s+/g, "-"),
  testnet: chainName.toLowerCase().includes("testnet"),
  chain: "BOT Chain",
  name: chainName,
  explorers: [
    {
      name: "BOT Chain Explorer",
      url: explorerUrl,
      standard: "EIP309"
    }
  ]
};
