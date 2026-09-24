# VoiceCraft 3D TTS Website

Static GitHub Pages-ready text-to-speech website.

## Included

- Responsive 3D/glass UI for desktop and mobile
- Browser/system TTS voice playback through the Web Speech API
- Voice search
- Play, pause, resume and stop
- Speed, pitch and volume controls
- TXT and Markdown import
- Natural MP3 voice library and MP3 generation through SpeechSter (`ahm7xmakki.com`)
- Long-text chunking
- In-page audio preview and MP3 download
- Light/dark theme
- Local preference storage
- Privacy page
- PWA manifest and lightweight service worker

## GitHub Pages upload

1. Create a new GitHub repository.
2. Extract this ZIP.
3. Upload the **contents** of the extracted folder to the repository root. `index.html` must be at the root.
4. Commit the files.
5. Open **Settings → Pages**.
6. Under **Build and deployment**, choose **Deploy from a branch**.
7. Select your main branch and `/ (root)`, then save.
8. Open the Pages URL after GitHub publishes the site.

No Node.js, build command, package manager, or server is required.

## Important MP3 note

Browser speech synthesis does not provide downloadable raw audio in normal Chromium websites. This project therefore uses a separate external TTS endpoint for MP3 generation. The UI asks for user consent before the first MP3 request and the privacy page discloses this behavior.

The current API base is defined at the top of `app.js`:

```js
const API_BASE = 'https://ahm7xmakki.com';
```

Review the provider's current terms, privacy policy, availability and CORS behavior before production deployment. If you switch providers, update `app.js`, `privacy.html`, and the consent message.

## Local testing

A service worker does not run from `file://`. For full PWA behavior, serve the folder over HTTP, for example:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

Live browser TTS can still be tested in modern Chrome/Edge. MP3 generation requires internet access to the external TTS endpoint.
