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
          <p>Open your reference library.</p>
          <div className="demo-entry">
            <Link className="button secondary" href="/demo"><Icon name="play" size={18} /> Try demo</Link>
            <span>No account needed.</span>
          </div>
          <SignInForm ready={ready} />
        </div>
      </section>
      <div className="sign-in-art" aria-hidden="true">
        <div className="art-cards">
          <div className="art-card instagram"><Icon name="instagram" size={44} /></div>
          <div className="art-card tiktok"><Icon name="tiktok" size={46} /></div>
          <div className="art-card youtube"><Icon name="youtube" size={54} /></div>
          <div className="art-card x"><Icon name="x" size={29} /></div>
        </div>
      </div>
    </main>
  );
}
