"use client";

import { useEffect, useRef, useState } from "react";
import { demoFolders } from "../../lib/demo-folders";
import { parseLink, referenceSources } from "../../lib/references";
import { Library } from "../references/library";
import { resolveDemoPin } from "./resolve-pin";

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

const folders = demoFolders.map(({ id, name }) => ({ id, name }));

function referenceKey(reference) {
  return `${reference.platform}:${reference.post_id ?? reference.url}`;
}

function readLibrary(catalog) {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (!Array.isArray(saved?.folders) || !Array.isArray(saved?.references)) {
    return { folders, references: catalog ?? [] };
  }
  if (catalog === null) return saved;

  const seen = new Set(saved.seenCatalogIds ?? []);
  const catalogIds = new Set(catalog.map(({ id }) => id));
  const references = saved.references.filter(({ id }) =>
    !id.startsWith("sample-reference-") && (!seen.has(id) || catalogIds.has(id))
  );
  const savedKeys = new Set(references.map(referenceKey));
  const folderIds = new Set(saved.folders.map(({ id }) => id));
  const additions = catalog.filter((reference) => !seen.has(reference.id) && !savedKeys.has(referenceKey(reference)))
    .map((reference) => ({
      ...reference,
      folder_references: reference.folder_references.filter(({ folder_id }) => folderIds.has(folder_id)),
    }));

  return { folders: saved.folders, references: [...references, ...additions] };
}

function currentSeenIds() {
  return JSON.parse(localStorage.getItem(storageKey))?.seenCatalogIds ?? [];
}

export function DemoLibrary({ catalog }) {
  const [library, setLibrary] = useState(() => ({ folders, references: catalog ?? [] }));
  const [storageAvailable, setStorageAvailable] = useState(true);
  const current = useRef(library);

  useEffect(() => {
    try {
      current.current = readLibrary(catalog);
      setLibrary(current.current);
    } catch {
      setStorageAvailable(false);
    }
  }, [catalog]);

  function update(transform) {
    const next = transform(current.current);
    if (next.error) return next;
    current.current = next;
    setLibrary(next);
    try {
      const seenCatalogIds = catalog?.map(({ id }) => id) ?? currentSeenIds();
      localStorage.setItem(storageKey, JSON.stringify({ ...next, seenCatalogIds }));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    return { ok: true };
  }

  const actions = {
    async saveReference(_state, form) {
      let link = parseLink(form.get("url"));
      if (!link) return { error: `Paste a link to a post from ${referenceSources}.` };
      if (link.platform === "pinterest" && !link.id) {
        link = await resolveDemoPin(link.url).catch(() => null) || link;
      }
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

  return <Library {...library} demo={{ storageAvailable, catalogUnavailable: catalog === null }} actions={actions} />;
}
