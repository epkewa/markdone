import Link from "next/link";
import { redirect } from "next/navigation";
import { configured, supabase } from "../../lib/supabase/server";
import { Brand, Icon } from "../components/icons";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const ready = configured();
  if (ready) {
    const client = await supabase();
    const { data } = await client.auth.getClaims();
    if (data?.claims.sub) redirect("/references");
  }

  return (
    <main className="sign-in">
      <section className="sign-in-main">
        <Brand />
        <div className="sign-in-content">
          <h1>Sign in to Markdone</h1>
          <p>Open your library of creative references, editing techniques, and project folders.</p>
          <SignInForm ready={ready} />
          <div className="demo-entry">
            <span>Explore without an account</span>
            <Link href="/demo">Try demo <Icon name="arrow" size={16} /></Link>
          </div>
        </div>
      </section>
      <div className="sign-in-art" aria-hidden="true" />
    </main>
  );
}
