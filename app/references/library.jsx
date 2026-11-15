"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Brand, Icon } from "../components/icons";
import { formatName, platforms, referenceTitle, referenceSources, thumbnail } from "../../lib/references";
import { signOut } from "../sign-in/actions";
import { AddReference, DeleteItem, Dialog, EditFolders, FolderForm } from "./dialogs";
import { Viewer } from "./viewer";
import * as accountActions from "./actions";

const formatter = new Intl.NumberFormat("en-US");

function ItemActions({ label, items, bordered = false }) {
  const menuRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    function closeOnOutsidePointer(event) {
      const menu = menuRef.current;
      if (menu && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [expanded]);

  function dismiss(details) {
    details.open = false;
    details.querySelector("summary").focus();
  }

  return (
    <details ref={menuRef} className="item-actions" onToggle={(event) => setExpanded(event.currentTarget.open)}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && event.currentTarget.open) {
          event.preventDefault();
          dismiss(event.currentTarget);
        }
      }}>
      <summary className={bordered ? "icon-button bordered" : "icon-button"} aria-label={label}>
        <Icon name="more" size={19} />
      </summary>
      <div className="action-popover">
        {items.map(({ label, icon, destructive, select }) => (
          <button key={label} type="button" className={destructive ? "danger-text" : undefined}
            onClick={(event) => {
              dismiss(event.currentTarget.closest("details"));
              select();
            }}>
            <Icon name={icon} size={16} />{label}
          </button>
        ))}
      </div>
    </details>
  );
}

function ReferenceCard({ reference, assigned, open, selectFolder }) {
  const title = referenceTitle(reference);
  const image = thumbnail(reference);
  const [failedImage, setFailedImage] = useState(null);
  const showImage = image && image !== failedImage;
  const format = formatName(reference);
  const view = () => open("view", reference);

  return (
    <article className="reference-card">
      <button type="button" className={`reference-cover ${reference.platform}`} onClick={view} aria-label={`Open ${title}`}>
        {showImage ? <img src={image} alt="" loading="lazy" onError={() => setFailedImage(image)} /> : (
          <span className="cover-placeholder" aria-hidden="true">
            <span className="cover-frame"><Icon name={reference.platform} size={30} /></span>
          </span>
        )}
        <span className="cover-action">
          <Icon name={["instagram", "x", "pinterest"].includes(reference.platform) ? "external" : "play"} size={16} />
        </span>
      </button>
      <div className="card-body">
        <div className="card-topline">
          <span className={`source-pill ${reference.platform}`}><Icon name={reference.platform} size={14} />{platforms[reference.platform].name}</span>
          <span className="media-kind">{format}</span>
          {reference.ai_playbook && <span className="card-playbook"><Icon name="steps" size={13} /> Playbook</span>}
        </div>
        <h2><button type="button" onClick={view} title={title}>{title}</button></h2>
        <div className="card-bottom">
          <div className="folder-tags">
            {assigned.slice(0, 2).map(({ id, name }) => (
              <button key={id} type="button" title={name} onClick={() => selectFolder(id)}>
                <Icon name="folder" size={13} /><span>{name}</span>
              </button>
            ))}
            {assigned.length > 2 && (
              <span className="folder-overflow" title={assigned.slice(2).map(({ name }) => name).join(", ")}
                aria-label={`${assigned.length - 2} more project folders`}>+{assigned.length - 2}</span>
            )}
          </div>
          <ItemActions label={`Actions for ${title}`} items={[
            { label: "Edit folders", icon: "folder", select: () => open("edit", reference) },
            { label: "Delete reference", icon: "delete", destructive: true, select: () => open("deleteReference", reference) },
          ]} />
        </div>
      </div>
    </article>
  );
}

