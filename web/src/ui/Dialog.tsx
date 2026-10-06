import { useEffect, useRef, type ReactNode } from 'react';

/** A modal panel; Escape or the backdrop closes it. */
export function Dialog({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog--wide' : ''}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="dialog__inner">
        <header className="dialog__head">
          <h2 className="subhead">{title}</h2>
          <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
