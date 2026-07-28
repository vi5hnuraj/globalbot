import { supabase } from '../config/supabaseClient.js';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/config.js';

// ==================== Register a new user ====================
export const register = async (req, res) => {
  const { email, password, name } = req.body;

  try {
    // Check if user already exists
    const { data: existingUser, error: checkErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (existingUser) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Register user in Supabase Auth (with email auto-confirmed for production/sandbox ease)
    // Direct fetch bypasses SDK header parsing bugs on newer sb_secret keys
    const cleanUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const authRes = await fetch(`${cleanUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true
      })
    });

    const authDataRaw = await authRes.json();

    if (authRes.status !== 200 && authRes.status !== 201) {
      console.error("Supabase signup error:", authDataRaw);
      return res.status(400).json({
        message: "Registration failed. Please try again."
      });
    }

    const userId = authDataRaw.id;
    const baseName = name ? name.toLowerCase().replace(/\s+/g, '') : 'user';
    const globalPayTag = `@${baseName}_gl`;

    // Insert public profile in public.profiles table
    const { data: newProfile, error: profileErr } = await supabase
      .from('profiles')
      .insert({
        id: userId,
        email,
        name,
        global_pay_tag: globalPayTag,
        wallet_provider: 'privy'
      })
      .select()
      .single();

    if (profileErr) {
      // Rollback Auth user if profile creation fails
      await fetch(`${cleanUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`
        }
      });
      return res.status(400).json({ message: 'Registration failed. Please try again.' });
    }

    // Insert default bank details record so user has active Pay Tag immediately
    const { error: bankErr } = await supabase
      .from('bank_details')
      .insert({
        user_id: userId,
        bank_name: 'GlobalPay Digital Bank',
        ifsc_code: 'GPAY0000001',
        account_holder: name || 'User',
        account_address: 'Digital Wallet',
        account_type: 'savings',
        amount: 0.00,
        global_pay_tag: globalPayTag,
        region: 'Global',
        usdc_balance: 0.00
      });

    if (bankErr) {
      // Rollback profile and Auth user
      await supabase.from('profiles').delete().eq('id', userId);
      await fetch(`${cleanUrl}/auth/v1/admin/users/${userId}`, {
        method: 'DELETE',
        headers: {
          'apikey': serviceKey
        }
      });
      return res.status(400).json({ message: 'Registration failed. Please try again.' });
    }

    // Generate JWT access token by signing the user in
    const { data: sessionData, error: sessionErr } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (sessionErr || !sessionData?.session) {
      return res.status(400).json({ message: 'Authentication sign-in failed' });
    }

    res.status(201).json({
      token: sessionData.session.access_token,
      refreshToken: sessionData.session.refresh_token
    });
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// ==================== User login ====================
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Sign out any existing sessions for this user before creating a new one
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      if (profile?.id) {
        await supabase.auth.admin.signOut(profile.id);
      }
    } catch { /* session cleanup best-effort */ }

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session) {
      if (error?.status === 429) {
        return res.status(429).json({ message: 'Too many login attempts. Please wait a moment and try again.' });
      }
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    res.status(200).json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token
    });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// ==================== Link wallets & metadata ====================
export const linking = async (req, res) => {
  try {
    const { upi, metamask, bankDetails, region } = req.body;
    const user = req.user; // from authMiddleware (Supabase profile row object)
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const updates = {
      global_pay_tag: upi || user.global_pay_tag,
      metamask_id: metamask || user.metamask_id,
      kyc: true,
      region: region || user.region
    };

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: 'Database error while linking profiles' });
    }

    res.status(200).json({ message: 'Links updated successfully', user: updatedProfile });
  } catch (error) {
    console.error("Linking error:", error.message);
    res.status(500).json({ message: 'Server error while updating links' });
  }
};

// ==================== Update user details ====================
export const update = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { name, mob, age, dob, address, status } = req.body;

    const updates = {
      name: name || user.name,
      mobile: mob || user.mobile,
      age: age ? Number(age) : user.age,
      dob: dob || user.dob,
      address: address || user.address,
      status: status || user.status
    };

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: 'Database error updating profile details' });
    }

    res.status(200).json({ message: 'User updated successfully', user: updatedProfile });
  } catch (error) {
    console.error("Update error:", error.message);
    res.status(500).json({ message: 'Server error while updating user' });
  }
};

// ==================== Update External Wallet ====================
export const updateExternalWallet = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { walletAddress } = req.body;
    const updates = {
      metamask_id: walletAddress || "",
      external_wallet: walletAddress || ""
    };

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: 'Database error updating external wallet' });
    }

    res.status(200).json({ message: 'External wallet updated successfully', metamaskId: updatedProfile.metamask_id });
  } catch (error) {
    console.error("Update external wallet error:", error.message);
    res.status(500).json({ message: 'Server error updating external wallet' });
  }
};

// ==================== Fetch user details ====================
export const fetchDetail = async (req, res) => {
  try {
    const { waddr, email, upi } = req.query;
    let profile = null;

    if (waddr) {
      const { data } = await supabase.from('profiles').select('*').eq('metamask_id', waddr).maybeSingle();
      profile = data;
    } else if (email) {
      const { data } = await supabase.from('profiles').select('*').eq('email', email).maybeSingle();
      profile = data;
    } else if (upi) {
      // Check if it's a UUID string matching user.id
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(upi);
      if (isUuid) {
        const { data } = await supabase.from('profiles').select('*').eq('id', upi).maybeSingle();
        profile = data;
      } else {
        const cleanUpi = upi.replace(/^@/, '').trim();
        const tagWithAt = `@${cleanUpi}`;
        const candidates = [upi, cleanUpi, tagWithAt].filter(Boolean);
        const unique = [...new Set(candidates)];
        let match = null;
        for (const val of unique) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .eq('global_pay_tag', val)
            .maybeSingle();
          if (data) { match = data; break; }
        }
        if (!match) {
          for (const val of unique) {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .eq('email', val)
              .maybeSingle();
            if (data) { match = data; break; }
          }
        }
        if (!match) {
          for (const val of unique) {
            const { data } = await supabase
              .from('profiles')
              .select('*')
              .or(`internal_wallet_address.eq.${val},metamask_id.eq.${val}`)
              .maybeSingle();
            if (data) { match = data; break; }
          }
        }
        if (!match && cleanUpi) {
          const { data } = await supabase
            .from('profiles')
            .select('*')
            .ilike('name', `%${cleanUpi}%`)
            .maybeSingle();
          if (data) match = data;
        }
        profile = match;
      }
    } else {
      // Fallback to active logged-in user from request
      const { data } = await supabase.from('profiles').select('*').eq('id', req.user.id).single();
      profile = data;
    }

    if (!profile) return res.status(404).json({ message: 'No user found with that paytag, email, or wallet address' });

    // Fetch corresponding bank details row
    const { data: bankDetailsRecord } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', profile.id)
      .maybeSingle();

    // Fetch BOT on-chain balances dynamically via RPC
    let internalBotBalance = bankDetailsRecord?.usdc_balance ? Number(bankDetailsRecord.usdc_balance) : 0;
    let externalBotBalance = 0;

    try {
      const { ethers } = await import('ethers');
      const rpcUrl = process.env.BOTCHAIN_RPC_URL || 'https://rpc.botchain.ai';
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      if (profile.internal_wallet_address && ethers.isAddress(profile.internal_wallet_address)) {
        const rawInt = await provider.getBalance(profile.internal_wallet_address);
        internalBotBalance = parseFloat(ethers.formatUnits(rawInt, 18));
      }

      const extAddr = profile.metamask_id || profile.external_wallet;
      if (extAddr && ethers.isAddress(extAddr)) {
        const rawExt = await provider.getBalance(extAddr);
        externalBotBalance = parseFloat(ethers.formatUnits(rawExt, 18));
      }
    } catch (rpcErr) {
      console.error("RPC balance fetch warning:", rpcErr.message);
    }

    const isExternal = profile.primary_receiving_wallet === "external" && profile.metamask_id;
    const receiverWalletAddress = isExternal ? profile.metamask_id : profile.internal_wallet_address;
    const receivingWalletType = isExternal ? "External Wallet" : "Internal Wallet";

    const mergedBankDetails = {
      bankName: bankDetailsRecord?.bank_name || "",
      ifscCode: bankDetailsRecord?.ifsc_code || "",
      accountHolder: bankDetailsRecord?.account_holder || "",
      accountAddress: bankDetailsRecord?.account_address || "Not Required",
      accountType: bankDetailsRecord?.account_type || "savings",
      amount: bankDetailsRecord?.amount ? Number(bankDetailsRecord.amount) : 0,
      upiId: bankDetailsRecord?.global_pay_tag || "",
      usdcBalance: internalBotBalance,
      internalBalance: internalBotBalance,
      externalBalance: externalBotBalance,
      botPrice: 9.72,
      createdAt: bankDetailsRecord?.created_at,
      updatedAt: bankDetailsRecord?.updated_at
    };

    res.status(200).json({
      _id: profile.id, // Return ID mapping both _id and id for compatibility
      id: profile.id,
      username: profile.name,
      email: profile.email,
      metamask: profile.metamask_id,
      internalWalletAddress: profile.internal_wallet_address,
      externalWallet: profile.external_wallet,
      primaryReceivingWallet: profile.primary_receiving_wallet || "internal",
      receiverWalletAddress,
      receivingWalletType,
      upi: profile.upi_id || profile.global_pay_tag,
      bankDetails: mergedBankDetails,
      kyc: profile.kyc,
      kycProvider: profile.kyc_provider,
      global_verified: profile.global_verified,
      globalPayTag: profile.global_pay_tag,
      region: bankDetailsRecord ? bankDetailsRecord.region : profile.region,
      mobile: profile.mobile,
      age: profile.age,
      dob: profile.dob,
      address: profile.address,
      status: profile.status,
    });
  } catch (error) {
    console.error("Fetch detail error:", error.message);
    res.status(500).json({ message: 'Server error while fetching user details' });
  }
};

// ==================== Verify Web3 KYC & Create Vault ====================
export const verifyWeb3KYC = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { kycProvider, walletAddress } = req.body;

    const updates = {
      global_verified: true,
      kyc: true,
      kyc_provider: kycProvider || 'Gitcoin'
    };

    if (walletAddress) {
      updates.metamask_id = walletAddress;
    }

    // Auto-generate global PayTag if not already present
    if (!user.global_pay_tag) {
      const regionCode = user.region ? user.region.toLowerCase().slice(0, 2) : 'gl';
      const baseName = user.name ? user.name.toLowerCase().replace(/\s+/g, '') : 'user';
      updates.global_pay_tag = `@${baseName}_${regionCode}`;
    }

    // Internal wallet address is set by Privy MPC wallet connection
    if (!user.internal_wallet_address) {
      updates.internal_wallet_address = null;
    }

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: 'Database error during KYC verification' });
    }

    res.status(200).json({ message: 'Web3 KYC verified successfully. Web3 Wallet generated.', user: updatedProfile });
  } catch (error) {
    console.error("verifyWeb3KYC error:", error.message);
    res.status(500).json({ message: 'Server error during Web3 verification' });
  }
};

// ==================== Update Primary Wallet preference ====================
export const updatePrimaryWallet = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { primaryReceivingWallet } = req.body;

    if (!["internal", "external"].includes(primaryReceivingWallet)) {
      return res.status(400).json({ message: "Invalid wallet type selection." });
    }

    if (primaryReceivingWallet === "external" && !user.metamask_id) {
      return res.status(400).json({
        success: false,
        message: "Please link an external wallet first."
      });
    }

    const { data: updatedProfile, error } = await supabase
      .from('profiles')
      .update({ primary_receiving_wallet: primaryReceivingWallet })
      .eq('id', user.id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ message: 'Database error updating wallet preference' });
    }

    return res.status(200).json({
      message: 'Primary receiving wallet updated successfully',
      primaryReceivingWallet: updatedProfile.primary_receiving_wallet
    });
  } catch (error) {
    console.error("Update primary wallet error:", error.message);
    res.status(500).json({ message: 'Server error while updating wallet preference' });
  }
};

// ==================== Generate Wallet Challenge (Nonce) ====================
export const walletChallenge = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    // Generate random 16-byte nonce
    const { randomBytes } = await import('crypto');
    const nonce = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const challengeText = `GlobalPay Wallet Verification\nNonce: ${nonce}\nTimestamp: ${timestamp}`;
    const expiresAt = timestamp + 5 * 60 * 1000; // 5 minutes expiration

    // Store challenge message and expiration as JSON string in wallet_challenge
    const { error } = await supabase
      .from('profiles')
      .update({
        wallet_challenge: JSON.stringify({ challengeText, expiresAt })
      })
      .eq('id', user.id);

    if (error) {
      console.error("Database error in walletChallenge:", error.message);
      return res.status(500).json({ message: 'Database error generating wallet challenge' });
    }

    return res.status(200).json({ challenge: challengeText });
  } catch (error) {
    console.error("walletChallenge error:", error.message);
    res.status(500).json({ message: 'Server error while generating wallet challenge' });
  }
};

// ==================== Update MPC Embedded Wallet Metadata ====================
export const updateWallet = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const { internalWalletAddress, signature } = req.body;

    if (!internalWalletAddress || !signature) {
      return res.status(400).json({ message: "Wallet address and signature are required." });
    }

    // Validate EVM wallet address format
    const { ethers } = await import('ethers');
    if (!ethers.isAddress(internalWalletAddress)) {
      return res.status(400).json({ message: "Invalid EVM wallet address format." });
    }

    // 1. Fetch profile to check the challenge
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('wallet_challenge, internal_wallet_address')
      .eq('id', user.id)
      .single();

    if (fetchError || !profile) {
      return res.status(400).json({ message: "User profile not found." });
    }

    if (!profile.wallet_challenge) {
      return res.status(400).json({ message: "Wallet challenge not initiated or already used." });
    }

    // 2. Parse and validate the challenge
    let challengeData;
    try {
      challengeData = JSON.parse(profile.wallet_challenge);
    } catch (e) {
      return res.status(400).json({ message: "Corrupted challenge data." });
    }

    const { challengeText, expiresAt } = challengeData;
    if (!challengeText || !expiresAt) {
      return res.status(400).json({ message: "Invalid challenge format." });
    }

    if (Date.now() > expiresAt) {
      // Clear expired challenge immediately
      await supabase.from('profiles').update({ wallet_challenge: null }).eq('id', user.id);
      return res.status(400).json({ message: "Verification challenge has expired." });
    }

    // 3. Cryptographically verify signature
    let recoveredAddress;
    try {
      if (ethers.utils && typeof ethers.utils.verifyMessage === 'function') {
        recoveredAddress = ethers.utils.verifyMessage(challengeText, signature);
      } else if (typeof ethers.verifyMessage === 'function') {
        recoveredAddress = ethers.verifyMessage(challengeText, signature);
      } else {
        throw new Error("Ethers verifyMessage function not found.");
      }
    } catch (sigErr) {
      return res.status(400).json({ message: "Signature verification failed." });
    }

    if (recoveredAddress.toLowerCase() !== internalWalletAddress.toLowerCase()) {
      return res.status(400).json({ message: "Wallet ownership verification failed. Recovered signer mismatch." });
    }

    // 4. Protect existing wallet (strict migration path)
    const { forceMigration } = req.body;
    if (profile.internal_wallet_address && profile.internal_wallet_address.toLowerCase() !== internalWalletAddress.toLowerCase()) {
      if (!forceMigration) {
        return res.status(409).json({ 
          message: "A different wallet address is already linked to this profile. Migration confirmation required.",
          existingWalletAddress: profile.internal_wallet_address
        });
      }
    }

    // 5. Update profile and clear the challenge (one-time use enforced)
    const { data: updatedProfile, error: updateError } = await supabase
      .from('profiles')
      .update({
        internal_wallet_address: internalWalletAddress,
        wallet_provider: 'privy',
        wallet_challenge: null // clear the challenge after verification
      })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error("Database error in updateWallet:", updateError.message);
      return res.status(500).json({ message: 'Database error updating wallet address' });
    }

    console.log(`🤖 [PRIVY WALLET] Successfully linked wallet: ${internalWalletAddress} to user: ${user.id}`);
    
    return res.status(200).json({
      message: 'Privy Embedded Wallet registered successfully',
      internalWalletAddress: updatedProfile.internal_wallet_address,
      walletProvider: updatedProfile.wallet_provider
    });
  } catch (error) {
    console.error("updateWallet error:", error.message);
    res.status(500).json({ message: 'Server error while updating wallet details' });
  }
};

// ==================== Refresh Session Token ====================
export const refreshSession = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required' });
  }

  try {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }
    return res.status(200).json({
      token: data.session.access_token,
      refreshToken: data.session.refresh_token
    });
  } catch (err) {
    console.error("refreshSession error:", err.message);
    return res.status(500).json({ message: 'Server error during session refresh' });
  }
};