function LibraryNavigation({ folders, active, counts, total, demo, selectFolder, newFolder }) {
  return (
    <nav className="sidebar-nav" aria-label="Library navigation">
      <button type="button" className={`nav-item ${!active ? "active" : ""}`} aria-current={!active ? "page" : undefined} onClick={() => selectFolder("")}>
        <Icon name="library" size={17} /><span>All References</span><span className="nav-count">{formatter.format(total)}</span>
      </button>
      {!demo && (
        <Link className="nav-item" href="/references/plan"><Icon name="plan" size={17} /><span>Plan a video</span></Link>
      )}
      <div className="nav-label">
        <span>Project folders</span>
        <button type="button" className="icon-button" aria-label="New folder" title="New folder" onClick={newFolder}><Icon name="add" size={17} /></button>
      </div>
      {folders.map((folder) => (
        <button key={folder.id} type="button" className={`nav-item ${active?.id === folder.id ? "active" : ""}`}
          aria-current={active?.id === folder.id ? "page" : undefined} onClick={() => selectFolder(folder.id)}>
          <Icon name="folder" size={17} /><span title={folder.name}>{folder.name}</span><span className="nav-count">{formatter.format(counts.get(folder.id) || 0)}</span>
        </button>
      ))}
    </nav>
  );
}

function Account({ email, demo }) {
  return (
    <div className="account">
      {demo ? (
        <Link className="nav-item" href="/sign-in"><Icon name="logout" size={17} /><span>Exit demo</span></Link>
      ) : (
        <>
          <span className="avatar" aria-hidden="true">{email?.slice(0, 1).toUpperCase() || "M"}</span>
          <span title={email}>{email}</span>
          <form action={signOut}><button type="submit" className="icon-button" aria-label="Sign out" title="Sign out"><Icon name="logout" size={17} /></button></form>
        </>
      )}
    </div>
  );
}

