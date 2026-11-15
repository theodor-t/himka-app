import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getUserRole, SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import {
  databaseForRoleWrite,
  readableDatabaseForRole,
} from "../../lib/access-control.mjs";
import {
  getLocalPreviewDatabase,
  isLocalPreviewRequest,
  setLocalPreviewDatabase,
} from "../../lib/local-preview.mjs";
import { normalizeDatabase } from "../../lib/database.mjs";

const getConfig = () => {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google database is not configured");
  return { scriptUrl, apiKey };
};

const forwardResponse = async (response) => {
  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json(
      {
        error: `Google returned a non-JSON response (${response.status})`,
        details: body.slice(0, 300),
      },
      { status: 502 },
    );
  }
  const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
  return NextResponse.json(payload, { status });
};

export async function GET(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = getUserRole(username);
    if (isLocalPreviewRequest(request)) {
      return NextResponse.json(
        readableDatabaseForRole(getLocalPreviewDatabase(), role),
        {
          headers: {
            "Cache-Control": "no-store",
            "X-Database-Mode": "local-preview",
          },
        },
      );
    }
    const { scriptUrl, apiKey } = getConfig();
    const url = new URL(scriptUrl);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url, { cache: "no-store", redirect: "follow" });
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return NextResponse.json(
        { error: `Google returned a non-JSON response (${response.status})`, details: body.slice(0, 300) },
        { status: 502 },
      );
    }
    const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
    return status >= 400
      ? NextResponse.json(payload, { status })
      : NextResponse.json(readableDatabaseForRole(payload, role));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const role = getUserRole(username);
    if (isLocalPreviewRequest(request)) {
      let incoming;
      try {
        incoming = normalizeDatabase(await request.json());
      } catch {
        return NextResponse.json({ error: "Invalid database payload" }, { status: 400 });
      }
      const current = getLocalPreviewDatabase();
      const update = databaseForRoleWrite(current, incoming, role);
      if (update.forbidden.length) {
        return NextResponse.json(
          { error: `Недостаточно прав для изменения данных: ${update.forbidden.join(", ")}` },
          { status: 403 },
        );
      }
      const database = setLocalPreviewDatabase(update.database);
      return NextResponse.json(readableDatabaseForRole(database, role), {
        headers: {
          "Cache-Control": "no-store",
          "X-Database-Mode": "local-preview",
        },
      });
    }
    const { scriptUrl, apiKey } = getConfig();
    const url = new URL(scriptUrl);
    url.searchParams.set("key", apiKey);
    const currentResponse = await fetch(url, { cache: "no-store", redirect: "follow" });
    const currentBody = await currentResponse.text();
    let current;
    try {
      current = JSON.parse(currentBody);
    } catch {
      return NextResponse.json(
        { error: `Google returned a non-JSON response (${currentResponse.status})`, details: currentBody.slice(0, 300) },
        { status: 502 },
      );
    }
    const currentStatus = current.status >= 400 || current.error ? current.status || 502 : 200;
    if (currentStatus >= 400) return NextResponse.json(current, { status: currentStatus });

    let incoming;
    try {
      incoming = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid database payload" }, { status: 400 });
    }
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return NextResponse.json({ error: "Invalid database payload" }, { status: 400 });
    }
    const update = databaseForRoleWrite(current, incoming, role);
    if (update.forbidden.length) {
      return NextResponse.json(
        { error: `Недостаточно прав для изменения данных: ${update.forbidden.join(", ")}` },
        { status: 403 },
      );
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(update.database),
      redirect: "follow",
    });
    return forwardResponse(response);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
