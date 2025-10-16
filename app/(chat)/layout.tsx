import { ChatProvider } from "@/contexts/chat-context";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <ChatProvider>{children}</ChatProvider>;
}