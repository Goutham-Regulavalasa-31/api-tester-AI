import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "API Tester — DevIQ",
  description: "AI-powered scriptless API testing tool",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-900 text-slate-100">
        {children}
      </body>
    </html>
  );
}
