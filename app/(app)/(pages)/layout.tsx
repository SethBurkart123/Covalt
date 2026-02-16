import { Header } from "@/components/Header";

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div className="w-full flex-1 min-h-0 flex flex-col overflow-y-auto">
        {children}
      </div>
    </>
  );
}