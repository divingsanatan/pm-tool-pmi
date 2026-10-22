import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { StoreProvider } from '../store/StoreContext';
import { Login, Splash } from './CloudScreens';

const signIn = async (email, password) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : '';
};
const signOut = () => supabase.auth.signOut();

// Without Supabase settings: local-only mode, same as before.
// With them: sign in first, then the workspace is loaded from and saved to the cloud.
export default function CloudGate({ children }) {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s || null));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabase) return <StoreProvider>{children}</StoreProvider>;
  if (session === undefined) return <Splash><div className="msg">Loading…</div></Splash>;
  if (!session) return <Login onSignIn={signIn} />;
  return (
    <StoreProvider key={session.user.id} cloud={{ userId: session.user.id, email: session.user.email, signOut }}>
      {children}
    </StoreProvider>
  );
}
