import { useEffect, useState, type RefObject } from 'react';

/** Whether an element is on screen (used to stop 3D views rendering when scrolled away). */
export function useOnScreen(ref: RefObject<Element>, margin = '0px', initial = false) {
  const [on, setOn] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin]);
  return on;
}
