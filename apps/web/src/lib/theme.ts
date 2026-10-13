import { useCallback, useEffect, useState } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 'waylo.theme';

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function apply(pref: ThemePref) {
  const el = document.documentElement;
  if (pref === 'system') delete el.dataset.theme;
  else el.dataset.theme = pref;
}

export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => apply(pref), [pref]);
  const set = useCallback((p: ThemePref) => {
    try {
      if (p === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, p);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
    setPref(p);
  }, []);
  return { pref, set, resolved: resolvedTheme(pref) };
}
