import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ROLE_LABELS } from "./access-control.mjs";

export const SESSION_COOKIE = "angel-detailing-session";
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_ROLES = { TUDOR: "admin", DAN: "admin" };
const LOCAL_SESSION_SECRET = Symbol.for("angel-detailing.local-session-secret");

export const getUserRole = (username) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_ROLES, username)) return null;
  const role = process.env[`AUTH_${username}_ROLE`] || DEFAULT_ROLES[username];
  if (!Object.prototype.hasOwnProperty.call(ROLE_LABELS, role)) {
    throw new Error(`Invalid role configured for ${username}`);
  }
  return role;
};

const getSecret = () => {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "development") {
    if (!globalThis[LOCAL_SESSION_SECRET]) {
      globalThis[LOCAL_SESSION_SECRET] = randomBytes(32).toString("hex");
    }
    return globalThis[LOCAL_SESSION_SECRET];
  }
  if (!secret) throw new Error("AUTH_SESSION_SECRET is not configured");
  return secret;
};

const sign = (value) =>
  createHmac("sha256", getSecret()).update(value).digest("base64url");

export const createSessionToken = (username) => {
  const payload = Buffer.from(
    JSON.stringify({ username, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
};

export const verifySessionToken = (token) => {
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.exp > Math.floor(Date.now() / 1000) ? session.username : null;
  } catch {
    return null;
  }
};

export const passwordMatches = (username, password) => {
  const stored = process.env[`AUTH_${username}_PASSWORD_HASH`];
  if (!stored || typeof password !== "string") return false;
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, 32).toString("hex");
  return actual.length === expected.length && timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict",
  path: "/",
  maxAge: SESSION_TTL_SECONDS,
});

export const createPasswordHash = (password) => {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 32).toString("hex")}`;
};
