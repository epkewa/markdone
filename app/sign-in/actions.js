"use server";

import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase/server";

export async function signIn(_state, data) {
  if (!configured()) return { error: "Sign-in is unavailable until Supabase is configured." };
  const email = String(data.get("email") ?? "").trim();
  const password = String(data.get("password") ?? "");
  if (!email || !password || email.length > 254 || password.length > 256) {
    return { error: "Enter your email and password." };
  }

  const client = await supabase();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.status === 429 ? "Too many attempts. Try again shortly." : "Unable to sign in. Check your email and password and try again." };
  }
  redirect("/references");
}

export async function signOut() {
  if (configured()) {
    const client = await supabase();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Couldn't sign out. Try again.");
  }
  redirect("/sign-in");
}
