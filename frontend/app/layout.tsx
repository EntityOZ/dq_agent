import type { Metadata } from "next";
import { DM_Sans, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/lib/providers";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Vantax — SAP Data Quality Agent",
  description: "Analyse and improve SAP data quality for S/4HANA migration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <AuthProvider>
      <html lang="en">
        <body
          className={`${dmSans.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} font-sans antialiased`}
        >
          <Providers>
            {children}
            <Toaster richColors position="top-right" />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
