import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ThemeProvider } from "@/components/ui/theme-provider";
import { Noto_Sans_SC, Noto_Sans_JP } from "next/font/google";

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
const ccSymbols = localFont({
  src: "./fonts/CCSymbols.woff2",
  variable: "--font-cc-symbols",
});
const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  weight: "variable",
  preload: false,
});
const notoSansJP = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  weight: "variable",
  preload: false,
});

export const metadata: Metadata = {
  title: "Sticker sheet",
  description: "Eana’s sticker sheet",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://rsms.me/" />
        <link rel="stylesheet" href="https://rsms.me/inter/inter.css" />
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/cc-icons/1.2.1/css/cc-icons.min.css" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable} ${notoSansJP.variable} ${ccSymbols.variable} antialiased overflow-hidden h-dvh w-dvw`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
