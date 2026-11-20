import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Toaster as SonnerToaster } from "sonner";
import { Toaster } from "@/components/ui/toaster";
import { AppProvider } from "@/db/provider";
import { AuthGuard } from "@/components/AuthGuard";


export const metadata: Metadata = {
  title: "Hausmeister Pro",
  description: "Internes Betriebsführungssystem",
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
      "max-video-preview": -1,
      "max-image-preview": "none",
      "max-snippet": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <AppProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthGuard>
              {children}
            </AuthGuard>
            {/* Die App nutzt useToast (shadcn) – ohne diesen Toaster bleiben alle Meldungen unsichtbar. */}
            <Toaster />
            <SonnerToaster richColors />
          </ThemeProvider>
        </AppProvider>
      </body>
    </html>
  );
}
