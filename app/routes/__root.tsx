import { createRootRoute, Outlet } from "@tanstack/react-router";
import { ThemeProvider } from "@/contexts/theme-context";

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
