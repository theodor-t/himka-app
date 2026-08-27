import { ImageResponse } from "next/og";

export const alt = "ANGEL DETAILING - Система учета и управления";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const logoUrl = `${process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"}/angel-logo.webp`;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 82px",
        color: "#f4f4f5",
        background: "#0a0a0c",
        fontFamily: "Arial",
      }}
    >
      <img
        src={logoUrl}
        width="120"
        height="120"
        style={{ objectFit: "cover", borderRadius: 18 }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "18px",
          color: "#ff003c",
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "4px",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #ff003c",
            borderRadius: 12,
            fontSize: 30,
          }}
        >
          A
        </div>
        ANGEL DETAILING
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: "1px" }}>
          Система учета
        </div>
        <div style={{ color: "#94a3b8", fontSize: 30 }}>
          Клиенты · финансы · склад
        </div>
      </div>
      <div style={{ color: "#ff003c", fontSize: 24, fontWeight: 700 }}>
        angel-detailing
      </div>
    </div>,
    { ...size },
  );
}
