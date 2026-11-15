const GEMINI_FILES_HOST = "generativelanguage.googleapis.com";
const GEMINI_FILES_PATH = /^\/v1beta\/files\/[A-Za-z0-9_-]+$/;
const GEMINI_UPLOAD_PATH = /^\/upload\/v1beta\/files(?:\/.*)?$/;
const GEMINI_FILE_TTL_MS = 48 * 60 * 60 * 1000;

function assertGeminiFileUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Gemini returned an invalid file URI.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== GEMINI_FILES_HOST ||
    !GEMINI_FILES_PATH.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new Error("Gemini returned an invalid file URI.");
  }
  return url;
}

async function throwGeminiFileError(response, action) {
  const error = new Error(`Gemini file ${action} failed (${response.status}).`);
  error.status = response.status;
  throw error;
}

export async function uploadGeminiFile({
  apiKey,
  name,
  mimeType,
  data,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  if (!Buffer.isBuffer(data) || !data.length) throw new Error("Gemini file is empty.");

  const startUrl = new URL(`https://${GEMINI_FILES_HOST}/upload/v1beta/files`);
  const startResponse = await fetchImpl(startUrl, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: name } }),
  });
  if (!startResponse.ok) await throwGeminiFileError(startResponse, "upload start");

  const uploadUrl = startResponse.headers.get("x-goog-upload-url");
  let parsedUploadUrl;
  try {
    parsedUploadUrl = new URL(uploadUrl);
  } catch {
    throw new Error("Gemini did not return a valid upload URL.");
  }
  if (
    parsedUploadUrl.protocol !== "https:" ||
    parsedUploadUrl.hostname !== GEMINI_FILES_HOST ||
    !GEMINI_UPLOAD_PATH.test(parsedUploadUrl.pathname)
  ) {
    throw new Error("Gemini did not return a valid upload URL.");
  }

  const uploadResponse = await fetchImpl(parsedUploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
      "Content-Length": String(data.length),
      "Content-Type": mimeType,
    },
    body: data,
  });
  if (!uploadResponse.ok) await throwGeminiFileError(uploadResponse, "upload");

  let payload;
  try {
    payload = await uploadResponse.json();
  } catch {
    throw new Error("Gemini returned invalid file metadata.");
  }
  const file = payload?.file || payload;
  const uri = assertGeminiFileUri(file?.uri);
  const actualExpiry = Date.parse(file?.expirationTime || "");
  const expiresAt = Number.isFinite(actualExpiry) && actualExpiry > now
    ? new Date(actualExpiry).toISOString()
    : new Date(now + GEMINI_FILE_TTL_MS).toISOString();

  return {
    fileUri: uri.href,
    expiresAt,
  };
}

export async function deleteGeminiFile({ apiKey, fileUri, fetchImpl = fetch }) {
  if (!apiKey) throw new Error("Gemini API key is not configured.");
  const uri = assertGeminiFileUri(fileUri);
  const fileId = uri.pathname.slice("/v1beta/files/".length);
  const response = await fetchImpl(
    `https://${GEMINI_FILES_HOST}/v1beta/files/${fileId}`,
    {
      method: "DELETE",
      headers: { "x-goog-api-key": apiKey },
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    await throwGeminiFileError(response, "delete");
  }
}
