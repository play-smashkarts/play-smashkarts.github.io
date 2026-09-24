const API_BASE = 'https://ahm7xmakki.com';
const MAX_CHUNK = 1850;

const $ = (s) => document.querySelector(s);
const els = {
  text: $('#textInput'), chars: $('#charCount'), words: $('#wordCount'), detected: $('#detectedLang'),
  browserVoice: $('#browserVoice'), voiceSearch: $('#voiceSearch'), voiceMeta: $('#browserVoiceMeta'),
  speed: $('#speedRange'), pitch: $('#pitchRange'), volume: $('#volumeRange'),
  speedValue: $('#speedValue'), pitchValue: $('#pitchValue'), volumeValue: $('#volumeValue'),
  speechProgress: $('#speechProgress'), status: $('#globalStatus'), toast: $('#toast'),
  downloadVoice: $('#downloadVoice'), downloadSearch: $('#downloadVoiceSearch'), downloadMeta: $('#downloadVoiceMeta'),
  generationWrap: $('#generationWrap'), generationLabel: $('#generationLabel'), generationPercent: $('#generationPercent'), generationProgress: $('#generationProgress'),
  audioResult: $('#audioResult'), audioPlayer: $('#audioPlayer'), resultTitle: $('#resultTitle'), resultMeta: $('#resultMeta'),
  generateMp3: $('#generateMp3'), downloadMp3: $('#downloadMp3'), consent: $('#consentDialog')
};

let browserVoices = [];
let naturalVoices = [];
let utterance = null;
let speechChunks = [];
let speechChunkIndex = 0;
let speechRunId = 0;
let currentAudioBlob = null;
let currentAudioUrl = null;
let currentFilename = '';
let progressTimer = null;
let speechStartedAt = 0;
let speechEstimatedMs = 0;

const prefs = {
  get(key, fallback = null) { try { const v = localStorage.getItem(`voicecraft_${key}`); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`voicecraft_${key}`, JSON.stringify(value)); } catch {} }
};

function toast(message, error = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', error);
  els.toast.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function setStatus(text, kind = 'ready') {
  els.status.querySelector('span:last-child').textContent = text;
  const dot = els.status.querySelector('.status-dot');
  dot.style.background = kind === 'error' ? '#ff718d' : kind === 'busy' ? '#ffd071' : '#4de2d0';
}

function countText() {
  const value = els.text.value;
  els.chars.textContent = value.length.toLocaleString();
  const words = value.trim() ? value.trim().split(/\s+/u).length : 0;
  els.words.textContent = words.toLocaleString();
  els.detected.textContent = `Language: ${detectLanguage(value)}`;
}

function detectLanguage(text) {
  const sample = text.slice(0, 1500);
  if (!sample.trim()) return 'Auto';
  if (/[\u0600-\u06FF]/.test(sample)) return 'Urdu / Arabic';
  if (/[\u0900-\u097F]/.test(sample)) return 'Hindi';
  if (/[\u3040-\u30FF]/.test(sample)) return 'Japanese';
  if (/[\uAC00-\uD7AF]/.test(sample)) return 'Korean';
  if (/[\u4E00-\u9FFF]/.test(sample)) return 'Chinese';
  return 'Auto / Latin';
}

function getSpeechText() {
  const text = els.text.value.replace(/\s+/g, ' ').trim();
  if (!text) throw new Error('Paste, type, or import some text first.');
  return text;
}

function loadBrowserVoices() {
  if (!('speechSynthesis' in window)) {
    els.browserVoice.innerHTML = '<option value="">Speech synthesis unavailable</option>';
    els.voiceMeta.textContent = 'This browser does not expose the Web Speech API.';
    return;
  }
  browserVoices = speechSynthesis.getVoices().slice().sort((a, b) => `${a.lang} ${a.name}`.localeCompare(`${b.lang} ${b.name}`));
  populateBrowserVoices();
}

function populateBrowserVoices() {
  const q = els.voiceSearch.value.trim().toLowerCase();
  const current = prefs.get('browserVoice', '') || els.browserVoice.value;
  const filtered = browserVoices.filter(v => !q || `${v.name} ${v.lang}`.toLowerCase().includes(q));
  els.browserVoice.textContent = '';
  if (!filtered.length) {
    const opt = new Option(browserVoices.length ? 'No matching voices' : 'No browser voices available', '');
    els.browserVoice.add(opt);
    return;
  }
  const groups = new Map();
  filtered.forEach(v => {
    const language = v.lang || 'Other';
    if (!groups.has(language)) groups.set(language, []);
    groups.get(language).push(v);
  });
  for (const [lang, voices] of groups) {
    const group = document.createElement('optgroup');
    group.label = lang;
    voices.forEach(v => {
      const opt = new Option(`${v.name}${v.localService ? ' · Local' : ''}`, v.name);
      opt.dataset.lang = v.lang;
      group.append(opt);
    });
    els.browserVoice.append(group);
  }
  if ([...els.browserVoice.options].some(o => o.value === current)) els.browserVoice.value = current;
  updateBrowserVoiceMeta();
}

function updateBrowserVoiceMeta() {
  const voice = browserVoices.find(v => v.name === els.browserVoice.value);
  if (!voice) { els.voiceMeta.textContent = 'Choose a browser voice.'; return; }
  els.voiceMeta.textContent = `${voice.lang || 'Unknown locale'} · ${voice.localService ? 'Local/system' : 'Browser/provider voice'}`;
  prefs.set('browserVoice', voice.name);
}

function updateRangeLabels() {
  els.speedValue.value = `${Number(els.speed.value).toFixed(2)}×`;
  els.pitchValue.value = Number(els.pitch.value).toFixed(2);
  els.volumeValue.value = `${Math.round(Number(els.volume.value) * 100)}%`;
  prefs.set('speed', Number(els.speed.value)); prefs.set('pitch', Number(els.pitch.value)); prefs.set('volume', Number(els.volume.value));
}

function resetSpeechProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  els.speechProgress.style.width = '0%';
}

