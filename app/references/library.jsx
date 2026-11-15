"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { Brand, Icon } from "../components/icons";
import { formatName, platforms, referenceTitle, referenceSources, thumbnail } from "../../lib/references";
import { signOut } from "../sign-in/actions";
import { AddReference, DeleteItem, Dialog, EditFolders, FolderForm } from "./dialogs";
import { Viewer } from "./viewer";
import * as accountActions from "./actions";

function ReferenceCard({ reference, folders, open }) {
  const title = referenceTitle(reference);
  const [imageFailed, setImageFailed] = useState(false);
  const image = !imageFailed && thumbnail(reference);
  const folderSet = new Set(reference.folder_references.map(({ folder_id }) => folder_id));
  const assigned = folders.filter(({ id }) => folderSet.has(id));

  return (
    <article className="reference-card">
      <button className={`reference-cover ${reference.platform}`} onClick={() => open("view", reference)} aria-label={`Open ${title}`}>
        {image ? <img src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : <Icon name={reference.platform} size={70} />}
        <span className="cover-action"><Icon name={["instagram", "x", "pinterest"].includes(reference.platform) ? "external" : "play"} size={19} /></span>
      </button>
      <div className="card-body">
        <div className="card-topline">
          <span className={`source-pill ${reference.platform}`}><Icon name={reference.platform} size={15} />{platforms[reference.platform].name}</span>
          <span className="media-kind">{formatName(reference)}</span>
        </div>
        <h2><button onClick={() => open("view", reference)}>{title}</button></h2>
        <div className="card-bottom">
          <div className="folder-tags">
            {assigned.slice(0, 2).map(({ id, name }) => <span key={id} title={name}><Icon name="folder" size={13} />{name}</span>)}
            {assigned.length > 2 && <span title={assigned.slice(2).map(({ name }) => name).join(", ")}>+{assigned.length - 2}</span>}
          </div>
          <details className="item-actions">
            <summary className="icon-button" aria-label={`Actions for ${title}`}><Icon name="more" size={19} /></summary>
            <div className="action-popover">
              <button onClick={(event) => { event.currentTarget.closest("details").open = false; open("edit", reference); }}>Edit folders</button>
              <button className="danger-text" onClick={(event) => { event.currentTarget.closest("details").open = false; open("deleteReference", reference); }}>Delete reference</button>
            </div>
          </details>
        </div>
      </div>
    </article>
  );
}

const formatter = new Intl.NumberFormat("en-US");

function Exit({ demo }) {
  return demo
    ? <Link className="button secondary demo-exit" href="/sign-in">Exit demo</Link>
    : <form action={signOut}><button type="submit" className="icon-button" aria-label="Sign out" title="Sign out"><Icon name="logout" size={18} /></button></form>;
}

