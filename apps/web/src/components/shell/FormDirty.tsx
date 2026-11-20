'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

const FormDirtyContext = createContext<{ dirty: boolean; setDirty: (value: boolean) => void }>({
  dirty: false,
  setDirty: () => undefined,
});

export function FormDirtyProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false);
  const value = useMemo(() => ({ dirty, setDirty }), [dirty]);
  return <FormDirtyContext.Provider value={value}>{children}</FormDirtyContext.Provider>;
}

export function useFormDirty(): boolean {
  return useContext(FormDirtyContext).dirty;
}

export function useSetFormDirty(): (value: boolean) => void {
  return useContext(FormDirtyContext).setDirty;
}
