import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export async function supabase() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll(values) {
          // The proxy refreshes cookies before server components are rendered.
          for (const { name, value, options } of values) {
            try {
              store.set(name, value, options);
            } catch {
              // Server components can only read cookies.
            }
          }
        },
      },
    },
  );
}
