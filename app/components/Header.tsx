"use client";

import { usePageTitle } from "@/contexts/page-title-context";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";

export function Header() {
  const { title } = usePageTitle();
  return (
    <header className="z-10 flex shrink-0 items-center rounded-tr-2xl gap-2 p-4 sticky top-0 w-full">
      <SidebarTrigger />
      <Separator
        orientation="vertical"
        className="mr-2 data-[orientation=vertical]:h-4"
      />
      <h1 className="truncate text-lg font-medium">{title}</h1>
    </header>
  );
}