# VoiceCraft Fast 3D TTS v2.0.1

A lightweight static TTS website for GitHub Pages.

## What changed
- No network/API request on page load.
- Natural MP3 voices are lazy-loaded only when the user opens MP3 mode and requests them.
- The natural voice list is cached in localStorage for 7 days.
- Changing a voice artist never calls the network.
- Voice preview is opt-in and only fetches when Preview is clicked.
- Natural MP3 generation uses ~900-character sentence-safe chunks and up to 8 parallel requests.
- HTTP 502 and timeout failures get one automatic retry.
- No service worker, avoiding stale GitHub Pages UI/code caches.
- Simpler responsive 3D interface with fewer DOM elements and no external fonts/libraries.

## GitHub Pages
1. Upload the contents of this folder to the repository root.
2. Keep `.nojekyll` in the root.
3. GitHub → Settings → Pages → Deploy from branch → main / root.
4. Hard refresh once after replacing an older build (Ctrl+F5).

## TTS architecture
- Listen mode: browser Web Speech API (`speechSynthesis`).
- MP3 mode: external REST endpoint at `https://ahm7xmakki.com/api/voices` and `/api/tts`.
- MP3 output is real `audio/mpeg` returned by the provider and merged client-side for long text.

## Important
GitHub Pages is static hosting. Natural MP3 availability still depends on the external provider and cross-origin access. Browser Listen mode remains usable if the MP3 service is unavailable.


## Long text fix (2.0.1)
Long MP3 jobs are split safely, generated with controlled concurrency/retries, validated as real MP3, and previewed chunk-by-chunk to avoid the browser 0:00 merged-file metadata problem. The downloadable file is rebuilt from cleaned MP3 frames.