export function Library({ email, folders, references, demo, analysisEnabled = false, actions = accountActions, initialReference, missingReference }) {
  const [folderId, setFolderId] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(() => initialReference ? { type: "view", item: initialReference, direct: true } : null);
  const searchInput = useRef(null);
  const direct = dialog?.direct;
  const hasDialog = Boolean(dialog);
  const close = useCallback(() => {
    setDialog(null);
    if (direct) window.history.replaceState(null, "", "/references");
  }, [direct]);

  useEffect(() => {
    function focusSearch(event) {
      if (hasDialog || event.defaultPrevented || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      searchInput.current?.focus();
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [hasDialog]);

  const active = folders.find(({ id }) => id === folderId);
  const { counts, assignedFolders } = useMemo(() => {
    const counts = new Map();
    const assignedFolders = new Map();
    const folderOrder = new Map(folders.map((folder, index) => [folder.id, index]));
    for (const reference of references) {
      const assigned = [];
      for (const { folder_id } of reference.folder_references) {
        counts.set(folder_id, (counts.get(folder_id) || 0) + 1);
        const index = folderOrder.get(folder_id);
        if (index !== undefined) assigned.push(index);
      }
      assignedFolders.set(reference.id, assigned.sort((left, right) => left - right).map((index) => folders[index]));
    }
    return { counts, assignedFolders };
  }, [folders, references]);

  const scoped = useMemo(() => active
    ? references.filter((reference) => reference.folder_references.some(({ folder_id }) => folder_id === active.id))
    : references, [active, references]);
  const search = useDeferredValue(query.trim().toLowerCase());
  const visible = useMemo(() => {
    if (!search) return scoped;
    const terms = search.split(/\s+/);
    return scoped.filter((reference) => {
      const text = [referenceTitle(reference), platforms[reference.platform].name, formatName(reference), reference.url,
        ...assignedFolders.get(reference.id).map(({ name }) => name)].join(" ").toLowerCase();
      return terms.every((term) => text.includes(term));
    });
  }, [search, scoped, assignedFolders]);

  function open(type, item) {
    setDialog({ type, item });
  }

  function selectFolder(id) {
    setFolderId(id);
    setQuery("");
    if (dialog?.type === "navigation") close();
  }

  function clearSearch() {
    setQuery("");
    searchInput.current?.focus();
  }

  const reference = references.find(({ id }) => id === dialog?.item?.id) || dialog?.item;
  const navigationProps = { folders, active, counts, total: references.length, demo, selectFolder, newFolder: () => open("newFolder") };
  const referenceCount = `${formatter.format(visible.length)} ${visible.length === 1 ? "reference" : "references"}`;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <LibraryNavigation {...navigationProps} />
        <Account email={email} demo={demo} />
      </aside>

      <main className="workspace library-workspace">
        <div className="workspace-bar">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Icon name="library" size={16} />
            {active ? <button type="button" onClick={() => selectFolder("")}>Library</button> : <span>Library</span>}
            {active && <><Icon name="chevron" size={14} /><span aria-current="page" title={active.name}>{active.name}</span></>}
          </nav>
          <div className="mobile-header">
            <button type="button" className="icon-button" aria-label="Open navigation" onClick={() => open("navigation")}><Icon name="menu" size={20} /></button>
            <Brand />
          </div>
          <button type="button" className="button primary save-reference" onClick={() => open("add")}><Icon name="add" size={18} /> Save reference</button>
        </div>

        <div className="workspace-content">
          <header className="workspace-header">
            <div className="workspace-title">
              <div className="heading-icon"><Icon name={active ? "folder" : "library"} size={25} /></div>
              <div>
                <h1>{active?.name || "All References"}</h1>
                <p>{active ? "References collected for this project." : "Your library of clips, edits, and ideas worth keeping."}</p>
              </div>
            </div>
            {active && <ItemActions label="Folder options" bordered items={[
              { label: "Rename folder", icon: "edit", select: () => open("renameFolder", active) },
              { label: "Delete folder", icon: "delete", destructive: true, select: () => open("deleteFolder", active) },
            ]} />}
          </header>

          {demo && (
            <p className="demo-banner" role="status">
              <span className="demo-indicator" aria-hidden="true" />
              <strong>Demo library</strong>
              <span>{demo.storageAvailable ? "Changes are saved in this browser." : "Browser storage is unavailable. Changes last until you leave or refresh."}</span>
              {demo.catalogUnavailable && <span>Sample references are temporarily unavailable.</span>}
            </p>
          )}

          <div className="library-toolbar">
            <div className="library-search" role="search">
              <Icon name="search" size={18} />
              <input ref={searchInput} type="search" aria-label="Search references" aria-keyshortcuts="Meta+K Control+K"
                placeholder="Search references…" value={query} onChange={(event) => setQuery(event.target.value)} />
              {query ? (
                <button type="button" className="icon-button" aria-label="Clear search" onClick={clearSearch}><Icon name="close" size={16} /></button>
              ) : <kbd aria-hidden="true">⌘ / Ctrl K</kbd>}
            </div>
            <p className="result-count" role="status">{referenceCount}</p>
          </div>

          {missingReference && <p className="notice library-preview-notice" role="status">That reference is no longer available.</p>}
          {visible.length ? (
            <section aria-label="Saved references" className="reference-grid">
              {visible.map((item) => (
                <ReferenceCard key={item.id} reference={item} assigned={assignedFolders.get(item.id)} open={open} selectFolder={selectFolder} />
              ))}
            </section>
          ) : (
            <section className="empty-state">
              <div className="empty-icon"><Icon name={search ? "search" : active ? "folder" : "link"} size={25} /></div>
              <h2>{search ? "No matching references" : active ? "This folder is empty" : "Save your first reference"}</h2>
              <p>{search ? "Try a different title, source, or folder name." : active ? "Save a link here or add an existing reference to this folder." : `Paste a link from ${referenceSources} to start your collection.`}</p>
              {search ? <button type="button" className="button secondary" onClick={clearSearch}>Clear search</button>
                : <button type="button" className="button primary" onClick={() => open("add")}><Icon name="add" size={17} /> Save reference</button>}
            </section>
          )}
        </div>
      </main>

      {dialog?.type === "add" && <AddReference action={actions.saveReference} folders={folders} activeFolder={active?.id} close={close} />}
      {dialog && dialog.type !== "add" && (
        <Dialog key={dialog.type} close={close} viewer={dialog.type === "view"}>
          {dialog.type === "navigation" && (
            <>
              <h2 id="dialog-title">Library navigation</h2>
              <LibraryNavigation {...navigationProps} />
              <Account email={email} demo={demo} />
            </>
          )}
          {dialog.type === "view" && <Viewer demo={Boolean(demo)} retry={actions.retryReference} analyze={analysisEnabled ? actions.analyzeReference : undefined}
            reference={reference} folders={assignedFolders.get(reference.id) || []} close={close}
            editFolders={() => setDialog({ type: "edit", item: reference, direct })} />}
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