function chunkForBrowserSpeech(text, maxLen = 260) {
  return splitText(text, maxLen);
}

function updateSpeechProgress() {
  const total = Math.max(1, speechChunks.length);
  const pct = Math.min(100, (speechChunkIndex / total) * 100);
  els.speechProgress.style.width = `${pct}%`;
}

function speakBrowserChunk(runId) {
  if (runId !== speechRunId || speechChunkIndex >= speechChunks.length) {
    if (runId === speechRunId) {
      els.speechProgress.style.width = '100%';
      setStatus('Ready');
      setTimeout(resetSpeechProgress, 650);
    }
    return;
  }
  const chunk = speechChunks[speechChunkIndex];
  utterance = new SpeechSynthesisUtterance(chunk);
  const voice = browserVoices.find(v => v.name === els.browserVoice.value);
  if (voice) { utterance.voice = voice; utterance.lang = voice.lang; }
  utterance.rate = Number(els.speed.value);
  utterance.pitch = Number(els.pitch.value);
  utterance.volume = Number(els.volume.value);
  utterance.onstart = () => { if (runId === speechRunId) setStatus(`Speaking ${speechChunkIndex + 1}/${speechChunks.length}`, 'busy'); };
  utterance.onend = () => {
    if (runId !== speechRunId) return;
    speechChunkIndex++;
    updateSpeechProgress();
    speakBrowserChunk(runId);
  };
  utterance.onerror = event => {
    if (runId !== speechRunId) return;
    if (event.error !== 'canceled' && event.error !== 'interrupted') toast(`Playback error: ${event.error || 'unknown error'}`, true);
    setStatus('Ready');
    resetSpeechProgress();
  };
  speechSynthesis.speak(utterance);
}

function playSpeech() {
  try {
    const text = getSpeechText();
    if (!('speechSynthesis' in window)) throw new Error('Speech synthesis is not supported by this browser.');
    speechRunId++;
    speechSynthesis.cancel();
    speechChunks = chunkForBrowserSpeech(text);
    speechChunkIndex = 0;
    resetSpeechProgress();
    updateSpeechProgress();
    speakBrowserChunk(speechRunId);
  } catch (e) { toast(e.message, true); setStatus('Error', 'error'); }
}

function pauseSpeech() {
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
    setStatus('Paused');
  }
}
function resumeSpeech() {
  if (speechSynthesis.paused) {
    speechSynthesis.resume();
    setStatus(`Speaking ${Math.min(speechChunkIndex + 1, speechChunks.length)}/${speechChunks.length}`, 'busy');
  }
}
function stopSpeech() {
  speechRunId++;
  speechSynthesis.cancel();
  utterance = null;
  speechChunks = [];
  speechChunkIndex = 0;
  resetSpeechProgress();
  setStatus('Ready');
}

function splitText(text, maxLen = MAX_CHUNK) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu) || [clean];
  const chunks = [];
  let current = '';
  const push = () => { if (current.trim()) chunks.push(current.trim()); current = ''; };
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= maxLen) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length <= maxLen) current = next;
      else { push(); current = sentence; }
      continue;
    }
    push();
    const words = sentence.split(/\s+/);
    let part = '';
    for (const word of words) {
      const next = part ? `${part} ${word}` : word;
      if (next.length <= maxLen) part = next;
      else {
        if (part) chunks.push(part);
        if (word.length > maxLen) {
          for (let i = 0; i < word.length; i += maxLen) chunks.push(word.slice(i, i + maxLen));
          part = '';
        } else part = word;
      }
    }
    if (part) chunks.push(part);
  }
  push();
  return chunks;
}

