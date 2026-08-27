import "./globals.css";

export const metadata = {
  title: "ANGEL DETAILING | Учет",
  description: "Система учета и управления Angel Detailing",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
