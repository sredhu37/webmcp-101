/** Display helpers; raw values stay untouched in state and requests. */

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Today 14:30", "Yesterday 17:45", "12 Oct 09:05", or with the year when it is not this one. */
export function formatRunDate(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  const clock = time.format(date);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  const day = date.getFullYear() === now.getFullYear() ? dayMonth : dayMonthYear;
  return `${day.format(date)} ${clock}`;
}

/** The Site URL without its scheme, e.g. `localhost:4000` or `shop.example.com/de`. */
export function siteLabel(siteUrl: string): string {
  try {
    const url = new URL(siteUrl);
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return `${url.host}${path}`;
  } catch {
    return siteUrl;
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Scrolls a section into view, without the smooth glide when reduced motion is asked for. */
export function scrollToSection(element: HTMLElement | null): void {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}
