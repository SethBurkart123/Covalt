"use client";

import React, { createContext, useContext, useMemo, useState } from "react";

type PageTitleContextType = {
  title: string;
  setTitle: (value: string) => void;
};

const PageTitleContext = createContext<PageTitleContextType | undefined>(
  undefined,
);

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState<string>("New Chat");

  const value = useMemo(() => ({ title, setTitle }), [title]);

  return (
    <PageTitleContext.Provider value={value}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle() {
  const ctx = useContext(PageTitleContext);
  if (!ctx)
    throw new Error("usePageTitle must be used within PageTitleProvider");
  return ctx;
}
