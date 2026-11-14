"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "../components/icons";
import { parseLink, platforms, referenceTitle } from "../../lib/references";

export function Dialog({ close, viewer, children }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className={viewer ? "dialog viewer" : "dialog"}
      aria-labelledby="dialog-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => { if (event.target === event.currentTarget) close(); }}
    >
      <div className="dialog-inner">
        <button type="button" className="icon-button close-button" aria-label="Close" onClick={close} autoFocus={viewer}>
          <Icon name="close" />
        </button>
        {children}
      </div>
    </dialog>
  );
}

export function ActionForm({ action, close, label, destructive = false, cancel = false, children }) {
  const [result, submit, pending] = useActionState(action, null);
  useEffect(() => {
    if (result?.ok) close();
  }, [result, close]);

  return (
    <form action={submit} className="stack">
      <fieldset className="form-content stack" disabled={pending}>
        {children}
      </fieldset>
      {result?.error && <p role="alert" className="notice">{result.error}</p>}
      <div className="dialog-actions">
        {cancel && <button type="button" className="button secondary" onClick={close}>Cancel</button>}
        <button className={`button ${destructive ? "destructive" : "primary"}`} disabled={pending}>
          {pending ? "Working…" : label}
        </button>
      </div>
    </form>
  );
}

function FolderChoices({ folders, selected }) {
  const [checked, setChecked] = useState(selected);
  if (!folders.length) return null;
  return (
    <fieldset className="folder-choices">
      <legend>Project folders</legend>
      <div className="folder-options">
        {folders.map((folder) => (
          <label className="folder-choice" key={folder.id}>
            <input
              name="folderIds"
              value={folder.id}
              type="checkbox"
              checked={checked.includes(folder.id)}
              onChange={(event) => {
                const enabled = event.target.checked;
                setChecked((ids) => enabled ? [...ids, folder.id] : ids.filter((id) => id !== folder.id));
              }}
            />
            <Icon name="folder" size={17} />
            <span>{folder.name}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function AddReference({ action, close, folders, activeFolder }) {
  const [url, setUrl] = useState("");
  const link = parseLink(url);

  return (
    <>
      <h2 id="dialog-title">Add reference</h2>
      <p className="dialog-description">Paste a link from YouTube, Instagram, TikTok, or X.</p>
      <ActionForm action={action} close={close} label="Save reference" cancel>
        <label className="field">
          Link
          <input name="url" autoFocus required maxLength={2048} inputMode="url" placeholder="https://…" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        {link && <p className="detected"><Icon name={link.platform} size={16} />{platforms[link.platform].name}</p>}
        <FolderChoices folders={folders} selected={activeFolder ? [activeFolder] : []} />
      </ActionForm>
    </>
  );
}

export function EditFolders({ action, reference, folders, close }) {
  return (
    <>
      <h2 id="dialog-title">Edit folders</h2>
      <p className="dialog-description">{referenceTitle(reference)}</p>
      {folders.length ? (
        <ActionForm action={action} close={close} label="Save folders" cancel>
          <input type="hidden" name="id" value={reference.id} />
          <FolderChoices folders={folders} selected={reference.folder_references.map(({ folder_id }) => folder_id)} />
        </ActionForm>
      ) : <p>Create a project folder to organize this reference.</p>}
    </>
  );
}

export function FolderForm({ action, folder, close }) {
  const [name, setName] = useState(folder?.name ?? "");
  return (
    <>
      <h2 id="dialog-title">{folder ? "Rename folder" : "New folder"}</h2>
      <ActionForm action={action} close={close} label={folder ? "Save name" : "Create folder"} cancel>
        {folder && <input type="hidden" name="id" value={folder.id} />}
        <label className="field">
          Folder name
          <input name="name" required maxLength={60} autoFocus placeholder="e.g. Moodboard" value={name} onChange={(event) => setName(event.target.value)} />
        </label>
      </ActionForm>
    </>
  );
}

export function DeleteItem({ action, folder, reference, close }) {
  const name = folder?.name || referenceTitle(reference);
  return (
    <>
      <h2 id="dialog-title">{folder ? "Delete folder?" : "Delete reference?"}</h2>
      <p className="dialog-description">
        {folder ? <>References in <strong>{name}</strong> will stay in All References.</>
          : <><strong>{name}</strong> will be removed from your library and all project folders.</>}
      </p>
      <ActionForm action={action} close={close} label="Delete" destructive cancel>
        <input type="hidden" name="id" value={folder?.id || reference.id} />
      </ActionForm>
    </>
  );
}
