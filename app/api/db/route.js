import { NextResponse } from "next/server";

const getConfig = () => {
  const scriptUrl = process.env.GOOGLE_SCRIPT_URL;
  const apiKey = process.env.GOOGLE_SCRIPT_API_KEY;
  if (!scriptUrl || !apiKey) throw new Error("Google database is not configured");
  return { scriptUrl, apiKey };
};

const forwardResponse = async (response) => {
  const payload = await response.json();
  const status = payload.status >= 400 || payload.error ? payload.status || 502 : 200;
  return NextResponse.json(payload, { status });
};

export async function GET() {
  try {
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
