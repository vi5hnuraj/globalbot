import { supabase } from '../config/supabaseClient.js';
import { createClient } from '@supabase/supabase-js';

const authUrl = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const authAnonKey = process.env.SUPABASE_ANON_KEY;
const authClient = createClient(authUrl || 'https://placeholder.supabase.co', authAnonKey || 'placeholder', {
  auth: { persistSession: false, autoRefreshToken: false }
});

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    // Verify token with dedicated stateless Auth Client
    const { data: { user: supabaseUser }, error } = await authClient.auth.getUser(token);
    if (error || !supabaseUser) {
      return res.status(401).json({ message: 'Authentication failed' });
    }

    // Fetch user public profile from public.profiles table
    const { data: profile, error: dbErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', supabaseUser.id)
      .single();

    if (dbErr || !profile) {
      return res.status(401).json({ message: 'Authentication failed' });
    }

    // Attach full profile object to request (shape is matching Mongoose user document fields)
    req.user = profile;

    next();
  } catch (err) {
    console.error('[AUTH] Token verification error');
    res.status(500).json({ message: 'Authentication service unavailable' });
  }
};

export default authMiddleware;
