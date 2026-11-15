"use client";

import { useActionState, useEffect, useState } from "react";
import { formatName, formatTime, parseLink, platforms, referenceTitle } from "../../lib/references";
import { Icon } from "../components/icons";
import { ActionForm } from "./dialogs";

function OriginalLink({ link }) {
  if (!link) return null;
  return (
    <a className="button secondary compact" href={link.url} target="_blank" rel="noopener noreferrer">
      Open original <Icon name="external" size={15} />
    </a>
  );
}

function PanelHeading({ icon, title, id, children }) {
  return (
    <div className="viewer-panel-heading">
      <span className={`panel-icon ${icon}`}><Icon name={icon} size={17} /></span>
      <div>
        <h3 id={id}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function AnalyzeButton({ action, referenceId, label }) {
  const [result, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="video-analysis-action" aria-busy={pending}>
      <input type="hidden" name="id" value={referenceId} />
      <button type="submit" className="button secondary compact" disabled={pending}>
        {pending ? "Analyzing video…" : label}
      </button>
      {result?.error && <p role="alert" className="notice">{result.error}</p>}
    </form>
  );
}

function Playbook({ playbook }) {
  return (
    <section className="viewer-panel recreation-playbook" aria-labelledby="editing-title">
      <PanelHeading icon="steps" title="Editing instructions" id="editing-title">
        <p>Premiere Pro recreation playbook</p>
      </PanelHeading>
      <div className="playbook-materials">
        <h4>What you’ll need</h4>
        <ul>{playbook.materials.map((material) => <li key={material}>{material}</li>)}</ul>
      </div>
      <ol className="editing-steps" aria-label="Step-by-step recreation">
        {playbook.steps.map(({ title, action }, index) => (
          <li key={action}>
            <span aria-hidden="true">{index + 1}</span>
            <div><h4>{title}</h4><p>{action}</p></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function VideoAnalysis({ reference, analyze }) {
  const {
    ai_status: status, ai_claim_until: claimUntil, ai_summary: summary, ai_source: source,
    ai_playbook: playbook, ai_version: version,
  } = reference;
  const [expiredClaim, setExpiredClaim] = useState(null);
  useEffect(() => {
    if (status !== "processing" || !claimUntil) return;
    const timer = setTimeout(() => setExpiredClaim(claimUntil), Math.max(0, Date.parse(claimUntil) - Date.now() + 250));
    return () => clearTimeout(timer);
  }, [status, claimUntil]);

  const processing = status === "processing" && claimUntil && expiredClaim !== claimUntil;
  let notice;
  let actionLabel;
  if (summary) {
    if (processing && !playbook) notice = "Updating analysis…";
    if (analyze && version === 0 && !processing && !playbook) actionLabel = "Update analysis";
  } else {
    if (!reference.post_id || reference.kind === "photo" || !status) return null;
    if (status === "not_video") notice = "The platform’s public post details didn’t identify a video.";
    if (status === "unavailable") notice = "There isn’t enough public information to describe this video.";
    if (!analyze && !notice) return null;
    if (analyze && processing) {
      notice = "Video analysis is in progress.";
    } else if (analyze) {
      if (status === "failed" || status === "processing") notice = "Video analysis couldn’t finish. You can try again.";
      actionLabel = notice ? "Retry analysis" : "Analyze video";
    }
  }

  const start = playbook && formatTime(playbook.startSeconds);
  const end = playbook && formatTime(playbook.endSeconds);
  return (
    <>
      <section className="viewer-panel video-analysis" aria-labelledby="analysis-title">
        <PanelHeading icon="plan" title="AI analysis" id="analysis-title">
          {summary && <p>{source === "video" ? "Based on the video" : "Based on public post details"}</p>}
        </PanelHeading>
        {summary && <p>{summary}</p>}
        {summary && playbook && (
          <p className="playbook-observation">
            <strong>{start === end ? `Around ${start}` : `${start}–${end}`}</strong>{playbook.observation}
          </p>
        )}
        {notice && <p className="panel-muted" role="status">{notice}</p>}
        {actionLabel && <AnalyzeButton action={analyze} referenceId={reference.id} label={actionLabel} />}
      </section>
      {summary && playbook && <Playbook playbook={playbook} />}
    </>
  );
}

export function Viewer({ reference, close, demo, retry, analyze, folders, editFolders }) {
  const [failedSource, setFailedSource] = useState(null);
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
  const canPreview = source && source !== failedSource;

  return (
    <>
      <header className="viewer-heading">
        <div className="card-topline">
          <span className={`source-pill ${reference.platform}`}>
            <Icon name={reference.platform} size={15} />{platforms[reference.platform].name}
          </span>
          <span className="media-kind">{formatName(reference)}</span>
        </div>
        <h2 id="dialog-title">{title}</h2>
      </header>
      <div className="viewer-layout">
        <div className="viewer-media">
          <section className="preview" aria-label="Reference preview">
            {canPreview ? (
              <div className={`player-stage ${shape}`}>
                <iframe
                  className={`player ${shape}`}
                  src={source}
                  title={title}
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox={usesWidget ? "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation" : undefined}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  onError={() => setFailedSource(source)}
                />
              </div>
            ) : (
              <div className="preview-unavailable">
                <Icon name="film" size={24} />
                <p>This preview is unavailable.</p>
              </div>
            )}
            <div className="viewer-footer">
              {canPreview && <span>Playback depends on the original post.</span>}
              <OriginalLink link={link} />
            </div>
            {retry && link && !link.id && !reference.post_id && (
              <ActionForm action={retry} close={close} label="Retry link">
                <input type="hidden" name="id" value={reference.id} />
              </ActionForm>
            )}
          </section>
          <section className="viewer-panel project-panel" aria-labelledby="project-title">
            <div className="project-heading">
              <PanelHeading icon="folder" title="Project folders" id="project-title" />
              <button type="button" className="button secondary compact" onClick={editFolders}>Edit folders</button>
            </div>
            {folders.length ? (
              <ul className="project-tags">{folders.map(({ id, name }) => <li key={id}><Icon name="folder" size={14} />{name}</li>)}</ul>
            ) : <p className="panel-muted">This reference hasn’t been added to a project folder.</p>}
          </section>
        </div>
        {!demo && <div className="viewer-notes"><VideoAnalysis reference={reference} analyze={analyze} /></div>}
      </div>
    </>
  );
}
