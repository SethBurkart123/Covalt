"use client";

import { useEffect } from "react";
import ChatPanel from "@/components/ChatPanel";
import { useChat } from "@/contexts/chat-context";
import { usePageTitle } from "@/contexts/page-title-context";

export default function Home() {
  const { chatTitle } = useChat();
  const { setTitle } = usePageTitle();

  useEffect(() => {
    setTitle(chatTitle);
  }, [chatTitle, setTitle]);

  return <ChatPanel />;
}
