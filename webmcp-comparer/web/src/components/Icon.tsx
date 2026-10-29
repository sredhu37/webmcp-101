/**
 * The app's one icon set: authored 24px line icons, 1.75 stroke, round caps and joins.
 * Icons are decorative next to their text; give `label` only when an icon stands alone.
 */
const PATHS = {
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  play: <path d="M7.5 5.5l11 6.5-11 6.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  upload: <path d="M12 16V5M7 9.5l5-5 5 5M5 20h14" />,
  open: <path d="M9 6h9v9M18 6L7 17" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5l8.5 15h-17z" />
      <path d="M12 10v4M12 16.75v.25" />
    </>
  ),
  retry: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
