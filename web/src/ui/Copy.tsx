import { useState } from 'react';

/** Copies text to the clipboard and says so for a moment. */
export function Copy({ text, label, className = 'btn btn--sm' }: { text: string; label: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}
