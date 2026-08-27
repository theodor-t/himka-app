import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";

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

export async function GET() {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { scriptUrl, apiKey } = getConfig();
    const url = new URL(scriptUrl);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url, { cache: "no-store", redirect: "follow" });
    return forwardResponse(response);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { scriptUrl, apiKey } = getConfig();
    const url = new URL(scriptUrl);
    url.searchParams.set("key", apiKey);
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: await request.text(),
      redirect: "follow",
    });
    return forwardResponse(response);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
