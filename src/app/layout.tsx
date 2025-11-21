/**
 * Component: Root Layout
 * Documentation: documentation/frontend/components.md
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ReadMeABook - Audiobook Library Management",
  description: "Self-hosted audiobook library management system with Plex integration",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/rmab_icon.ico", sizes: "any" },
      { url: "/rmab_icon.ico", type: "image/x-icon" },
    ],
    shortcut: "/rmab_icon.ico",
    apple: [
      { url: "/RMAB_1024x1024.png", sizes: "1024x1024", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ReadMeABook",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100`}
      >
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
