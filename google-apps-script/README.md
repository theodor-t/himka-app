# Google Apps Script database

## Expired appointment windows

The API removes expired free windows during database reads and writes. To also
remove them while nobody has the CRM open, run `installWindowExpirationTrigger`
once from the Apps Script editor and authorize the time-driven trigger. It runs
`cleanupExpiredWindows` hourly. Re-running the installer does not create a
duplicate trigger.

Each removed window receives one `Система` entry in the `logs` collection.

## Inspection photos

Vehicle inspection photos are kept in a private Google Drive folder; only file
metadata and IDs are stored in the database. Deploy the Apps Script web app again
after updating `Code.gs`, then authorize its Google Drive access when prompted.
The script creates a private `ANGEL DETAILING — Осмотры` folder automatically
and saves its ID in the `INSPECTION_FOLDER_ID` script property. If setting that
property manually, use a folder that is not shared.

The CRM accepts JPEG, PNG, and WebP images up to 5 MB each, with up to 10 photos
per inspection. File viewing and upload require an authenticated CRM session.
