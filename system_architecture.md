# System Architecture

The extension is a two-context MV3 design: `page-hook.js` runs in the page world only to observe WhatsApp's media element lifecycle; `content.js` owns DOM detection, UI, queue scheduling and `chrome.storage.local`; `background.js` is the only code allowed to call the fixed localhost endpoint. The backend is FastAPI with a single transcription semaphore and a lazy `faster-whisper` model manager. Runtime secrets live only in ignored generated files (`extension/local-config.js` and `server/.local-token`).

Any WhatsApp selector change belongs in `extension/selectors.js`; do not spread CSS or generated class assumptions across the content script.

Transcription UI uses `data-direction` to align with the WhatsApp message side. `cache-policy.js` defines the seven-day text retention window; audio blobs are never written to storage.
