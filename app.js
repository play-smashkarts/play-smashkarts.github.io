(() => {
  'use strict';
  // Remove the cache-first service worker used by v1.x so GitHub Pages always serves the current UI.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(regs => Promise.all(regs.map(r => r.update().catch(() => {})))).catch(() => {});
  }
  if ('caches' in window) {
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('voicecraft-')).map(k => caches.delete(k)))).catch(() => {});
  }

  const API_BASE = 'https://ahm7xmakki.com';
  const CACHE_KEY = 'voicecraft_natural_voices_v2';
  const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
  const q = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const el = {
    text:q('#textInput'), chars:q('#charCount'), words:q('#wordCount'), lang:q('#langHint'), status:q('#status'), toast:q('#toast'),
    browserSearch:q('#browserVoiceSearch'), browserVoice:q('#browserVoice'), browserMeta:q('#browserVoiceMeta'),
    speed:q('#speed'), pitch:q('#pitch'), volume:q('#volume'), speedOut:q('#speedOut'), pitchOut:q('#pitchOut'), volumeOut:q('#volumeOut'), speechProgress:q('#speechProgress'),
    listen:q('#listenPanel'), mp3:q('#mp3Panel'), loadVoices:q('#loadVoicesBtn'), loaderText:q('#voiceLoaderText'), naturalControls:q('#naturalControls'),
    naturalSearch:q('#naturalSearch'), naturalVoice:q('#naturalVoice'), naturalMeta:q('#naturalMeta'), preview:q('#previewBtn'), refresh:q('#refreshBtn'),
    mp3Speed:q('#mp3Speed'), mp3Pitch:q('#mp3Pitch'), mp3SpeedOut:q('#mp3SpeedOut'), mp3PitchOut:q('#mp3PitchOut'), generate:q('#generateBtn'),
    genState:q('#genState'), genText:q('#genText'), genPct:q('#genPct'), genProgress:q('#genProgress'), audioBox:q('#audioBox'), player:q('#audioPlayer'), audioMeta:q('#audioMeta'), download:q('#downloadBtn')
  };

  let browserVoices = [], naturalVoices = [], spokenChunks = [], speechIndex = 0, speechRun = 0;
  let audioBlob = null, audioUrl = '', audioName = '';
  let previewPartUrls = [], previewIndex = 0;
  let voiceLoadPromise = null, naturalFilterTimer = 0;
  const store = {
    get(k, d=null){try{const v=localStorage.getItem('vc2_'+k);return v===null?d:JSON.parse(v)}catch{return d}},
    set(k,v){try{localStorage.setItem('vc2_'+k,JSON.stringify(v))}catch{}}
  };

  function notify(msg, error=false){ el.toast.textContent=msg; el.toast.classList.toggle('error',error); el.toast.classList.add('show'); clearTimeout(notify.t); notify.t=setTimeout(()=>el.toast.classList.remove('show'),2800); }
  function setStatus(msg,busy=false,error=false){ el.status.querySelector('span').textContent=msg; const dot=el.status.querySelector('i'); dot.style.background=error?'#ff7892':busy?'#ffd166':'#42e8bd'; }
  function textValue(){ const v=el.text.value.trim(); if(!v) throw new Error('Please add some text first.'); return v; }
  function detectLanguage(t){const s=t.slice(0,1000);if(!s.trim())return'Auto';if(/[\u0600-\u06FF]/.test(s))return'Urdu / Arabic';if(/[\u0900-\u097F]/.test(s))return'Hindi';if(/[\u3040-\u30FF]/.test(s))return'Japanese';if(/[\uAC00-\uD7AF]/.test(s))return'Korean';if(/[\u4E00-\u9FFF]/.test(s))return'Chinese';return'Auto / Latin'}
  function updateCounts(){const t=el.text.value;el.chars.textContent=t.length.toLocaleString();el.words.textContent=(t.trim()?t.trim().split(/\s+/u).length:0).toLocaleString();el.lang.textContent='Language: '+detectLanguage(t)}
  function debounce(fn,ms){let id;return(...a)=>{clearTimeout(id);id=setTimeout(()=>fn(...a),ms)}}

  function switchTab(name){
    const mp3=name==='mp3'; el.listen.classList.toggle('hidden',mp3); el.mp3.classList.toggle('hidden',!mp3);
    $$('.mode-tab').forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',String(on))});
    if(mp3) hydrateNaturalVoicesFromCache();
  }

  function getBrowserVoices(){
    if(!('speechSynthesis' in window)){el.browserVoice.innerHTML='<option>Not supported</option>';el.browserMeta.textContent='Speech synthesis is unavailable in this browser.';return}
    const fresh=speechSynthesis.getVoices(); if(!fresh.length) return;
    browserVoices=fresh.slice().sort((a,b)=>(a.lang+a.name).localeCompare(b.lang+b.name)); renderBrowserVoices();
  }
  function renderBrowserVoices(){
    const search=el.browserSearch.value.trim().toLowerCase(); const previous=store.get('browserVoice','')||el.browserVoice.value;
    const frag=document.createDocumentFragment(); const groups=new Map();
    browserVoices.filter(v=>!search||(`${v.name} ${v.lang}`).toLowerCase().includes(search)).forEach(v=>{const key=v.lang||'Other';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(v)});
    for(const [lang,voices] of groups){const g=document.createElement('optgroup');g.label=lang;for(const v of voices){const o=new Option(v.name+(v.localService?' · Local':''),v.voiceURI||v.name);o.dataset.name=v.name;o.dataset.lang=v.lang;g.appendChild(o)}frag.appendChild(g)}
    el.browserVoice.replaceChildren(frag); if([...el.browserVoice.options].some(o=>o.value===previous))el.browserVoice.value=previous; updateBrowserMeta();
  }
  function selectedBrowserVoice(){const opt=el.browserVoice.selectedOptions[0];if(!opt)return null;return browserVoices.find(v=>(v.voiceURI||v.name)===opt.value)||browserVoices.find(v=>v.name===opt.dataset.name)||null}
  function updateBrowserMeta(){const v=selectedBrowserVoice();if(!v){el.browserMeta.textContent='No matching voice.';return}el.browserMeta.textContent=`${v.lang||'Unknown'} · ${v.localService?'Local/system':'Browser voice'}`;store.set('browserVoice',v.voiceURI||v.name)}
  function splitText(text,max=240){const s=text.replace(/\s+/g,' ').trim();if(!s)return[];const sentences=s.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu)||[s];const out=[];let cur='';for(const raw of sentences){const sentence=raw.trim();if(!sentence)continue;if(sentence.length>max){if(cur){out.push(cur);cur=''};for(let i=0;i<sentence.length;i+=max)out.push(sentence.slice(i,i+max));continue}const next=cur?cur+' '+sentence:sentence;if(next.length<=max)cur=next;else{if(cur)out.push(cur);cur=sentence}}if(cur)out.push(cur);return out}
  function stopSpeech(){speechRun++; if('speechSynthesis'in window)speechSynthesis.cancel();spokenChunks=[];speechIndex=0;el.speechProgress.style.width='0%';setStatus('Ready')}
  function speakNext(run){if(run!==speechRun)return;if(speechIndex>=spokenChunks.length){el.speechProgress.style.width='100%';setStatus('Ready');setTimeout(()=>{if(run===speechRun)el.speechProgress.style.width='0%'},500);return}const u=new SpeechSynthesisUtterance(spokenChunks[speechIndex]);const v=selectedBrowserVoice();if(v){u.voice=v;u.lang=v.lang}u.rate=Number(el.speed.value);u.pitch=Number(el.pitch.value);u.volume=Number(el.volume.value);u.onstart=()=>setStatus(`Speaking ${speechIndex+1}/${spokenChunks.length}`,true);u.onend=()=>{if(run!==speechRun)return;speechIndex++;el.speechProgress.style.width=`${Math.round(speechIndex/spokenChunks.length*100)}%`;speakNext(run)};u.onerror=e=>{if(e.error!=='canceled'&&e.error!=='interrupted')notify('Playback error: '+(e.error||'unknown'),true);setStatus('Ready')};speechSynthesis.speak(u)}
  function playSpeech(){try{const t=textValue();stopSpeech();const run=++speechRun;spokenChunks=splitText(t,240);speechIndex=0;speakNext(run)}catch(e){notify(e.message,true)}}

  function readVoiceCache(){try{const data=JSON.parse(localStorage.getItem(CACHE_KEY)||'null');if(!data||!Array.isArray(data.voices)||Date.now()-data.time>CACHE_TTL)return null;return data.voices}catch{return null}}
  function writeVoiceCache(v){try{localStorage.setItem(CACHE_KEY,JSON.stringify({time:Date.now(),voices:v}))}catch{}}
  function normalizeVoices(list){return list.map(v=>({index:Number(v.index),name:String(v.name||`Voice ${v.index}`),gender:String(v.gender||''),language:String(v.language||'Unknown'),country:String(v.country||''),id:String(v.id||'')})).filter(v=>Number.isFinite(v.index))}
  function hydrateNaturalVoicesFromCache(){if(naturalVoices.length)return;const cached=readVoiceCache();if(cached?.length){naturalVoices=cached;el.loaderText.textContent=`${naturalVoices.length} cached voices ready instantly.`;el.loadVoices.textContent='Use cached voices';renderNaturalVoices();el.naturalControls.hidden=false}}
  async function fetchWithTimeout(url,opts={},ms=12000){const c=new AbortController();const id=setTimeout(()=>c.abort(),ms);try{return await fetch(url,{...opts,signal:c.signal})}finally{clearTimeout(id)}}
  async function loadNaturalVoices(force=false){
    if(voiceLoadPromise&&!force)return voiceLoadPromise;
    if(naturalVoices.length&&!force){el.naturalControls.hidden=false;return naturalVoices}
    const cached=!force&&readVoiceCache();if(cached?.length){naturalVoices=cached;renderNaturalVoices();el.naturalControls.hidden=false;return naturalVoices}
    voiceLoadPromise=(async()=>{el.loadVoices.disabled=true;el.loadVoices.textContent='Loading…';el.loaderText.textContent='Connecting to natural voice service…';setStatus('Loading voices',true);try{const r=await fetchWithTimeout(`${API_BASE}/api/voices`,{cache:'no-store'},12000);if(!r.ok)throw new Error(`Voice list failed (HTTP ${r.status}).`);const data=await r.json();if(!data?.success||!Array.isArray(data.voices))throw new Error('Voice service returned an invalid list.');naturalVoices=normalizeVoices(data.voices);writeVoiceCache(naturalVoices);renderNaturalVoices();el.naturalControls.hidden=false;el.loaderText.textContent=`${naturalVoices.length} voices loaded and cached for 7 days.`;el.loadVoices.textContent='Voices loaded';notify(`${naturalVoices.length} voices ready.`);setStatus('Ready');return naturalVoices}catch(e){el.loaderText.textContent='Could not load voices. Check internet/CORS and retry.';el.loadVoices.textContent='Retry';notify(e.name==='AbortError'?'Voice service timed out. Please retry.':e.message,true);setStatus('Voice service error',false,true);throw e}finally{el.loadVoices.disabled=false;voiceLoadPromise=null}})();
    return voiceLoadPromise;
  }
  function renderNaturalVoices(){
    const term=el.naturalSearch?.value.trim().toLowerCase()||''; const current=store.get('naturalVoice','')||el.naturalVoice.value;
    const list=term?naturalVoices.filter(v=>(`${v.name} ${v.language} ${v.country} ${v.gender}`).toLowerCase().includes(term)):naturalVoices;
    const frag=document.createDocumentFragment(),groups=new Map();for(const v of list){if(!groups.has(v.language))groups.set(v.language,[]);groups.get(v.language).push(v)}
    for(const [lang,arr] of groups){const g=document.createElement('optgroup');g.label=lang;for(const v of arr){g.appendChild(new Option(`${v.name}${v.country?' · '+v.country:''}${v.gender?' · '+v.gender:''}`,String(v.index)))}frag.appendChild(g)}
    el.naturalVoice.replaceChildren(frag);if([...el.naturalVoice.options].some(o=>o.value===String(current)))el.naturalVoice.value=String(current);else if(el.naturalVoice.options.length)el.naturalVoice.selectedIndex=0;updateNaturalMeta();
  }
  function selectedNaturalVoice(){return naturalVoices.find(v=>String(v.index)===el.naturalVoice.value)||null}
  function updateNaturalMeta(){const v=selectedNaturalVoice();if(!v){el.naturalMeta.textContent='No matching voice.';return}el.naturalMeta.textContent=`${v.name} · ${v.language}${v.country?' · '+v.country:''}${v.gender?' · '+v.gender:''} · selection is local`;store.set('naturalVoice',String(v.index))}

  function splitMp3Text(text,max=900){const clean=text.replace(/\s+/g,' ').trim();if(!clean)return[];const sentences=clean.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/gu)||[clean];const out=[];let cur='';const push=()=>{if(cur.trim()){out.push(cur.trim());cur=''}};for(const raw of sentences){const s=raw.trim();if(!s)continue;if(s.length<=max){const next=cur?cur+' '+s:s;if(next.length<=max)cur=next;else{push();cur=s}}else{push();const words=s.split(/\s+/);let part='';for(const word of words){const next=part?part+' '+word:word;if(next.length<=max)part=next;else{if(part)out.push(part);if(word.length>max){for(let i=0;i<word.length;i+=max)out.push(word.slice(i,i+max));part=''}else part=word}}if(part)out.push(part)}}push();return out}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function hasMp3Sync(u){const lim=Math.min(u.length-1,4096);for(let i=0;i<lim;i++){if(u[i]===0xFF&&(u[i+1]&0xE0)===0xE0)return true}return false}
  async function validateMp3Blob(blob){
    if(!blob||blob.size<128)throw new Error('TTS returned an empty/invalid audio chunk.');
    const head=new Uint8Array(await blob.slice(0,4096).arrayBuffer());
    const isId3=head.length>=3&&head[0]===0x49&&head[1]===0x44&&head[2]===0x33;
    if(!isId3&&!hasMp3Sync(head)){
      const sample=await blob.slice(0,300).text().catch(()=>'');
      throw new Error(sample.trim().startsWith('{')?'TTS provider returned an error instead of MP3 audio.':'TTS returned invalid MP3 data.');
    }
    return blob;
  }
  async function synthChunk(text,voiceIndex,pitch,rate,attempt=0){
    try{
      const r=await fetchWithTimeout(`${API_BASE}/api/tts`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voiceIndex:Number(voiceIndex),text,pitch:Number(pitch),rate:Number(rate)})},45000);
      if(!r.ok){
        if([429,500,502,503,504].includes(r.status)&&attempt<3){await sleep(700*Math.pow(2,attempt));return synthChunk(text,voiceIndex,pitch,rate,attempt+1)}
        throw new Error(`TTS request failed (HTTP ${r.status}).`);
      }
      const b=await r.blob();
      return await validateMp3Blob(b);
    }catch(e){
      if(e.name==='AbortError'&&attempt<2){await sleep(800*Math.pow(2,attempt));return synthChunk(text,voiceIndex,pitch,rate,attempt+1)}
      throw e;
    }
  }
  function syncSafeSize(u,o=6){return((u[o]&0x7f)<<21)|((u[o+1]&0x7f)<<14)|((u[o+2]&0x7f)<<7)|(u[o+3]&0x7f)}
  function mp3FrameInfo(u,o){
    if(o+4>u.length||u[o]!==0xFF||(u[o+1]&0xE0)!==0xE0)return null;
    const versionBits=(u[o+1]>>3)&3,layerBits=(u[o+1]>>1)&3,bitrateIndex=(u[o+2]>>4)&15,srIndex=(u[o+2]>>2)&3,padding=(u[o+2]>>1)&1;
    if(versionBits===1||layerBits!==1||bitrateIndex===0||bitrateIndex===15||srIndex===3)return null;
    const mpeg1=versionBits===3;
    const br1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0];
    const br2=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0];
    const srBase=[44100,48000,32000];let sr=srBase[srIndex];if(versionBits===2)sr/=2;else if(versionBits===0)sr/=4;
    const br=(mpeg1?br1[bitrateIndex]:br2[bitrateIndex])*1000;const len=Math.floor((mpeg1?144:72)*br/sr)+padding;
    return len>4?{length:len}:null;
  }
  function findFirstMp3Frame(u){for(let i=0;i<Math.min(u.length-4,65536);i++){if(mp3FrameInfo(u,i))return i}return-1}
  function asciiAt(u,start,end,needle){const n=[...needle].map(c=>c.charCodeAt(0));for(let i=start;i<=end-n.length;i++){let ok=true;for(let j=0;j<n.length;j++)if(u[i+j]!==n[j]){ok=false;break}if(ok)return true}return false}
  async function cleanMp3Part(blob){
    let u=new Uint8Array(await blob.arrayBuffer()),start=0,end=u.length;
    if(u.length>=10&&u[0]===0x49&&u[1]===0x44&&u[2]===0x33){const footer=(u[5]&0x10)?10:0;start=Math.min(u.length,10+syncSafeSize(u)+footer)}
    if(end-start>=128&&u[end-128]===0x54&&u[end-127]===0x41&&u[end-126]===0x47)end-=128;
    u=u.subarray(start,end);
    const first=findFirstMp3Frame(u);if(first<0)throw new Error('Could not find MP3 audio frames in a generated chunk.');if(first>0)u=u.subarray(first);
    const info=mp3FrameInfo(u,0);if(info&&info.length<=u.length&&asciiAt(u,0,Math.min(info.length,300),'Xing')||info&&info.length<=u.length&&asciiAt(u,0,Math.min(info.length,300),'Info')||info&&info.length<=u.length&&asciiAt(u,0,Math.min(info.length,300),'VBRI'))u=u.subarray(info.length);
    return u.slice();
  }
  async function mergeMp3Parts(parts){const cleaned=[];for(const part of parts){const u=await cleanMp3Part(part);if(u.length)cleaned.push(u)}if(!cleaned.length)throw new Error('No valid MP3 frames were generated.');return new Blob(cleaned,{type:'audio/mpeg'})}
  function clearPreviewParts(){for(const u of previewPartUrls)URL.revokeObjectURL(u);previewPartUrls=[];previewIndex=0}
  function setupChunkPreview(parts){
    clearPreviewParts();previewPartUrls=parts.map(b=>URL.createObjectURL(b));previewIndex=0;
    if(previewPartUrls.length){el.player.src=previewPartUrls[0];el.player.load()}
  }
  el.player.addEventListener('ended',()=>{
    if(previewPartUrls.length>1&&previewIndex<previewPartUrls.length-1){previewIndex++;el.player.src=previewPartUrls[previewIndex];el.player.load();el.player.play().catch(()=>{});el.audioMeta.dataset.chunk=`${previewIndex+1}/${previewPartUrls.length}`;}
    else if(previewPartUrls.length>1){previewIndex=0;el.player.src=previewPartUrls[0];el.player.load();}
  });
  function setGen(done,total){el.genState.hidden=false;const pct=Math.round(done/Math.max(1,total)*100);el.genText.textContent=done>=total?'Repairing & finalizing MP3…':`Generated ${done} of ${total} chunks`;el.genPct.textContent=pct+'%';el.genProgress.style.width=pct+'%'}
  function filename(){const d=new Date(),p=n=>String(n).padStart(2,'0');return`voicecraft-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.mp3`}
  function bytes(n){return n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(2)} MB`}
  async function generateMp3(){
    try{
      const text=textValue();if(!naturalVoices.length)await loadNaturalVoices();const voice=selectedNaturalVoice();if(!voice)throw new Error('Select a voice artist first.');
      const chunks=splitMp3Text(text,900);if(!chunks.length)throw new Error('No valid text to generate.');
      const voiceIndex=voice.index,pitch=Number(el.mp3Pitch.value),rate=Number(el.mp3Speed.value);
      el.generate.disabled=true;setStatus('Generating MP3',true);setGen(0,chunks.length);el.audioBox.hidden=true;
      const results=new Array(chunks.length);let done=0,cursor=0;const workers=Math.min(chunks.length,4);
      async function worker(){while(true){const i=cursor++;if(i>=chunks.length)return;results[i]=await synthChunk(chunks[i],voiceIndex,pitch,rate);done++;setGen(done,chunks.length)}}
      await Promise.all(Array.from({length:workers},()=>worker()));
      audioBlob=await mergeMp3Parts(results);
      if(audioUrl)URL.revokeObjectURL(audioUrl);audioUrl=URL.createObjectURL(audioBlob);audioName=filename();
      setupChunkPreview(results);
      el.audioMeta.textContent=`${voice.name} · ${chunks.length} part${chunks.length===1?'':'s'} · ${bytes(audioBlob.size)}`;
      el.audioBox.hidden=false;setStatus('MP3 ready');el.genText.textContent='MP3 ready';el.genPct.textContent='100%';el.genProgress.style.width='100%';notify(chunks.length>1?'Long MP3 generated — preview plays parts continuously.':'MP3 generated.');
    }catch(e){notify(e.name==='AbortError'?'TTS service timed out. Please retry.':e.message,true);setStatus('Generation error',false,true);el.genState.hidden=true}
    finally{el.generate.disabled=false}
  }
  async function previewVoice(){try{if(!naturalVoices.length)await loadNaturalVoices();const voice=selectedNaturalVoice();if(!voice)throw new Error('Select a voice artist first.');el.preview.disabled=true;el.preview.textContent='Loading preview…';const b=await synthChunk('Hello. This is a quick VoiceCraft preview.',voice.index,el.mp3Pitch.value,el.mp3Speed.value);const u=URL.createObjectURL(b);const a=new Audio(u);a.onended=()=>URL.revokeObjectURL(u);a.onerror=()=>URL.revokeObjectURL(u);await a.play()}catch(e){notify(e.message,true)}finally{el.preview.disabled=false;el.preview.textContent='▶ Preview selected voice'}}
  function downloadMp3(){if(!audioBlob||!audioUrl)return notify('Generate an MP3 first.',true);const a=document.createElement('a');a.href=audioUrl;a.download=audioName||filename();document.body.appendChild(a);a.click();a.remove()}

  el.text.addEventListener('input',updateCounts);
  q('#clearBtn').addEventListener('click',()=>{stopSpeech();el.text.value='';updateCounts();el.text.focus()});
  q('#fileInput').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>5*1024*1024)return notify('Use a TXT/MD file under 5 MB.',true);try{el.text.value=await f.text();updateCounts();notify(`${f.name} imported.`)}catch{notify('Could not read file.',true)}e.target.value=''});
  el.browserSearch.addEventListener('input',debounce(renderBrowserVoices,90)); el.browserVoice.addEventListener('change',updateBrowserMeta);
  [el.speed,el.pitch,el.volume].forEach(x=>x.addEventListener('input',()=>{el.speedOut.textContent=Number(el.speed.value).toFixed(2)+'×';el.pitchOut.textContent=Number(el.pitch.value).toFixed(2);el.volumeOut.textContent=Math.round(Number(el.volume.value)*100)+'%';store.set('playback',{speed:el.speed.value,pitch:el.pitch.value,volume:el.volume.value})}));
  q('#playBtn').addEventListener('click',playSpeech);q('#pauseBtn').addEventListener('click',()=>{if(speechSynthesis.speaking&&!speechSynthesis.paused){speechSynthesis.pause();setStatus('Paused')}});q('#resumeBtn').addEventListener('click',()=>{if(speechSynthesis.paused){speechSynthesis.resume();setStatus('Speaking',true)}});q('#stopBtn').addEventListener('click',stopSpeech);
  $$('.mode-tab').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));q('#goMp3').addEventListener('click',()=>switchTab('mp3'));
  el.loadVoices.addEventListener('click',()=>loadNaturalVoices(!readVoiceCache()).catch(()=>{}));
  el.refresh.addEventListener('click',()=>{try{localStorage.removeItem(CACHE_KEY)}catch{};naturalVoices=[];loadNaturalVoices(true).catch(()=>{})});
  el.naturalSearch.addEventListener('input',()=>{clearTimeout(naturalFilterTimer);naturalFilterTimer=setTimeout(renderNaturalVoices,110)});el.naturalVoice.addEventListener('change',updateNaturalMeta);
  el.preview.addEventListener('click',previewVoice);el.generate.addEventListener('click',generateMp3);el.download.addEventListener('click',downloadMp3);
  [el.mp3Speed,el.mp3Pitch].forEach(x=>x.addEventListener('input',()=>{el.mp3SpeedOut.textContent=el.mp3Speed.value;el.mp3PitchOut.textContent=el.mp3Pitch.value;store.set('mp3fx',{speed:el.mp3Speed.value,pitch:el.mp3Pitch.value})}));
  q('#themeBtn').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='light'?'dark':'light';document.documentElement.dataset.theme=next;store.set('theme',next)});
  window.addEventListener('beforeunload',()=>{stopSpeech();clearPreviewParts();if(audioUrl)URL.revokeObjectURL(audioUrl)});

  const theme=store.get('theme',matchMedia('(prefers-color-scheme:light)').matches?'light':'dark');document.documentElement.dataset.theme=theme;
  const pb=store.get('playback',{});el.speed.value=pb.speed||1;el.pitch.value=pb.pitch||1;el.volume.value=pb.volume??1;el.speed.dispatchEvent(new Event('input'));
  const fx=store.get('mp3fx',{});el.mp3Speed.value=fx.speed||0;el.mp3Pitch.value=fx.pitch||0;el.mp3SpeedOut.textContent=el.mp3Speed.value;el.mp3PitchOut.textContent=el.mp3Pitch.value;
  updateCounts();getBrowserVoices();if('speechSynthesis'in window)speechSynthesis.addEventListener?.('voiceschanged',getBrowserVoices);
  setTimeout(getBrowserVoices,250);setTimeout(getBrowserVoices,900);
})();
