"use client";

import { useState } from "react";
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

export function Viewer({ reference, close, demo, retry }) {
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
  } else if (link?.id && link.platform === "instagram") {
    source = demo
      ? `/demo/embed?url=${encodeURIComponent(link.url)}`
      : `/references/embed?id=${encodeURIComponent(reference.id)}`;
  }

  const isInstagram = link?.platform === "instagram";
  const shape = isInstagram || link?.platform === "x" ? "social" : link?.platform === "tiktok" || link?.kind === "shorts" ? "portrait" : "landscape";

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
          sandbox={isInstagram ? "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-presentation" : undefined}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          onError={() => setFailed(true)}
        />
      ) : <p className="notice">This preview is unavailable.</p>}
      <div className="viewer-footer">
        {source && !failed && <span>Playback depends on the original post’s availability.</span>}
        <OriginalLink reference={reference} className="button secondary" />
      </div>
      {retry && link && !link.id && !reference.post_id && (
        <ActionForm action={retry} close={close} label="Retry preview">
          <input type="hidden" name="id" value={reference.id} />
        </ActionForm>
      )}
    </>
  );
}
