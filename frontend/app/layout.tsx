import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AuthProvider } from "@/lib/auth-provider";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "@/lib/providers";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
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
      <html lang="en" className="dark">
        <body className={`${inter.variable} font-sans antialiased`}>
          <Providers>
            {children}
            <Toaster richColors position="top-right" />
          </Providers>
        </body>
      </html>
    </AuthProvider>
  );
}
