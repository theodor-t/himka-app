# Gemini caption generation

The video-description editor can generate a Russian caption and hashtags with
Gemini. Configure `GEMINI_API_KEY` as a server-side environment variable.
`GEMINI_MODEL` is optional and defaults to `gemini-3.5-flash-lite`. Never expose the
key through a `NEXT_PUBLIC_*` variable.
The generator supports Russian and Romanian captions. If a model returns HTTP
429 or 503, the server automatically retries once with the alternate Flash
model (`gemini-3.8-flash` or `gemini-3.5-flash-lite`). Each attempt is capped
at 18 seconds so the fallback can run within the serverless function limit.

The generation endpoint accepts only fixed service, tone, and format IDs. It
does not send customer records, vehicle identifiers, free-form descriptions, or
other CRM data to Gemini. The returned caption and hashtags are validated and
must still be reviewed and saved by an employee.

## ANGEL AI conversations

The CRM and General modes use the authenticated `/api/ai/business-advisor`
endpoint. General mode does not load CRM data. Conversations and messages are
stored in the dedicated Apps Script chat sheets, scoped to the signed-in
username. Attachment bytes are uploaded by the server to Gemini Files API;
Apps Script stores only their Gemini URI and expiry metadata. Gemini deletes
these files after 48 hours, and deleting a conversation also requests immediate
deletion. The app cannot download or preview the original after upload; history
shows the filename and expiry instead. Existing files from the former Drive
storage are not migrated and are unavailable to the chat.

General chat accepts JPEG, PNG, WebP, PDF, UTF-8 TXT, and CSV files. The server
validates file type and size, then sends Gemini file references as multimodal
input. It never sends a client-provided SQL query to the database. Deploy the
updated `google-apps-script/Code.gs` web app before using chat history or
attachments in production; localhost preview storage is in-memory only.

In CRM mode, ANGEL AI can prepare one create/update/delete proposal for a
collection the signed-in role may edit. It does not write until the user
confirms the preview; the server verifies the signature, role, and unchanged
target record again before saving. Update and delete requests require an exact
record ID. Gemini receives field names and aggregate evidence, not stored CRM
records.
