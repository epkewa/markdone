"use client";

import { useEffect, useRef, useState } from "react";
import { demoFolders, demoReferences } from "../../scripts/demo-data.mjs";
import { parseLink } from "../../lib/references";
import { Library } from "../references/library";

const storageKey = "markdone.demo.v1";

function memberships(ids) {
  return [...new Set(ids)].map((folder_id) => ({ folder_id }));
}

function makeReference(link, id, folderIds, title = null) {
  return {
    id, platform: link.platform, post_id: link.id, kind: link.kind, url: link.url,
    title, folder_references: memberships(folderIds),
  };
}

const folders = demoFolders.map((name, index) => ({ id: `sample-folder-${index}`, name }));
const initial = {
  folders,
  references: demoReferences.map(({ url, title, folders: indices }, index) =>
    makeReference(parseLink(url), `sample-reference-${index}`, indices.map((id) => folders[id].id), title)
  ),
};

function readLibrary() {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  return Array.isArray(saved?.folders) && Array.isArray(saved?.references) ? saved : initial;
}

export function DemoLibrary() {
  const [library, setLibrary] = useState(initial);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const current = useRef(initial);

  useEffect(() => {
    try {
      current.current = readLibrary();
      setLibrary(current.current);
    } catch {
      setStorageAvailable(false);
    }
  }, []);

  function update(transform) {
    const next = transform(current.current);
    if (next.error) return next;
    current.current = next;
    setLibrary(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    return { ok: true };
  }

  const actions = {
    saveReference(_state, form) {
      const link = parseLink(form.get("url"));
      if (!link) return { error: "Paste a link to a YouTube, Instagram, TikTok, or X post." };
      const ids = form.getAll("folderIds");
      return update((state) => {
        const existing = state.references.find((item) => item.platform === link.platform &&
          (link.id ? item.post_id === link.id : item.url === link.url));
        const references = existing
          ? state.references.map((item) => item.id === existing.id
            ? { ...item, folder_references: memberships([...item.folder_references.map(({ folder_id }) => folder_id), ...ids]) }
            : item)
          : [makeReference(link, crypto.randomUUID(), ids), ...state.references];
        return { ...state, references };
      });
    },
    saveFolder(_state, form) {
      const name = String(form.get("name") ?? "").trim();
      const id = form.get("id") || crypto.randomUUID();
      if (!name || name.length > 60) return { error: "Enter a folder name up to 60 characters." };
      return update((state) => {
        if (state.folders.some((folder) => folder.id !== id && folder.name.toLowerCase() === name.toLowerCase())) {
          return { error: "A folder with this name already exists." };
        }
        const folders = [...state.folders.filter((folder) => folder.id !== id), { id, name }];
        folders.sort((left, right) => left.name.localeCompare(right.name));
        return { ...state, folders };
      });
    },
    editMemberships(_state, form) {
      const id = form.get("id");
      const folder_references = memberships(form.getAll("folderIds"));
      return update((state) => ({
        ...state,
        references: state.references.map((item) => item.id === id ? { ...item, folder_references } : item),
      }));
    },
    deleteReference(_state, form) {
      const id = form.get("id");
      return update((state) => ({ ...state, references: state.references.filter((item) => item.id !== id) }));
    },
    deleteFolder(_state, form) {
      const id = form.get("id");
      return update((state) => ({
        folders: state.folders.filter((folder) => folder.id !== id),
        references: state.references.map((item) => ({
          ...item,
          folder_references: item.folder_references.filter(({ folder_id }) => folder_id !== id),
        })),
      }));
    },
  };

  return <Library {...library} demo={{ storageAvailable }} actions={actions} />;
}
