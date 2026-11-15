"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Brand, Icon } from "../../components/icons";
import { signOut } from "../../sign-in/actions";
import { ActionForm, Dialog } from "../dialogs";
import { formatTime } from "../../../lib/references";
import { deletePlan, sendPlan } from "./actions";

const plannerPath = "/references/plan";
const chatPath = (id) => `${plannerPath}?chat=${encodeURIComponent(id)}`;
const referenceAnchor = (turn, id) => `turn-${turn}-reference-${id}`;
const examples = [
  "What references should I use for a gym motivation video?",
  "Help me plan a cinematic coffee reel with just my phone.",
  "Find editing ideas for a 30-second product reveal.",
];

function ChatHistory({ chats, active }) {
  return chats.length ? (
    <nav className="planner-history" aria-label="Saved conversations">
      {chats.map(({ id, title }) => (
        <Link key={id} className={id === active ? "active" : undefined} href={chatPath(id)}
          prefetch={false} aria-current={id === active ? "page" : undefined} title={title}>
          <Icon name="film" size={15} /><span>{title}</span>
        </Link>
      ))}
    </nav>
  ) : <p className="planner-muted">Your conversations will appear here.</p>;
}

function Reply({ reply, turn, available }) {
  const { references, hook, shots, edit, playbackCheck } = reply;
  const numbers = new Map(references.map(({ id }, index) => [id, index + 1]));

  return (
    <div className="planner-reply">
      <section aria-labelledby={`references-${turn}`}>
        <h2 id={`references-${turn}`}>References</h2>
        {references.length ? (
          <ol className="planner-references">
            {references.map(({ id, title, startSeconds, endSeconds, why, borrow }, index) => {
              const start = formatTime(startSeconds);
              const end = formatTime(endSeconds);
              return (
                <li key={id} id={referenceAnchor(turn, id)} className="planner-reference">
                  <span className="planner-reference-number" aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3><span>{title}</span><span className="planner-time">{start === end ? start : `${start}–${end}`}</span></h3>
                    <p><strong>Why it fits:</strong> {why}</p>
                    <p><strong>What to borrow:</strong> {borrow}</p>
                    {available.has(id) ? (
                      <Link className="planner-preview-link" href={`/references?reference=${encodeURIComponent(id)}`} prefetch={false}>
                        <Icon name="play" size={16} /> Open preview<span className="sr-only"> of {title}</span>
                      </Link>
                    ) : <p className="planner-muted">Preview unavailable</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="planner-muted">No matching playbooks in your library. Here’s a starter plan you can use.</p>}
      </section>
      <section className="planner-result" aria-labelledby={`plan-${turn}`}>
        <h2 id={`plan-${turn}`}>Your video plan</h2>
        <h3>Hook</h3>
        <p>{hook}</p>
        <h3>Shots to capture</h3>
        <ul>{shots.map((shot, index) => <li key={index}>{shot}</li>)}</ul>
        <h3>Edit sequence</h3>
        <ol>
          {edit.map(({ action, referenceIds }, index) => (
            <li key={index}>
              {action}{" "}
              {referenceIds.map((id) => (
                <a key={id} className="planner-citation" href={`#${referenceAnchor(turn, id)}`}>Ref {numbers.get(id)}</a>
              ))}
            </li>
          ))}
        </ol>
        <h3>Playback check</h3>
        <p>{playbackCheck}</p>
      </section>
    </div>
  );
}

function Conversation({ chat, turns, available, enabled }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [pending, startTransition] = useTransition();
  const [deleting, setDeleting] = useState(false);
  const request = useRef(null);
  const lastMessage = useRef(null);
  const composer = useRef(null);
  const lastTurn = turns.at(-1)?.turn_number ?? 0;
  const liveReferences = new Set(available);

  useEffect(() => {
    if (lastTurn > 1) lastMessage.current?.scrollIntoView({ block: "start" });
  }, [lastTurn]);

  const closeDelete = useCallback(() => setDeleting(false), []);
  const finishDelete = useCallback(() => {
    setDeleting(false);
    router.replace(plannerPath);
    router.refresh();
  }, [router]);

  function changeDraft(value) {
    setDraft(value);
    setError((previous) => previous?.conflict ? previous : null);
  }

  function submit(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !enabled || pending || error?.conflict) return;
    if (request.current?.prompt !== prompt || request.current?.expectedTurn !== lastTurn) {
      request.current = { requestId: window.crypto.randomUUID(), prompt, expectedTurn: lastTurn };
    }
    setError(null);
    setPendingPrompt(prompt);
    const input = { chatId: chat?.id ?? null, ...request.current };
    startTransition(async () => {
      try {
        const result = await sendPlan(input);
        if (result.error) {
          setError(result);
          return;
        }
        request.current = null;
        setDraft("");
        if (!chat) router.replace(chatPath(result.chatId), { scroll: false });
      } catch {
        setError({ error: "Couldn’t make a video plan. Try sending your idea again." });
      } finally {
        setPendingPrompt("");
      }
    });
  }

  return (
    <>
      {chat ? (
        <div className="planner-chat-heading">
          <h2>{chat.title}</h2>
          <button type="button" className="button secondary compact danger-text" disabled={pending}
            onClick={() => setDeleting(true)}>Delete chat</button>
        </div>
      ) : (
        <section className="planner-intro" aria-label="Prompt ideas">
          <h2>What are you making?</h2>
          <p>Describe your idea, or try a prompt below.</p>
          <div className="planner-examples">
            {examples.map((example) => (
              <button key={example} type="button" className="planner-example"
                disabled={pending || !enabled} onClick={() => { changeDraft(example); composer.current?.focus(); }}>
                <span>{example}</span><Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="planner-thread" aria-label="Video planning conversation">
        {turns.map(({ turn_number: turn, prompt, reply }) => (
          <article className="planner-turn" key={turn} ref={turn === lastTurn ? lastMessage : undefined}>
            <p className="planner-prompt"><strong>You</strong>{prompt}</p>
            <Reply reply={reply} turn={turn} available={liveReferences} />
          </article>
        ))}
        {pendingPrompt && (
          <div className="planner-turn">
            <p className="planner-prompt"><strong>You</strong>{pendingPrompt}</p>
            <p className="planner-progress" role="status"><Icon name="plan" size={17} /> Searching playbooks and planning your video…</p>
          </div>
        )}
      </div>
      <form className="planner-composer" onSubmit={submit} aria-busy={pending}>
        <label htmlFor="video-idea">{chat ? "Ask a follow-up" : "Describe your video idea"}</label>
        <textarea id="video-idea" ref={composer} value={draft} onChange={(event) => changeDraft(event.target.value)}
          maxLength={2000} rows={3} required disabled={pending || !enabled}
          placeholder={chat ? "Can I shoot this alone in 30 seconds?" : "A 30-second gym motivation video, shot solo on my phone…"} />
        <div className="planner-composer-actions">
          <p className="planner-muted">Searches the recreation playbooks in your library.</p>
          <button type="submit" className="button primary" disabled={!draft.trim() || pending || !enabled || Boolean(error?.conflict)}>
            {pending ? "Planning…" : chat ? "Send" : "Find references"}
            {!pending && <Icon name="arrow" size={16} />}
          </button>
        </div>
        {!enabled && <p className="notice" role="status">Video planning is unavailable right now.</p>}
        {error && (
          <div className="notice" role="alert">
            {error.error}
            {error.conflict && <button type="button" className="button secondary" onClick={() => {
              setError(null);
              startTransition(() => router.refresh());
            }}>Refresh chat</button>}
          </div>
        )}
      </form>
      {deleting && (
        <Dialog close={closeDelete}>
          <h2 id="dialog-title">Delete this chat?</h2>
          <p className="dialog-description">This removes the conversation and its video plans from your account.</p>
          <ActionForm action={deletePlan} close={finishDelete} label="Delete chat" destructive cancel>
            <input type="hidden" name="chatId" value={chat.id} />
          </ActionForm>
        </Dialog>
      )}
    </>
  );
}

export function Planner({ email, chats, chat, turns, available, enabled }) {
  return (
    <div className="app-shell">
      <aside className="sidebar planner-sidebar">
        <Brand />
        <div className="planner-sidebar-main">
          <nav aria-label="Workspace">
            <Link className="nav-item" href="/references"><Icon name="library" size={17} /><span>All References</span></Link>
            <span className="nav-item active" aria-current="page"><Icon name="plan" size={17} /><span>Plan a video</span></span>
          </nav>
          <h2 className="nav-label">Saved conversations</h2>
          <ChatHistory chats={chats} active={chat?.id} />
        </div>
        <div className="account">
          <span className="avatar" aria-hidden="true">{email?.slice(0, 1).toUpperCase() || "M"}</span>
          <span title={email}>{email}</span>
          <form action={signOut}><button className="icon-button" aria-label="Sign out"><Icon name="logout" size={18} /></button></form>
        </div>
      </aside>
      <main className="workspace planner-workspace">
        <div className="workspace-bar">
          <div className="planner-bar-content">
            <nav className="breadcrumbs" aria-label="Breadcrumb">
              <Icon name="library" size={16} />
              <Link href="/references">Library</Link>
              <Icon name="chevron" size={14} />
              <span aria-current="page">Plan a video</span>
            </nav>
            <Link className="button primary" href={plannerPath}><Icon name="add" size={17} /> New chat</Link>
          </div>
        </div>
        <div className="workspace-content planner-content">
          <header className="workspace-title planner-title">
            <h1>Plan a video</h1>
            <p>Turn your saved references into a plan you can shoot and edit.</p>
          </header>
          <div className="planner-mobile">
            <details key={chat?.id ?? "new"}>
              <summary>Saved conversations</summary>
              <ChatHistory chats={chats} active={chat?.id} />
            </details>
          </div>
          <Conversation key={chat?.id ?? "new"} chat={chat} turns={turns} available={available} enabled={enabled} />
        </div>
      </main>
    </div>
  );
}
