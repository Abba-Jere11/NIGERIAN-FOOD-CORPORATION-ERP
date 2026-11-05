'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

interface DraftVersionValue {
  rowVersion: number;
  /** Latest known version, readable inside async callbacks without re-rendering. */
  current: () => number;
  /** Records a newer version returned by the server. Older values are ignored. */
  advance: (rowVersion: number | undefined) => void;
}

const DraftVersionContext = createContext<DraftVersionValue | null>(null);

/**
 * Holds a draft's row version on the client. Autosave, attachments and submit
 * all change or check the version; reading it from server props alone goes
 * stale whenever a save lands before the page has re-rendered.
 */
export function DraftVersionProvider({ rowVersion, children }: { rowVersion: number; children: ReactNode }) {
  const [version, setVersion] = useState(rowVersion);
  const latest = useRef(rowVersion);

  const advance = useCallback((next: number | undefined) => {
    if (next === undefined || next <= latest.current) return;
    latest.current = next;
    setVersion(next);
  }, []);

  useEffect(() => {
    advance(rowVersion);
  }, [rowVersion, advance]);

  const current = useCallback(() => latest.current, []);
  const value = useMemo(() => ({ rowVersion: version, current, advance }), [version, current, advance]);

  return <DraftVersionContext.Provider value={value}>{children}</DraftVersionContext.Provider>;
}

export function useDraftVersion(): DraftVersionValue | null {
  return useContext(DraftVersionContext);
}

/** Hidden `rowVersion` field that follows the provider, falling back to the server value. */
export function DraftVersionInput({ fallback }: { fallback: number }) {
  const draft = useDraftVersion();
  return <input type="hidden" name="rowVersion" value={String(draft?.rowVersion ?? fallback)} />;
}
