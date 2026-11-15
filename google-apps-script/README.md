# Google Apps Script database

## Expired appointment windows

The API removes expired free windows during database reads and writes. To also
remove them while nobody has the CRM open, run `installWindowExpirationTrigger`
once from the Apps Script editor and authorize the time-driven trigger. It runs
`cleanupExpiredWindows` hourly. Re-running the installer does not create a
duplicate trigger.

Each removed window receives one `Система` entry in the `logs` collection.

## Smart notifications

The CRM refreshes rule-based notifications when an employee opens the app. To
keep monitoring while nobody is signed in, configure these Apps Script
**Script properties**:

- `NOTIFICATION_REFRESH_URL`: the deployed CRM URL followed by
  `/api/notifications/refresh`
- `NOTIFICATION_CRON_SECRET`: the same randomly generated secret configured as
  `NOTIFICATION_CRON_SECRET` in the CRM hosting environment

Run `installSmartNotificationTrigger` once and approve the time-driven trigger.
It calls the protected CRM endpoint hourly. The CRM uses verified database
facts for the rules and sends only anonymized metrics to Gemini for optional
explanations. If Gemini is unavailable, rule-based alerts remain available.
`mergeNotifications` updates only the notification collection under the script
lock, preserving concurrent edits to other CRM data and legacy read receipts.
Gemini requests are also globally limited to one every five minutes by the
Apps Script lock and Script Properties.

After changing `Code.gs`, update the deployed Apps Script web app version before
installing the trigger. Resolved notification records are retained for 180 days.

## Migrating legacy `AUTOSPA_DB` data

If the current script stores its database in the `AUTOSPA_DB` Script Property,
copy the updated `Code.gs` into that same Apps Script project and save it. Before
deploying, select `migrateLegacyAutospaDb` in the function list and run it once.
The function validates the legacy JSON and copies it into the configured
spreadsheet's `Database` sheet. It refuses to overwrite a non-empty `Database`
sheet and keeps `AUTOSPA_DB` unchanged as a backup. Review the execution log for
the migration result, then update the existing web app deployment to a new
version.

## Inspection photos

Vehicle inspection photos are kept in a private Google Drive folder; only file
metadata and IDs are stored in the database. Deploy the Apps Script web app again
after updating `Code.gs`, then authorize its Google Drive access when prompted.
The script creates a private `ANGEL DETAILING — Осмотры` folder automatically
and saves its ID in the `INSPECTION_FOLDER_ID` script property. If setting that
property manually, use a folder that is not shared.

The CRM accepts JPEG, PNG, and WebP images up to 5 MB each, with up to 10 photos
per inspection. File viewing and upload require an authenticated CRM session.

## AI chat history and attachments

AI chats are stored separately from the CRM's single-cell JSON database. The
Apps Script creates `AI Chat Conversations`, `AI Chat Messages`, and
`AI Chat Attachments` sheets on first use. Every record is scoped to the
authenticated CRM username; the Next.js API checks ownership when listing,
opening, renaming, deleting, or sending a message in a conversation.

Chat files are stored in a private Google Drive folder. The first upload creates
`ANGEL DETAILING — AI чаты` and stores its ID in the `AI_CHAT_FOLDER_ID` script
property. Images and PDFs are sent by the server to the configured Gemini model
as actual multimodal input; UTF-8 TXT and CSV contents are sent as text. The
supported formats are JPEG, PNG, WebP, PDF, TXT, and CSV; HEIC and DOCX are not
accepted. Limits are 3 MB per file, 3 files per message, and 6 MB combined per
message.

After changing `Code.gs`, update the deployed Apps Script web app version and
authorize Google Sheets and Drive access. Existing `API_KEY` and spreadsheet
settings remain in place; no additional secret is exposed to the browser. Chat
records and files remain until an employee deletes the conversation. Localhost
preview uses in-memory storage and is not a persistence test for production.