async function loadNaturalVoices(force = false) {
  if (naturalVoices.length && !force) return;
  els.downloadMeta.textContent = 'Loading natural voices…';
  els.downloadVoice.innerHTML = '<option value="">Loading…</option>';
  try {
    const response = await fetch(`${API_BASE}/api/voices`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Voice service returned HTTP ${response.status}.`);
    const data = await response.json();
    if (!data?.success || !Array.isArray(data.voices)) throw new Error('Voice service returned an invalid list.');
    naturalVoices = data.voices.map(v => ({
      index: Number(v.index), id: String(v.id || ''), name: String(v.name || `Voice ${v.index}`),
      gender: String(v.gender || ''), language: String(v.language || 'Unknown'), country: String(v.country || '')
    })).filter(v => Number.isFinite(v.index));
    populateNaturalVoices();
    toast(`${naturalVoices.length} natural voices loaded.`);
  } catch (e) {
    naturalVoices = [];
    els.downloadVoice.innerHTML = '<option value="">Natural voices unavailable</option>';
    els.downloadMeta.textContent = 'Could not reach the MP3 voice service. Check internet access/CORS and try again.';
    toast(e.message || 'Could not load natural voices.', true);
  }
}

function populateNaturalVoices() {
  const q = els.downloadSearch.value.trim().toLowerCase();
  const previous = String(prefs.get('naturalVoice', '') || els.downloadVoice.value || '');
  const filtered = naturalVoices.filter(v => !q || `${v.name} ${v.language} ${v.country} ${v.gender}`.toLowerCase().includes(q));
  els.downloadVoice.textContent = '';
  if (!filtered.length) {
    els.downloadVoice.add(new Option(naturalVoices.length ? 'No matching voices' : 'Natural voices unavailable', ''));
    els.downloadMeta.textContent = naturalVoices.length ? 'Try another search.' : 'Load the voice list again.';
    return;
  }
  const groups = new Map();
  filtered.forEach(v => { if (!groups.has(v.language)) groups.set(v.language, []); groups.get(v.language).push(v); });
  for (const [language, voices] of groups) {
    const group = document.createElement('optgroup'); group.label = language;
    voices.forEach(v => group.append(new Option(`${v.name}${v.country ? ` · ${v.country}` : ''}${v.gender ? ` · ${v.gender}` : ''}`, String(v.index))));
    els.downloadVoice.append(group);
  }
  if ([...els.downloadVoice.options].some(o => o.value === previous)) els.downloadVoice.value = previous;
  else els.downloadVoice.selectedIndex = 0;
  updateNaturalVoiceMeta();
}

function updateNaturalVoiceMeta() {
  const voice = naturalVoices.find(v => String(v.index) === els.downloadVoice.value);
  if (!voice) { els.downloadMeta.textContent = 'Choose a natural MP3 voice.'; return; }
  els.downloadMeta.textContent = `${voice.name} · ${voice.language}${voice.country ? ` · ${voice.country}` : ''}${voice.gender ? ` · ${voice.gender}` : ''}`;
  prefs.set('naturalVoice', String(voice.index));
}

function providerValue(value) {
  const n = Number(value);
  return Math.max(-100, Math.min(100, Math.round((n - 1) * 100)));
}

async function synthesizeChunk(text, voiceIndex, pitch, rate) {
  const response = await fetch(`${API_BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ voiceIndex: Number(voiceIndex), text, pitch: providerValue(pitch), rate: providerValue(rate) })
  });
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 180); } catch {}
    throw new Error(`MP3 synthesis failed (${response.status})${detail ? `: ${detail}` : ''}`);
  }
  const type = (response.headers.get('content-type') || '').toLowerCase();
  const blob = await response.blob();
  if (!blob.size || (!type.includes('audio') && blob.type && !blob.type.includes('audio'))) throw new Error('The TTS service did not return valid audio.');
  return blob;
}

function requestConsent() {
  if (prefs.get('mp3Consent', false)) return Promise.resolve(true);
  return new Promise(resolve => {
    const dialog = els.consent;
    const handler = () => {
      dialog.removeEventListener('close', handler);
      const approved = dialog.returnValue === 'default';
      if (approved && $('#rememberConsent').checked) prefs.set('mp3Consent', true);
      resolve(approved);
    };
    dialog.addEventListener('close', handler);
    dialog.showModal();
  });
}

