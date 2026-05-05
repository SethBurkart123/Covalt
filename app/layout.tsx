import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/contexts/theme-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Covalt",
  description: "Elegant",
};

const themeScript = `
(() => {
  try {
    const mode = localStorage.getItem("theme-mode");
    const isDark =
      mode === "dark" ||
      ((mode === "system" || !mode) && window.matchMedia("(prefers-color-scheme: dark)").matches);

    const root = document.documentElement;
    root.classList.toggle("dark", isDark);

    const raw = localStorage.getItem("theme-active-styles");
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const styles = parsed[isDark ? "dark" : "light"];
    if (!styles || typeof styles !== "object") return;

    for (const key in styles) {
      const value = styles[key];
      if (typeof value === "string" && value) {
        root.style.setProperty("--" + key, value);
      }
    }
  } catch {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <ThemeProvider>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
