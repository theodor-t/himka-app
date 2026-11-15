import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSessionToken,
  getUserRole,
  passwordMatches,
  SESSION_COOKIE,
  sessionCookieOptions,
  verifySessionToken,
} from "../../lib/auth";

export async function GET() {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    const username = verifySessionToken(token);
    return NextResponse.json({ user: username, role: username ? getUserRole(username) : null });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  let credentials;
  try {
    credentials = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { username, password } = credentials || {};
  if (!["TUDOR", "DAN"].includes(username) || !passwordMatches(username, password)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  let role;
  try {
    role = getUserRole(username);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const response = NextResponse.json({ user: username, role });
  response.cookies.set(SESSION_COOKIE, createSessionToken(username), sessionCookieOptions());
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}
