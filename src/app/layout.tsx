import type { Metadata, Viewport } from "next";
import { Nunito, Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const nunito = Nunito({
  subsets: ["latin", "latin-ext"],
  variable: "--font-nunito",
  display: "swap",
});
// CJK font: Google serves it in unicode-range slices, so only glyphs on the page are downloaded.
const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sc",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.AUTH_URL ?? "http://localhost:3000"),
  title: { default: "HanziQuest — learn to write Chinese characters", template: "%s · HanziQuest" },
  description:
    "Learn to recognise, remember and write Chinese characters with stroke-order practice, handwriting feedback and spaced review.",
  applicationName: "HanziQuest",
  appleWebApp: { capable: true, title: "HanziQuest", statusBarStyle: "default" },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFF8E9" },
    { media: "(prefers-color-scheme: dark)", color: "#0D1F1C" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${nunito.variable} ${notoSansSc.variable}`}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
