"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function SignInForm({ ready }) {
  const [state, action, pending] = useActionState(signIn, null);

  return (
    <form action={action} className="stack" aria-busy={pending}>
      {!ready && <p className="notice" role="status">Connect Supabase to enable sign-in.</p>}
      <label className="field">
        Email
        <input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com" />
      </label>
      <label className="field">
        Password
        <input name="password" type="password" autoComplete="current-password" required maxLength={256} />
      </label>
      {state?.error && <p className="notice" role="alert">{state.error}</p>}
      <button type="submit" className="button primary" disabled={!ready || pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
