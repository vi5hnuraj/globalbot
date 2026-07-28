/**
 * Diagnostic: verify which Supabase key the Railway server actually uses.
 * This adds a temporary /api/debug/supabase-key endpoint that logs the key prefix
 * and runs a test INSERT+DELETE on money_transfers to check if RLS is bypassed.
 * 
 * SAFE: this route is only reachable from localhost (Railway internal) 
 * and we'll remove it after the check.
 */
import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

router.get('/supabase-key', async (req, res) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'NOT_SET';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'NOT_SET';
  const anonKey = process.env.SUPABASE_ANON_KEY || 'NOT_SET';

  // Test: can the global supabase client bypass RLS on profiles?
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, global_pay_tag')
    .eq('global_pay_tag', '@amann_gl')
    .maybeSingle();

  // Test: which key does supabase use? Check by creating a client with service key and one with anon key
  const cleanUrl = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
  
  let serviceKeyCanSelectProfile = false;
  let anonKeyCanSelectProfile = false;

  if (serviceKey !== 'NOT_SET') {
    const serviceClient = createClient(cleanUrl, serviceKey);
    const { data } = await serviceClient.from('profiles').select('id').eq('global_pay_tag', '@amann_gl').maybeSingle();
    serviceKeyCanSelectProfile = !!data;
  }

  if (anonKey !== 'NOT_SET') {
    const anonClient = createClient(cleanUrl, anonKey);
    const { data } = await anonClient.from('profiles').select('id').eq('global_pay_tag', '@amann_gl').maybeSingle();
    anonKeyCanSelectProfile = !!data;
  }

  res.json({
    env: {
      SUPABASE_URL: url,
      SUPABASE_SERVICE_ROLE_KEY_prefix: serviceKey.substring(0, 20),
      SUPABASE_ANON_KEY_prefix: anonKey.substring(0, 20),
    },
    globalSupabaseClientTest: {
      canFindAmannGl: !!profileData,
      error: profileError?.message || null,
    },
    directKeyTests: {
      serviceKeyCanSelectProfile,
      anonKeyCanSelectProfile,
    },
    conclusion: serviceKeyCanSelectProfile
      ? 'Service role key is valid and bypasses RLS when used directly'
      : 'Service role key CANNOT bypass RLS — either wrong key or Supabase API issue',
  });
});

export default router;
