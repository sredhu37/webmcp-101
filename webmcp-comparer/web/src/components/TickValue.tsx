import { useState } from 'react';

export interface TickValueProps {
  text: string;
  className?: string;
  /** False for values that change all the time (a running clock), which should not flick. */
  tick?: boolean;
}

/**
 * A value that flicks once when it changes, so a changed number catches the eye. The first value
 * renders still; each change remounts the span, which replays the CSS `tick` animation.
 */
export function TickValue({ text, className, tick = true }: TickValueProps) {
  const [shown, setShown] = useState(text);
  const [changes, setChanges] = useState(0);
  if (text !== shown) {
    setShown(text);
    if (tick) setChanges(changes + 1);
  }
  return (
    <span key={changes} className={className} data-tick={changes > 0 ? '' : undefined}>
      {text}
    </span>
  );
}
