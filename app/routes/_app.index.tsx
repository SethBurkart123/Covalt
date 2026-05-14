import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import ChatPanel from "@/components/ChatPanel";
import { useChat } from "@/contexts/chat-context";
import { usePageTitle } from "@/contexts/page-title-context";

export const Route = createFileRoute("/_app/")({
  component: Home,
});

function Home() {
  const { chatTitle } = useChat();
  const { setTitle } = usePageTitle();

  useEffect(() => {
    setTitle(chatTitle);
  }, [chatTitle, setTitle]);

  return <ChatPanel />;
}
