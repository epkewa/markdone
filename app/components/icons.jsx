const paths = {
  add: <path d="M12 5v14M5 12h14" />,
  library: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />,
  link: <><path d="M10 13a3 3 0 0 0 4.24 0l4-4A3 3 0 0 0 14 4.76l-2 2"/><path d="M14 11a3 3 0 0 0-4.24 0l-4 4A3 3 0 0 0 10 19.24l2-2"/></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  external: <path d="M13 5h6v6m0-6-8 8m7 0v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />,
  play: <path d="M8 5.7a.7.7 0 0 1 1.1-.6l10 6.3a.7.7 0 0 1 0 1.2l-10 6.3a.7.7 0 0 1-1.1-.6Z" fill="currentColor" strokeWidth="0" />,
  logout: <path d="M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5m-1-8h10m-4-4 4 4-4 4" />,
  youtube: <><rect x="2.5" y="5" width="19" height="14" rx="4.5" fill="currentColor" stroke="none" /><path d="m10 9 5 3-5 3Z" fill="var(--logo-cutout, #e34843)" stroke="none" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></>,
  tiktok: <path d="M14.5 3v12.5a4.5 4.5 0 1 1-4.5-4.5v2.7a1.8 1.8 0 1 0 1.8 1.8V3Zm0 0c.4 2.6 2.1 4 4.7 4.4V10A7.8 7.8 0 0 1 14.5 8Z" fill="currentColor" stroke="none" />,
  pinterest: <><circle cx="12" cy="12" r="9.2" /><path d="m8.7 20.1 2.5-10.3m-.7 3.8c1.3 3.2 5.7 1.3 5.7-2.4 0-2.2-1.6-3.7-4-3.7-2.6 0-4.1 1.7-4.1 3.6 0 .8.3 1.4.6 1.8" /></>,
  x: <path d="M17.6 3h3l-6.5 7.5L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7-8L2 3h6.4l4.4 5.9ZM16.5 19h1.7L7.5 4.9H5.6Z" fill="currentColor" stroke="none" />,
};

export function Icon({ name, size = 20 }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
      Markdone<span className="brand-dot">.</span>
    </div>
  );
}
