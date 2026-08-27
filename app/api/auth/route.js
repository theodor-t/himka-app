import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  passwordMatches,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
} from "../../lib/auth";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const username = verifySessionToken(token);
  return NextResponse.json({ user: username });
}

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    if (!["TUDOR", "DAN"].includes(username) || !passwordMatches(username, password)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }
    const response = NextResponse.json({ user: username });
    response.cookies.set(SESSION_COOKIE, createSessionToken(username), sessionCookieOptions());
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
