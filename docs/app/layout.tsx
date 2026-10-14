import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Provider } from "@/components/provider";

import "./global.css";

export const metadata: Metadata = {
  title: {
    default: "dmbridge",
    template: "%s · dmbridge",
  },
  description: "One CLI for direct messages across social platforms.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col font-sans">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
