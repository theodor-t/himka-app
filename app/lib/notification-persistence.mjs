async function readResponse(response, operation) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Google returned a non-JSON response (${response.status})`);
  }
  if (!response.ok || payload.error || Number(payload.status) >= 400) {
    throw new Error(payload.error || `Google notification ${operation} failed (${response.status})`);
  }
  return payload;
}

export async function persistNotifications({
  url,
  apiKey,
  notifications,
  database,
  fetchImpl = fetch,
}) {
  const mergeUrl = new URL(url);
  mergeUrl.searchParams.set("action", "mergeNotifications");
  mergeUrl.searchParams.set("key", apiKey);

  try {
    const response = await fetchImpl(mergeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notifications }),
      redirect: "follow",
    });
    await readResponse(response, "save");
    return { compatibilityFallback: false };
  } catch (error) {
    if (!(error instanceof Error) || !/Invalid collection:\s*clients/i.test(error.message)) {
      throw error;
    }

    const saveUrl = new URL(url);
    saveUrl.searchParams.delete("action");
    saveUrl.searchParams.set("key", apiKey);
    const response = await fetchImpl(saveUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...database, notifications }),
      redirect: "follow",
    });
    await readResponse(response, "compatibility save");
    return { compatibilityFallback: true };
  }
}
