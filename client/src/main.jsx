// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { PrivyProvider } from '@privy-io/react-auth';
import { defineChain } from 'viem';
import { BrowserRouter as Router } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { activeChain } from "./config/chains"; // <-- Import dynamic chain

// ✅ Add this at the top for Buffer
import { Buffer } from 'buffer';
window.Buffer = Buffer; // Makes Buffer globally available

// Define custom BOT Chain for Privy configuration using activeChain parameters
const botChain = defineChain({
  id: Number(activeChain.chainId),
  name: activeChain.name,
  network: activeChain.slug,
  nativeCurrency: {
    decimals: activeChain.nativeCurrency.decimals,
    name: activeChain.nativeCurrency.name,
    symbol: activeChain.nativeCurrency.symbol,
  },
  rpcUrls: {
    default: { http: activeChain.rpc },
  },
  blockExplorers: {
    default: { name: 'BOT Chain Explorer', url: activeChain.explorers[0].url },
  },
});

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={queryClient}>
    <PrivyProvider
      appId={import.meta.env.VITE_PRIVY_APP_ID || "placeholder-app-id"}
      config={{
        defaultChain: botChain,
        supportedChains: [botChain],
        embeddedWallets: {
          createOnLogin: 'users-without-wallets'
        }
      }}
    >
      <Router
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </Router>
    </PrivyProvider>
  </QueryClientProvider>
);
