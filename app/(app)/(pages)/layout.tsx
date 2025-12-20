import { Header } from "@/components/Header";

export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      <div className="w-full overflow-y-scroll">
        {children}
      </div>
    </>
  );
}