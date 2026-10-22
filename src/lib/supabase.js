import { createClient } from '@supabase/supabase-js';

// The app talks to Supabase only when both variables are set (Vercel > Settings > Environment Variables).
// Without them it runs exactly as before, saving to this browser only.
const url = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();

export const supabase = url && key ? createClient(url, key) : null;
