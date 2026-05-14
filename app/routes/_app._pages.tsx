import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Header } from "@/components/Header";

export const Route = createFileRoute("/_app/_pages")({
  component: PagesLayout,
});

function PagesLayout() {
  return (
    <>
      <Header />
      <div className="w-full flex-1 min-h-0 flex flex-col overflow-y-auto">
        <Outlet />
      </div>
    </>
  );
}