export function Library({ email, folders, references, demo, analysisEnabled = false, actions = accountActions, initialReference, missingReference }) {
  const [folderId, setFolderId] = useState("");
  const [dialog, setDialog] = useState(() => initialReference ? { type: "view", item: initialReference, direct: true } : null);
  const direct = dialog?.direct;
  const close = useCallback(() => {
    setDialog(null);
    if (direct) window.history.replaceState(null, "", "/references");
  }, [direct]);
  const active = folders.find(({ id }) => id === folderId);
  const counts = new Map();
  for (const reference of references) {
    for (const { folder_id } of reference.folder_references) {
      counts.set(folder_id, (counts.get(folder_id) || 0) + 1);
    }
  }
  const visible = active ? references.filter((reference) => reference.folder_references.some(({ folder_id }) => folder_id === active.id)) : references;

  function open(type, item) {
    setDialog({ type, item });
  }

  const reference = references.find(({ id }) => id === dialog?.item?.id) || dialog?.item;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar-nav" aria-label="Reference folders">
          <button className={`nav-item ${!active ? "active" : ""}`} aria-current={!active ? "page" : undefined} onClick={() => setFolderId("")}>
            <Icon name="library" size={18} /><span>All References</span><span className="nav-count">{formatter.format(references.length)}</span>
          </button>
          <div className="nav-label">Project folders
            <button className="icon-button" aria-label="New folder" onClick={() => open("newFolder")}><Icon name="add" size={18} /></button>
          </div>
          {folders.map((folder) => (
            <button key={folder.id} className={`nav-item ${active?.id === folder.id ? "active" : ""}`} aria-current={active?.id === folder.id ? "page" : undefined} onClick={() => setFolderId(folder.id)}>
              <Icon name="folder" size={18} /><span title={folder.name}>{folder.name}</span><span className="nav-count">{formatter.format(counts.get(folder.id) || 0)}</span>
            </button>
          ))}
        </nav>
        <div className="account">
          {!demo && <><span className="avatar" aria-hidden="true">{email?.slice(0, 1).toUpperCase() || "M"}</span>
          <span title={email}>{email}</span></>}
          <Exit demo={demo} />
        </div>
      </aside>

      <main className="workspace">
        <div className="mobile-header">
          <Brand />
          <Exit demo={demo} />
        </div>
        {demo && (
          <p className="demo-banner" role="status"><strong>Demo library</strong>
            <span>{demo.storageAvailable ? "Changes are saved in this browser." : "Browser storage is unavailable. Changes last until you leave or refresh."}</span>
            {demo.catalogUnavailable && <span>Sample references are temporarily unavailable.</span>}
          </p>
        )}
        <div className="mobile-folders">
          <select aria-label="Reference folder" value={active?.id || ""} onChange={(event) => setFolderId(event.target.value)}>
            <option value="">All References</option>
            {folders.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
          </select>
          <button className="button secondary" onClick={() => open("newFolder")}><Icon name="add" size={16} /> New folder</button>
        </div>
        <header className="workspace-header">
          <div className="workspace-title">
            <div className="heading-icon"><Icon name={active ? "folder" : "library"} size={23} /></div>
            <div>
              <h1>{active?.name || "All References"}</h1>
              <p>{formatter.format(visible.length)} {visible.length === 1 ? "reference" : "references"}</p>
            </div>
          </div>
          <div className="workspace-actions">
            {!demo && <Link className="button secondary" href="/references/plan"><Icon name="plan" size={17} /> Plan a video</Link>}
            {active && (
              <details className="item-actions">
                <summary className="button secondary" aria-label="Folder options"><Icon name="more" size={20} /></summary>
                <div className="action-popover">
                  <button onClick={(event) => { event.currentTarget.closest("details").open = false; open("renameFolder", active); }}>Rename folder</button>
                  <button className="danger-text" onClick={(event) => { event.currentTarget.closest("details").open = false; open("deleteFolder", active); }}>Delete folder</button>
                </div>
              </details>
            )}
            <button className="button primary" onClick={() => open("add")}><Icon name="add" size={19} /> Add reference</button>
          </div>
        </header>
        {missingReference && <p className="notice library-preview-notice" role="status">That reference is no longer available.</p>}
        {visible.length ? (
          <section aria-label="Saved references" className="reference-grid">
            {visible.map((item) => <ReferenceCard key={item.id} reference={item} folders={folders} open={open} />)}
          </section>
        ) : (
          <section className="empty-state">
            <div className="empty-icon"><Icon name={active ? "folder" : "link"} size={28} /></div>
            <h2>{active ? "This folder is empty" : "Save your first reference"}</h2>
            <p>{active ? "Add a link here or move an existing reference into this folder." : `Paste a link from ${referenceSources} to start your collection.`}</p>
            <button className="button secondary" onClick={() => open("add")}><Icon name="add" size={17} /> Add reference</button>
          </section>
        )}
      </main>

      {dialog?.type === "add" && <AddReference action={actions.saveReference} folders={folders} activeFolder={active?.id} close={close} />}
      {dialog && dialog.type !== "add" && (
        <Dialog close={close} viewer={dialog.type === "view"}>
          {dialog.type === "view" && <Viewer demo={Boolean(demo)} retry={actions.retryReference} analyze={analysisEnabled ? actions.analyzeReference : undefined} reference={reference} close={close} />}
          {dialog.type === "edit" && <EditFolders action={actions.editMemberships} folders={folders} reference={reference} close={close} />}
          {dialog.type === "newFolder" && <FolderForm action={actions.saveFolder} close={close} />}
          {dialog.type === "renameFolder" && <FolderForm action={actions.saveFolder} folder={dialog.item} close={close} />}
          {dialog.type === "deleteFolder" && <DeleteItem action={actions.deleteFolder} folder={dialog.item} close={close} />}
          {dialog.type === "deleteReference" && <DeleteItem action={actions.deleteReference} reference={reference} close={close} />}
        </Dialog>
      )}
    </div>
  );
}
