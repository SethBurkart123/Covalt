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
  rightOffset: number;
  setRightOffset: (value: number) => void;
}

const PageTitleContext = createContext<PageTitleContextType | undefined>(undefined);

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState("");
  const [leftContent, setLeftContent] = useState<ReactNode | null>(null);
  const [rightContent, setRightContent] = useState<ReactNode | null>(null);
  const [floating, setFloating] = useState(false);
  const [rightOffset, setRightOffset] = useState(0);
  const value = useMemo(
    () => ({ title, setTitle, leftContent, setLeftContent, rightContent, setRightContent, floating, setFloating, rightOffset, setRightOffset }),
    [title, leftContent, rightContent, floating, rightOffset]
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
