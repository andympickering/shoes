import type { Metadata } from "next";
import localFont from "next/font/local";
import { AuthLinkHandler } from "@/components/auth-link-handler";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "中国新闻档案 | Chinese News Archive",
  description: "Browse and filter scraped Chinese news articles",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AuthLinkHandler />
        {children}
      </body>
    </html>
  );
}
