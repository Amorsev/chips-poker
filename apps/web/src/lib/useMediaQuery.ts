import { useEffect, useState } from 'react';

/** Tracks a CSS media query, e.g. the compact (phone) layout breakpoint. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false
  );

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

/** Phones in portrait (narrow) or landscape (short). Keep in sync with styles.css. */
export const COMPACT_QUERY = '(max-width: 760px), (max-height: 520px)';
