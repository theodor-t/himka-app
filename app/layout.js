import "./globals.css";

export const metadata = {
  title: "ANGEL DETAILING | Учет",
  description: "Система учета и управления Angel Detailing",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.svg",
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
