import React, { Suspense, useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import styles from "./style";
// The Router is no longer imported here
import { Routes, Route } from "react-router-dom";
import Home from './pages/Home';
import Profile from './pages/Profile';
import LoginPage from './components/Auth/LoginPage';
import RegisterPage from './components/Auth/RegisterPage';
import { Navbar } from './components';
import Dashboard from './pages/Dashboard.jsx';
import TransactionForm from './pages/AddTransaction.jsx';
import CryptoTracker from './pages/Crypto.jsx';
import Loan from './pages/Loans.jsx';
import ProtectedRoute from './PrivateRoute.jsx';
import NotFound from './pages/NotFound.jsx';
import Loader from './components/Loader.jsx';
import Bank from './pages/Bank.jsx';
import MainTransaction from './pages/MainTransaction.jsx';
import Payements from './pages/Payements.jsx';
import Web3Identity from './pages/Web3Identity.jsx';
import PaymentSuccess from './pages/PaymentSuccess.jsx';
import { useSubscribeToJwtAuthWithFlag, useWallets, usePrivy } from '@privy-io/react-auth';

import AiRemittanceAgent from './components/Bank/AiRemittanceAgent';

// Component to handle stateless OIDC state sync with Privy & verify/provision wallets
const PrivySync = () => {
  const token = localStorage.getItem('token');
  const { ready } = usePrivy();
  const { wallets } = useWallets();

  useSubscribeToJwtAuthWithFlag({
    enabled: true,
    isAuthenticated: !!token,
    isLoading: !ready,
    getExternalJwt: async () => {
      return token || null;
    }
  });

  const embeddedWallet = wallets.find(w => w.walletClientType === 'privy');

  useEffect(() => {
    import('./utils/mpcWallet.js').then(({ setPrivyWallet }) => {
      setPrivyWallet(embeddedWallet || null);
    });
  }, [embeddedWallet]);

  return null;
};

const App = () => {
  const [tt , setToken] = useState(localStorage.getItem('token') || "");

  useEffect(() => {
    const token = localStorage.getItem('token');
    setToken(token);
  }, [tt]);

  return (
    <div className="bg-primary w-full overflow-hidden relative">
      <Toaster position="top-center" />
      <PrivySync />
      <div className={`${styles.paddingX} ${styles.flexCenter}`}>
        <div className={`${styles.boxWidth}`}>
          <Navbar />
        </div>
      </div>
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/flash-loans" element={<Loan />} />
          <Route path="/crypto-tracker" element={<CryptoTracker />} />

          <Route
            element={<ProtectedRoute isAuthenticated={tt ? true : false} />}
          >
            <Route path="/profile" element={<Profile />} />
            <Route path="/overview" element={<Dashboard />} />
            <Route path="/transaction" element={<TransactionForm />} />
            <Route path="/payments" element={<Payements />} />
            <Route path="/KYC" element={<Bank />} />
            <Route path="/transfers" element={<MainTransaction />} />
            <Route path="/web3-kyc" element={<Web3Identity />} />
            <Route path="/payment-success" element={<PaymentSuccess />} />
          </Route>
          <Route path="/*" element={<NotFound />} />
        </Routes>
      </Suspense>
      {/* Global Draggable AI Agent Component — only after login */}
      {tt && <AiRemittanceAgent />}
    </div>
  );
};

export default App;