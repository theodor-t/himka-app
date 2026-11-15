import { cookies } from "next/headers";
import { getUserRole, SESSION_COOKIE, verifySessionToken } from "./auth";
import { roleCanViewPage } from "./access-control.mjs";

export async function requireAiChatUser() {
  const username = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!username) {
    const error = new Error("Unauthorized");
    error.status = 401;
    throw error;
  }
  const role = getUserRole(username);
  if (!role || !roleCanViewPage(role, "businessAdvisor")) {
    const error = new Error("Недостаточно прав для доступа к AI-чату.");
    error.status = 403;
    throw error;
  }
  return { username, role };
}

export function aiChatErrorResponse(error) {
  const status = Number(error?.status) || (error?.name === "TimeoutError" ? 504 : 500);
  return Response.json(
    { error: error instanceof Error ? error.message : "AI chat request failed." },
    { status },
  );
}