function setGenerationProgress(done, total) {
  const percent = total ? Math.round((done / total) * 100) : 0;
  els.generationWrap.hidden = false;
  els.generationLabel.textContent = done >= total ? 'Finalizing MP3…' : `Generating chunk ${done + 1} of ${total}…`;
  els.generationPercent.textContent = `${percent}%`;
  els.generationProgress.style.width = `${percent}%`;
}

function makeFilename() {
  const d = new Date(); const p = n => String(n).padStart(2, '0');
  return `tts-audio-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.mp3`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function generateMp3() {
  try {
    const text = getSpeechText();
    if (!naturalVoices.length) await loadNaturalVoices();
    const voice = naturalVoices.find(v => String(v.index) === els.downloadVoice.value);
    if (!voice) throw new Error('Choose a natural MP3 voice first.');
    if (!(await requestConsent())) return;

    els.generateMp3.disabled = true;
    els.downloadMp3.disabled = true;
    setStatus('Generating MP3', 'busy');
    const chunks = splitText(text);
    if (!chunks.length) throw new Error('No valid text to synthesize.');
    setGenerationProgress(0, chunks.length);

    const results = new Array(chunks.length);
    let cursor = 0, completed = 0;
    const concurrency = Math.min(4, chunks.length);
    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= chunks.length) return;
        results[index] = await synthesizeChunk(chunks[index], voice.index, els.pitch.value, els.speed.value);
        completed++;
        setGenerationProgress(completed, chunks.length);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    currentAudioBlob = new Blob(results, { type: 'audio/mpeg' });
    currentFilename = makeFilename();
    if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = URL.createObjectURL(currentAudioBlob);
    els.audioPlayer.src = currentAudioUrl;
    els.audioResult.hidden = false;
    els.resultTitle.textContent = currentFilename;
    els.resultMeta.textContent = `${voice.name} · ${voice.language} · ${formatBytes(currentAudioBlob.size)}`;
    els.downloadMp3.disabled = false;
    setStatus('MP3 ready');
    els.generationLabel.textContent = 'MP3 ready';
    els.generationPercent.textContent = '100%';
    toast('Natural MP3 generated successfully.');
  } catch (e) {
    setStatus('Error', 'error');
    toast(e.message || 'Could not generate MP3.', true);
    els.generationWrap.hidden = true;
  } finally {
    els.generateMp3.disabled = false;
  }
}

function downloadCurrentMp3() {
  if (!currentAudioBlob || !currentAudioUrl) return toast('Generate an MP3 first.', true);
  const link = document.createElement('a');
  link.href = currentAudioUrl; link.download = currentFilename || makeFilename();
  document.body.append(link); link.click(); link.remove();
  toast('MP3 download started.');
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  prefs.set('theme', theme);
}

function initTheme() {
  const stored = prefs.get('theme', '');
  const theme = stored || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  applyTheme(theme);
}

function loadSavedControls() {
  els.speed.value = String(prefs.get('speed', 1));
  els.pitch.value = String(prefs.get('pitch', 1));
  els.volume.value = String(prefs.get('volume', 1));
  updateRangeLabels();
}

els.text.addEventListener('input', countText);
els.voiceSearch.addEventListener('input', populateBrowserVoices);
els.browserVoice.addEventListener('change', updateBrowserVoiceMeta);
[els.speed, els.pitch, els.volume].forEach(el => el.addEventListener('input', updateRangeLabels));
$('#playBtn').addEventListener('click', playSpeech);
$('#pauseBtn').addEventListener('click', pauseSpeech);
$('#resumeBtn').addEventListener('click', resumeSpeech);
$('#stopBtn').addEventListener('click', stopSpeech);
$('#clearText').addEventListener('click', () => { stopSpeech(); els.text.value = ''; countText(); els.text.focus(); });
$('#fileInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) return toast('Please use a TXT/MD file smaller than 5 MB.', true);
  try { els.text.value = await file.text(); countText(); toast(`${file.name} imported.`); } catch { toast('Could not read this file.', true); }
  event.target.value = '';
});
els.downloadSearch.addEventListener('input', populateNaturalVoices);
els.downloadVoice.addEventListener('change', updateNaturalVoiceMeta);
$('#refreshVoices').addEventListener('click', () => loadNaturalVoices(true));
els.generateMp3.addEventListener('click', generateMp3);
els.downloadMp3.addEventListener('click', downloadCurrentMp3);
$('#themeToggle').addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
window.addEventListener('beforeunload', () => { stopSpeech(); if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl); });

initTheme();
loadSavedControls();
countText();
loadBrowserVoices();
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = loadBrowserVoices;
loadNaturalVoices().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
