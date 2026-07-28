import Stripe from 'stripe';
import dotenv from 'dotenv';
import { supabase } from '../config/supabaseClient.js';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

// Create a Checkout Session
export const createCheckoutSession = async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.user.id; // from authMiddleware
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ msg: 'Invalid amount' });
    }

    // Fetch user's bank details from Supabase
    const { data: bankDetails } = await supabase
      .from('bank_details')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    let stripeCurrency = 'usd';
    if (bankDetails && bankDetails.region) {
      const region = bankDetails.region.toLowerCase();
      if (region === 'mexico') stripeCurrency = 'mxn';
      else if (region === 'india') stripeCurrency = 'inr';
      else if (region === 'brazil') stripeCurrency = 'brl';
      else if (region === 'france') stripeCurrency = 'eur';
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: stripeCurrency,
            product_data: {
              name: 'Fiat Deposit',
              description: `Top up your domestic fiat account in ${stripeCurrency.toUpperCase()}`,
            },
            unit_amount: Math.round(amount * 100), // Stripe takes amounts in cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      // We pass the userId in client_reference_id so the webhook knows who paid
      client_reference_id: userId,
      success_url: `http://localhost:5173/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `http://localhost:5173/bank-detail`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error("Stripe session error:", error.message);
    // Simulation mode: only available in non-production environments
    if (process.env.NODE_ENV !== 'production') {
      console.warn("[STRIPE] Falling back to simulation mode (non-production only)");
      res.json({ url: `http://localhost:5173/payment-success?session_id=simulated_${req.body.amount}` });
    } else {
      res.status(503).json({ message: 'Payment service temporarily unavailable. Please try again later.' });
    }
  }
};

// Verify Session (For local development without webhooks)
export const verifySession = async (req, res) => {
  try {
    const { session_id } = req.body;
    const userId = req.user.id;
    let amountInUSD = 0;
    let isPaid = false;

    if (session_id.startsWith('simulated_')) {
      // ✅ SECURITY: Simulation mode only available in non-production
      if (process.env.NODE_ENV === 'production') {
        return res.status(400).json({ msg: 'Invalid session' });
      }
      isPaid = true;
      amountInUSD = parseFloat(session_id.split('_')[1]);
      if (isNaN(amountInUSD) || amountInUSD <= 0 || amountInUSD > 100000) {
        return res.status(400).json({ msg: 'Invalid simulated amount' });
      }
    } else {
      // Retrieve the session from Stripe
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        isPaid = true;
        amountInUSD = session.amount_total / 100;
      }
    }
    
    if (isPaid) {
      const { data: bankDetails } = await supabase
        .from('bank_details')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (bankDetails) {
        const exchangeRates = { India: 83.5, Brazil: 5.1, Mexico: 17.5 };
        const rate = exchangeRates[bankDetails.region] || 83.5;
        const localAmount = amountInUSD * rate;
        const newBalance = Number(bankDetails.amount) + localAmount;

        await supabase
          .from('bank_details')
          .update({ amount: newBalance })
          .eq('id', bankDetails.id);
        
        return res.json({ msg: 'Payment verified and balance updated!', localAmount });
      }
    }
    
    res.status(400).json({ msg: 'Payment not successful yet' });
  } catch (error) {
    console.error("Verify session error:", error);
    res.status(500).json({ msg: 'Payment verification failed. Please try again.' });
  }
};
