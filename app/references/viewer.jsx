"use client";

import { useActionState, useEffect, useState } from "react";
import { parseLink, platforms, referenceTitle } from "../../lib/references";
import { Icon } from "../components/icons";
import { ActionForm } from "./dialogs";

export function OriginalLink({ reference, className }) {
  const link = parseLink(reference.url);
  if (!link) return null;
  return (
    <a className={className} href={link.url} target="_blank" rel="noopener noreferrer">
      Open original <Icon name="external" size={16} />
    </a>
  );
}

function AnalyzeButton({ action, referenceId, label }) {
  const [result, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="video-analysis-action">
      <input type="hidden" name="id" value={referenceId} />
      <button type="submit" className="button secondary" disabled={pending}>
        {pending ? "Analyzing video…" : label}
      </button>
      {result?.error && <p role="alert" className="notice">{result.error}</p>}
    </form>
  );
}

function VideoAnalysis({ reference, analyze }) {
  const { ai_status: status, ai_claim_until: claimUntil, ai_summary: summary, ai_steps: steps, ai_source: source } = reference;
  const [expiredClaim, setExpiredClaim] = useState(null);
  useEffect(() => {
    if (status !== "processing" || !claimUntil) return;
    const timer = setTimeout(() => setExpiredClaim(claimUntil), Math.max(0, Date.parse(claimUntil) - Date.now() + 250));
    return () => clearTimeout(timer);
  }, [status, claimUntil]);

  if (status === "ready" && summary) {
    return (
      <section className="video-analysis" aria-label="AI video analysis">
        <p className="analysis-source">{source === "video" ? "AI analysis · Based on the video" : "AI analysis · Based on public post details"}</p>
        <h3>About this video</h3>
        <p>{summary}</p>
        {steps?.length > 0 && (
          <>
            <h3>How to apply it</h3>
            <ol>{steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </>
        )}
      </section>
    );
  }

  if (!reference.post_id || reference.kind === "photo" || !status) return null;
  let notice;
  if (status === "not_video") notice = "The platform’s public post details didn’t identify a video.";
  if (status === "unavailable") notice = "There isn’t enough public information to describe this video.";
  if (!analyze) return notice ? <p className="notice video-analysis">{notice}</p> : null;
  if (status === "processing" && claimUntil && expiredClaim !== claimUntil) {
    return <p className="notice video-analysis" role="status">Video analysis is in progress.</p>;
  }
  if (status === "failed" || status === "processing") notice = "Video analysis couldn’t finish. You can try again.";
  return (
    <div className="video-analysis">
      {notice && <p role="status">{notice}</p>}
      <AnalyzeButton action={analyze} referenceId={reference.id} label={notice ? "Retry analysis" : "Analyze video"} />
    </div>
  );
}

export function Viewer({ reference, close, demo, retry, analyze }) {
  const [failed, setFailed] = useState(false);
  const link = parseLink(reference.url);
  const title = referenceTitle(reference);
  let source;
  if (link?.id && link.platform === "youtube") {
    source = `https://www.youtube-nocookie.com/embed/${link.id}?playsinline=1`;
  } else if (link?.id && link.platform === "tiktok") {
    source = `https://www.tiktok.com/player/v1/${link.id}?description=1`;
  } else if (link?.id && link.platform === "x") {
    source = `https://platform.twitter.com/embed/Tweet.html?id=${link.id}&dnt=true`;
  } else if (link?.id && ["instagram", "pinterest"].includes(link.platform)) {
    source = demo
      ? `/demo/embed?url=${encodeURIComponent(link.url)}`
      : `/references/embed?id=${encodeURIComponent(reference.id)}`;
  }

  const usesWidget = ["instagram", "pinterest"].includes(link?.platform);
  const shape = usesWidget || link?.platform === "x" ? "social" : link?.platform === "tiktok" || link?.kind === "shorts" ? "portrait" : "landscape";

  return (
    <>
      <div className="viewer-heading">
        <div className={`source-pill ${reference.platform}`}>
          <Icon name={reference.platform} size={16} />{platforms[reference.platform].name}
        </div>
        <h2 id="dialog-title">{title}</h2>
      </div>
      {source && !failed ? (
        <iframe
          className={`player ${shape}`}
          src={source}
          title={title}
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox={usesWidget ? "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation" : undefined}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          onError={() => setFailed(true)}
        />
      ) : <p className="notice">This preview is unavailable.</p>}
      {!demo && <VideoAnalysis reference={reference} analyze={analyze} />}
      <div className="viewer-footer">
        {source && !failed && <span>Preview depends on the original post’s availability.</span>}
        <OriginalLink reference={reference} className="button secondary" />
      </div>
      {retry && link && !link.id && !reference.post_id && (
        <ActionForm action={retry} close={close} label="Retry link">
          <input type="hidden" name="id" value={reference.id} />
        </ActionForm>
      )}
    </>
  );
}
