import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const alt = "ANGEL DETAILING - Система учета и управления";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const runtime = "nodejs";

export default async function OpenGraphImage() {
  const logo = await readFile(
    path.join(process.cwd(), "public", "angel-logo-og.png"),
  );
  const logoSrc = `data:image/png;base64,${logo.toString("base64")}`;

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
        src={logoSrc}
        width="220"
        height="188"
        style={{ objectFit: "contain" }}
      />
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
