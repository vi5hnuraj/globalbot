import express from 'express';
import { supabase } from '../config/supabaseClient.js';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

router.get('/supabase-key', async (req, res) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'NOT_SET';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'NOT_SET';
  const anonKey = process.env.SUPABASE_ANON_KEY || 'NOT_SET';
  const cleanUrl = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');

  // Test 1: can the global supabase singleton SELECT profiles?
  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, global_pay_tag')
    .eq('global_pay_tag', '@amann_gl')
    .maybeSingle();

  // Test 2: can the global supabase singleton INSERT into money_transfers?
  // Use a dummy row and immediately delete it
  const dummyId = '00000000-0000-0000-0000-000000000001';
  const { error: insertError } = await supabase
    .from('money_transfers')
    .insert({
      id: dummyId,
      sender_id: '00000000-0000-0000-0000-000000000002',
      receiver_id: '00000000-0000-0000-0000-000000000003',
      amount: 0.001,
      network: 'botchain',
      status: 'PENDING',
      bot_amount: 0.001,
      created_at: new Date().toISOString(),
      raw_signed_tx: 'DEBUG_TEST'
    });
  // Clean up
  if (!insertError) await supabase.from('money_transfers').delete().eq('id', dummyId);

  // Test 3: fresh service role client INSERT test
  let freshServiceInsertError = null;
  if (serviceKey !== 'NOT_SET') {
    const freshService = createClient(cleanUrl, serviceKey);
    const { error: e } = await freshService.from('money_transfers').insert({
      id: dummyId,
      sender_id: '00000000-0000-0000-0000-000000000002',
      receiver_id: '00000000-0000-0000-0000-000000000003',
      amount: 0.001,
      network: 'botchain',
      status: 'PENDING',
      bot_amount: 0.001,
      created_at: new Date().toISOString(),
      raw_signed_tx: 'DEBUG_TEST_FRESH'
    });
    freshServiceInsertError = e?.message || null;
    if (!e) await freshService.from('money_transfers').delete().eq('id', dummyId);
  }

  // Test 4: direct key SELECT tests
  let serviceKeyCanSelectProfile = false;
  let anonKeyCanSelectProfile = false;
  if (serviceKey !== 'NOT_SET') {
    const c = createClient(cleanUrl, serviceKey);
    const { data } = await c.from('profiles').select('id').eq('global_pay_tag', '@amann_gl').maybeSingle();
    serviceKeyCanSelectProfile = !!data;
  }
  if (anonKey !== 'NOT_SET') {
    const c = createClient(cleanUrl, anonKey);
    const { data } = await c.from('profiles').select('id').eq('global_pay_tag', '@amann_gl').maybeSingle();
    anonKeyCanSelectProfile = !!data;
  }

  res.json({
    env: {
      SUPABASE_URL: url,
      SERVICE_KEY_prefix: serviceKey.substring(0, 20),
      ANON_KEY_prefix: anonKey.substring(0, 20),
    },
    globalSingletonTests: {
      selectProfiles_canFindAmannGl: !!profileData,
      selectProfiles_error: profileError?.message || null,
      insertMoneyTransfers_error: insertError?.message || null,
      insertMoneyTransfers_blocked: !!insertError,
    },
    freshServiceClientTests: {
      insertMoneyTransfers_error: freshServiceInsertError,
      insertMoneyTransfers_blocked: !!freshServiceInsertError,
    },
    directSelectTests: {
      serviceKeyCanSelectProfile,
      anonKeyCanSelectProfile,
    },
    diagnosis: !insertError
      ? 'Global singleton CAN insert into money_transfers — no RLS issue'
      : insertError.message.includes('row-level security')
        ? 'Global singleton is BLOCKED by RLS for INSERT — likely using anon key or user-scoped session'
        : `Other INSERT error: ${insertError.message}`,
  });
});

export default router;

