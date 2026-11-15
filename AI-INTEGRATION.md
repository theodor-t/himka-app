# Gemini caption generation

The video-description editor can generate a Russian caption and hashtags with
Gemini. Configure `GEMINI_API_KEY` as a server-side environment variable.
`GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`. Never expose the
key through a `NEXT_PUBLIC_*` variable.

The generation endpoint accepts only fixed service, tone, and format IDs. It
does not send customer records, vehicle identifiers, free-form descriptions, or
other CRM data to Gemini. The returned caption and hashtags are validated and
must still be reviewed and saved by an employee.
