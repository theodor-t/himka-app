import "./globals.css";

export const metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ||
      "https://angel-detailing-nu.vercel.app/",
  ),
  title: {
    default: "ANGEL DETAILING | Учет",
    template: "%s | ANGEL DETAILING",
  },
  description:
    "Система учета и управления Angel Detailing: записи клиентов, финансы и склад.",
  keywords: [
    "Angel Detailing",
    "детейлинг",
    "учет детейлинга",
    "записи клиентов",
    "финансовый учет",
    "склад",
  ],
  authors: [{ name: "ANGEL DETAILING" }],
  creator: "ANGEL DETAILING",
  publisher: "ANGEL DETAILING",
  category: "business",
  alternates: { canonical: "/" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  applicationName: "ANGEL DETAILING",
  openGraph: {
    type: "website",
    locale: "ru_RU",
    siteName: "ANGEL DETAILING",
    title: "ANGEL DETAILING | Учет",
    description:
      "Система учета и управления Angel Detailing: записи клиентов, финансы и склад.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "ANGEL DETAILING - Система учета и управления",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "ANGEL DETAILING | Учет",
    description:
      "Система учета и управления Angel Detailing: записи клиентов, финансы и склад.",
    images: ["/opengraph-image"],
  },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg?v=2",
    apple: "/apple-icon.svg?v=2",
  },
  appleWebApp: {
    capable: true,
    title: "ANGEL DETAILING",
    statusBarStyle: "black-translucent",
  },
};

export const viewport = {
  themeColor: "#0a0a0c",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
