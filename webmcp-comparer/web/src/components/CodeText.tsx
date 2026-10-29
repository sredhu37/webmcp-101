import { Fragment } from 'react';

/** Renders server and parser messages, where `backticks` mark field names and values. */
export function CodeText({ text }: { text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? <code key={index}>{part}</code> : <Fragment key={index}>{part}</Fragment>,
      )}
    </>
  );
}
