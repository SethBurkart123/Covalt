"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

interface PageTitleContextType {
  title: string;
  setTitle: (value: string) => void;
  leftContent: ReactNode | null;
  setLeftContent: (content: ReactNode | null) => void;
  rightContent: ReactNode | null;
  setRightContent: (content: ReactNode | null) => void;
  floating: boolean;
  setFloating: (value: boolean) => void;
}

const PageTitleContext = createContext<PageTitleContextType | undefined>(undefined);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState("");
  const [leftContent, setLeftContent] = useState<ReactNode | null>(null);
  const [rightContent, setRightContent] = useState<ReactNode | null>(null);
  const [floating, setFloating] = useState(false);
  const value = useMemo(
    () => ({ title, setTitle, leftContent, setLeftContent, rightContent, setRightContent, floating, setFloating }),
    [title, leftContent, rightContent, floating]
  );

  return (
    <PageTitleContext.Provider value={value}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx) throw new Error("usePageTitle must be used within PageTitleProvider");
  return ctx;
}
