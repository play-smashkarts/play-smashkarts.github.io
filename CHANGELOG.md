# Changelog

## 2.0.1
- Fixed long-text MP3 preview showing 0:00 / 0:00 after multi-chunk generation.
- Added chunk-by-chunk continuous preview for long speech.
- Added MP3 response validation so JSON/error payloads cannot be merged as audio.
- Added safer MP3 merge that removes per-chunk ID3/VBR headers before joining frames.
- Reduced generation concurrency from 8 to 4 for better stability on long text.
- Added retry/backoff for HTTP 429/500/502/503/504 and timeouts.
- Locks voice, pitch, and rate for the full generation job.

## 2.0.0
- Rebuilt UI for speed and simplicity.
- Removed automatic natural voice fetch on page load.
- Added 7-day voice-list cache.
- Voice selection now performs zero fetch requests.
- Added explicit preview button.
- Improved timeout/retry behavior.
- Changed MP3 chunk target to ~900 characters.
- Removed service worker to prevent stale cached builds on GitHub Pages.
