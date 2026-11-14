"use client";

export default function ReferencesError({ unstable_retry: retry }) {
  return (
    <main className="page-error">
      <h1>Couldn’t load your references</h1>
      <p>Check your connection and try again.</p>
      <button className="button primary" onClick={retry || (() => window.location.reload())}>Try again</button>
    </main>
  );
}
