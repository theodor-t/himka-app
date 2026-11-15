import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserRole, SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import { roleCanWriteCollection } from "../../lib/access-control.mjs";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getAppsScriptUrl(action, values = {}) {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google file storage is not configured");
  const url = new URL(scriptUrl);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("action", action);
  Object.entries(values).forEach(([key, value]) => url.searchParams.set(key, value));
  return url;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Google file storage returned a non-JSON response (${response.status})`);
  }
}

function safeFileName(value) {
  return String(value || "")
    .replace(/[\\/:*?"<>|\r\n]/g, "_")
    .slice(0, 120);
}

function hasImageSignature(data, mimeType) {
  if (mimeType === "image/jpeg") {
    return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (mimeType === "image/webp") {
    return data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  }
  return false;
}

export async function GET(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) {
      return NextResponse.json({ error: "Invalid file ID" }, { status: 400 });
    }

    const response = await fetch(getAppsScriptUrl("getInspectionFile", { id }), {
      cache: "no-store",
      redirect: "follow",
    });
    const payload = await readJsonResponse(response);
    const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
    if (status >= 400) return NextResponse.json({ error: payload.error || "File unavailable" }, { status });
    if (!IMAGE_TYPES.has(payload.mimeType) || typeof payload.base64 !== "string") {
      return NextResponse.json({ error: "Unsupported file response" }, { status: 502 });
    }
    const data = Buffer.from(payload.base64, "base64");
    if (
      !data.length ||
      data.length > MAX_FILE_BYTES ||
      data.length !== Number(payload.size) ||
      !hasImageSignature(data, payload.mimeType)
    ) {
      return NextResponse.json({ error: "Invalid file response" }, { status: 502 });
    }

    return new Response(data, {
      headers: {
        "Content-Type": payload.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `inline; filename="${safeFileName(payload.name) || "inspection-photo"}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = getUserRole(username);
    if (!roleCanWriteCollection(role, "inspections")) {
      return NextResponse.json({ error: "Недостаточно прав для добавления фото осмотра" }, { status: 403 });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid file payload" }, { status: 400 });
    }
    if (
      !input ||
      typeof input !== "object" ||
      !IMAGE_TYPES.has(input.mimeType) ||
      typeof input.base64 !== "string" ||
      input.base64.length > Math.ceil(MAX_FILE_BYTES * 4 / 3) + 8 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64)
    ) {
      return NextResponse.json({ error: "Поддерживаются только JPEG, PNG и WebP до 5 МБ" }, { status: 400 });
    }

    const data = Buffer.from(input.base64, "base64");
    if (
      !data.length ||
      data.length > MAX_FILE_BYTES ||
      data.length !== Number(input.size) ||
      !hasImageSignature(data, input.mimeType)
    ) {
      return NextResponse.json({ error: "Размер или содержимое файла не прошли проверку" }, { status: 400 });
    }
    const response = await fetch(getAppsScriptUrl("uploadInspectionFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: safeFileName(input.name),
        mimeType: input.mimeType,
        size: data.length,
        base64: data.toString("base64"),
      }),
      redirect: "follow",
    });
    const payload = await readJsonResponse(response);
    const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
    return NextResponse.json(payload, { status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = getUserRole(username);
    if (!roleCanWriteCollection(role, "inspections")) {
      return NextResponse.json({ error: "Недостаточно прав для удаления временного файла" }, { status: 403 });
    }
    let input;
    try {
      input = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid cleanup request" }, { status: 400 });
    }
    const id = input?.id || "";
    const cleanupToken = input?.cleanupToken || "";
    if (!/^[A-Za-z0-9_-]{10,}$/.test(id) || !/^[A-Za-z0-9_-]{24,}$/.test(cleanupToken)) {
      return NextResponse.json({ error: "Invalid cleanup request" }, { status: 400 });
    }
    const response = await fetch(getAppsScriptUrl("deleteInspectionFile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, cleanupToken }),
      redirect: "follow",
    });
    const payload = await readJsonResponse(response);
    const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
    return NextResponse.json(payload, { status });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
