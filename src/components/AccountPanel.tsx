import React, { useState } from 'react';
import { useAccountAuth } from '../hooks/useAccountAuth';
import { usePlayerProfile } from '../hooks/usePlayerProfile';

export function AccountPanel() {
  const { user, loading, error, linkWithGoogle, signInGoogle, signOutUser, signInEmail, registerEmail, linkEmail, isAnonymous } = useAccountAuth();
  const { profile } = usePlayerProfile();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [mode, setMode] = useState<'login'|'register'|'link'>('login');

  return (
    <div className="p-4 rounded-2xl bg-[#12171f] border border-white/10 text-sm w-full max-w-md flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Account</h3>
        {user && <span className="text-[10px] px-2 py-0.5 rounded bg-white/10">{isAnonymous ? 'Anonymous' : 'Linked'}</span>}
      </div>
      {loading && <div className="text-xs opacity-60">Loading auth…</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="text-xs break-all">
        UID: {user ? user.uid : '—'}<br/>
        Profile: {profile ? 'Loaded' : '—'}
      </div>
      <div className="flex flex-col gap-2">
        {isAnonymous && (
          <>
            <button onClick={linkWithGoogle} className="rounded bg-emerald-600/70 hover:bg-emerald-600 px-3 py-2 text-xs">Link Google</button>
            <div className="flex gap-2 text-[11px]">
              <button onClick={signInGoogle} className="flex-1 rounded bg-white/10 hover:bg-white/15 px-2 py-1">Sign In Google</button>
            </div>
            <div className="flex items-center gap-2 text-[10px] opacity-60">
              <span>Email</span>
              <select value={mode} onChange={e=>setMode(e.target.value as any)} className="bg-white/10 rounded px-1 py-0.5">
                <option value="login">Login</option>
                <option value="register">Register</option>
                <option value="link">Link</option>
              </select>
            </div>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="email" className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs" />
            <input value={pw} type="password" onChange={e=>setPw(e.target.value)} placeholder="password" className="px-2 py-1 rounded bg-white/5 border border-white/10 text-xs" />
            <button
              onClick={() => mode==='login'?signInEmail(email,pw):mode==='register'?registerEmail(email,pw):linkEmail(email,pw)}
              className="rounded bg-indigo-600/70 hover:bg-indigo-600 px-3 py-2 text-xs disabled:opacity-40"
              disabled={!email || !pw}
            >{mode==='login'?'Sign In Email':mode==='register'?'Register Email':'Link Email'}</button>
          </>
        )}
        {!isAnonymous && (
          <button onClick={signOutUser} className="rounded bg-red-600/70 hover:bg-red-600 px-3 py-2 text-xs">Sign Out</button>
        )}
      </div>
    </div>
  );
}

export default AccountPanel;