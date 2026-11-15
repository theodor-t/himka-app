import { EMPTY_DB, normalizeDatabase } from "./database.mjs";

const LOCAL_DATABASE_KEY = Symbol.for("angel-detailing.local-preview-database");

export function isLocalPreviewRequest(request, environment = process.env.NODE_ENV) {
  if (environment !== "development") return false;

  const hostname = new URL(request.url).hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function getLocalPreviewDatabase() {
  if (!globalThis[LOCAL_DATABASE_KEY]) {
    globalThis[LOCAL_DATABASE_KEY] = structuredClone(EMPTY_DB);
  }
  return structuredClone(globalThis[LOCAL_DATABASE_KEY]);
}

export function setLocalPreviewDatabase(database) {
  const normalized = normalizeDatabase(database);
  globalThis[LOCAL_DATABASE_KEY] = structuredClone(normalized);
  return structuredClone(normalized);
}

export function resetLocalPreviewDatabase() {
  globalThis[LOCAL_DATABASE_KEY] = structuredClone(EMPTY_DB);
}
