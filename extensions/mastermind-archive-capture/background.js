const DEFAULTS = {
  apiBase: 'http://127.0.0.1:3000', jobId: 1, registerId: '000631963', pageFrom: 1, pageTo: 1,
  archiveKind: 'iiif', manifestUrl: 'https://rechercher.patrimoines-archives.morbihan.fr/ark:/15049/vta54487c774652a/manifest',
  configVersion: 2, delayMs: 2500, running: false, status: 'not paired', processed: 0,
  saved: 0, indexed: 0, extracted: 0, failed: 0, bytesSaved: 0, iiifQueue: [], nextQueueIndex: 0,
  stepStartedAt: null, stepQueueIndex: null, pageRetryCount: 0,
};

const stored = async () => {
  const current = await chrome.storage.local.get(null);
  const state = { ...DEFAULTS, ...current };
  if (/^http:\/\/(?:127\.0\.0\.1|localhost):3111\/?$/i.test(String(state.apiBase))) {
    state.apiBase = DEFAULTS.apiBase;
    await chrome.storage.local.set({ apiBase: state.apiBase });
  }
  if (Number(current.configVersion) < 2) {
    Object.assign(state, { archiveKind:DEFAULTS.archiveKind, manifestUrl:DEFAULTS.manifestUrl, pageFrom:1, pageTo:1, configVersion:2 });
    await chrome.storage.local.set({ archiveKind:state.archiveKind, manifestUrl:state.manifestUrl, pageFrom:1, pageTo:1, configVersion:2 });
  }
  return state;
};
const save = async (patch) => chrome.storage.local.set(patch);

function bytesToBase64Url(bytes) {
  let raw = '';
  for (const value of bytes) raw += String.fromCharCode(value);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function identity() {
  const current = await chrome.storage.local.get(['captureClientId', 'captureSecret']);
  if (current.captureClientId && current.captureSecret) return current;
  const created = { captureClientId: crypto.randomUUID(), captureSecret: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32))) };
  await chrome.storage.local.set(created);
  return created;
}

async function decode(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { ok: false, error: text || `HTTP ${response.status}` }; }
}

async function boundedFetch(url,options={},timeoutMs=75000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{return await fetch(url,{...options,signal:controller.signal});}
  catch(error){if(error?.name==='AbortError')throw new Error(`Request timed out after ${Math.round(timeoutMs/1000)} seconds`);throw error;}
  finally{clearTimeout(timer);}
}

async function pairing(registerIfMissing = false) {
  const state = await stored(), id = await identity();
  let response = await fetch(`${state.apiBase}/api/genealogy/acquisition?clientId=${encodeURIComponent(id.captureClientId)}`, {
    cache: 'no-store', headers:{ 'X-Mastermind-Capture-Client':id.captureClientId, 'X-Mastermind-Capture-Secret':id.captureSecret },
  });
  let body = await decode(response);
  if (response.ok && body.pairing?.status !== 'unregistered') return body.pairing;
  if (!registerIfMissing) return { status: 'unregistered' };
  response = await fetch(`${state.apiBase}/api/genealogy/acquisition`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'register_client', clientId: id.captureClientId, secretSha256: await sha256(id.captureSecret), label: 'Chrome archive capture' }),
  });
  body = await decode(response);
  if (!response.ok) throw new Error(body.error || `Pairing returned HTTP ${response.status}`);
  return body.pairing;
}

async function connectionInfo() {
  const state = await stored(), id = await identity();
  const response = await fetch(`${state.apiBase}/api/genealogy/acquisition?clientId=${encodeURIComponent(id.captureClientId)}`, {
    cache:'no-store', headers:{ 'X-Mastermind-Capture-Client':id.captureClientId, 'X-Mastermind-Capture-Secret':id.captureSecret },
  });
  const body = await decode(response);
  if (!response.ok) throw new Error(body.error || `Mastermind returned HTTP ${response.status}`);
  return body;
}

async function statusInfo() {
  let state = await stored();
  try {
    const info = await connectionInfo();
    if (info.pairing?.status === 'approved') {
      let archive = state.archiveKind === 'nli' ? 'nli' : 'morbihan-iiif';
      let registerId = state.archiveKind === 'nli' ? String(state.registerId || '') : '';
      if (state.archiveKind === 'iiif') registerId = manifestIdentity(normalizeIiifManifestUrl(state.manifestUrl));
      const matched = (Array.isArray(info.jobs) ? info.jobs : []).find((job) =>
        job.archive === archive && String(job.register_id || '').toLowerCase() === String(registerId || '').toLowerCase());
      if (matched && Number(matched.id) !== Number(state.jobId)) {
        await save({ jobId:Number(matched.id) });
        state = { ...state, jobId:Number(matched.id) };
      }
    }
    return { ok:true, state, pairing:info.pairing || { status:'offline' } };
  } catch {
    return { ok:true, state, pairing:{ status:'offline' } };
  }
}

async function ensureJob(archive, registerId, sourceUrl, manifestUrl = null) {
  const state = await stored(), id = await identity();
  const response = await boundedFetch(`${state.apiBase}/api/genealogy/acquisition`, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'X-Mastermind-Capture-Client':id.captureClientId,
      'X-Mastermind-Capture-Secret':id.captureSecret,
    },
    body:JSON.stringify({ action:'ensure_job', archive, registerId, sourceUrl, manifestUrl }),
  }, 30000);
  const body = await decode(response);
  if (!response.ok || !body.job?.id) throw new Error(body.error || `Job creation returned HTTP ${response.status}`);
  await save({ jobId:Number(body.job.id) });
  return Number(body.job.id);
}

async function resolveJobId(archive, registerId, preferredJobId, sourceUrl, manifestUrl = null) {
  const info = await connectionInfo();
  if (info.pairing?.status !== 'approved') throw new Error('Approve this extension in Mastermind Genealogy first.');
  const jobs = Array.isArray(info.jobs) ? info.jobs : [];
  const preferred = jobs.find((job) => Number(job.id) === Number(preferredJobId));
  if (preferred && preferred.archive === archive && String(preferred.register_id || '').toLowerCase() === String(registerId || '').toLowerCase()) return Number(preferred.id);
  const matched = jobs.find((job) => job.archive === archive && String(job.register_id || '').toLowerCase() === String(registerId || '').toLowerCase());
  if (!matched) return ensureJob(archive, registerId, sourceUrl, manifestUrl);
  await save({ jobId: Number(matched.id) });
  return Number(matched.id);
}

async function upload(blob, metadata) {
  const state = await stored(), id = await identity();
  const digest = await sha256(await blob.arrayBuffer());
  const form = new FormData();
  form.set('image', blob, metadata.filename || `archive-${digest.slice(0, 12)}.${blob.type === 'image/png' ? 'png' : 'jpg'}`);
  form.set('metadata', JSON.stringify({ ...metadata, eventId: crypto.randomUUID(), jobId: Number(state.jobId), sha256: digest }));
  const response = await boundedFetch(`${state.apiBase}/api/genealogy/acquisition`, {
    method: 'POST', headers: { 'X-Mastermind-Capture-Client': id.captureClientId, 'X-Mastermind-Capture-Secret': id.captureSecret }, body: form,
  });
  const body = await decode(response);
  if (!response.ok) throw new Error(body.error || `Mastermind returned HTTP ${response.status}`);
  return body;
}

async function indexManifest(jobId, archiveId, manifestUrl, label, pages) {
  const state = await stored(), id = await identity();
  const response = await fetch(`${state.apiBase}/api/genealogy/acquisition`, {
    method:'POST', headers:{ 'Content-Type':'application/json', 'X-Mastermind-Capture-Client':id.captureClientId,
      'X-Mastermind-Capture-Secret':id.captureSecret },
    body:JSON.stringify({ action:'index_manifest', jobId, archiveId, manifestUrl, label, pages }),
  });
  const body = await decode(response);
  if (!response.ok) throw new Error(body.error || `Manifest indexing returned HTTP ${response.status}`);
  return body;
}

async function uploadIndexProbe(blob, metadata) {
  const state=await stored(),id=await identity(),form=new FormData();
  form.set('image',blob,`index-page-${metadata.pageNumber}.${blob.type==='image/png'?'png':'jpg'}`);
  form.set('metadata',JSON.stringify({...metadata,jobId:Number(state.jobId)}));
  const response=await boundedFetch(`${state.apiBase}/api/genealogy/index`,{method:'POST',headers:{
    'X-Mastermind-Capture-Client':id.captureClientId,'X-Mastermind-Capture-Secret':id.captureSecret,
  },body:form},75000);
  const body=await decode(response);
  if(!response.ok)throw new Error(body.error||`Fast indexing returned HTTP ${response.status}`);
  return body;
}

async function uploadRecordExtraction(blob,metadata){
  const state=await stored(),id=await identity(),form=new FormData();
  form.set('image',blob,`extract-page-${metadata.pageNumber}.${blob.type==='image/png'?'png':'jpg'}`);
  form.set('metadata',JSON.stringify({...metadata,jobId:Number(state.jobId)}));
  const response=await fetch(`${state.apiBase}/api/genealogy/extract`,{method:'POST',headers:{
    'X-Mastermind-Capture-Client':id.captureClientId,'X-Mastermind-Capture-Secret':id.captureSecret,
  },body:form});
  const body=await decode(response);if(!response.ok)throw new Error(body.error||`Record extraction returned HTTP ${response.status}`);return body;
}

function nliPage(registerId, pageNumber) {
  const page = String(pageNumber).padStart(3, '0');
  return {
    sourceUrl: `https://registers.nli.ie/pages/vtls${registerId}_${page}`,
    fallbackImageUrl: `https://registers.nli.ie/static/high/${registerId}/vtls${registerId}_${page}.jpg`,
    filename: `vtls${registerId}_${page}.jpg`,
  };
}

async function inspectNli(registerId, pageNumber) {
  const target = nliPage(registerId, pageNumber);
  const response = await fetch(target.sourceUrl, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`NLI page ${pageNumber} returned HTTP ${response.status}. Open one register page normally and complete any public security check.`);
  const html = await response.text();
  const discovered = html.match(/https?:\/\/registers\.nli\.ie\/static\/(?:high|medium|low)\/\d+\/vtls\d+_\d+\.(?:jpe?g|png)/i)?.[0];
  return { ...target, imageUrl: discovered || target.fallbackImageUrl };
}

async function dimensions(blob) {
  try {
    const bitmap = await createImageBitmap(blob);
    const result = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return result;
  } catch { return { width: null, height: null }; }
}

async function fetchImage(url) {
  const response = await boundedFetch(url, { credentials: 'include', cache: 'no-store' }, 75000);
  if (!response.ok) throw new Error(`Archive image returned HTTP ${response.status}`);
  const blob = await response.blob();
  if (!['image/jpeg', 'image/jpg', 'image/png'].includes(blob.type) || blob.size < 12) throw new Error(`Archive returned ${blob.type || 'unknown data'} instead of a JPEG/PNG image`);
  if (blob.size > 24 * 1024 * 1024) throw new Error('Archive image is larger than the 24 MB capture limit');
  return blob;
}

async function firstAvailableImage(urls) {
  const failures = [];
  for (const url of [...new Set(urls.filter(Boolean))]) {
    try { return { blob: await fetchImage(url), imageUrl: url }; }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  throw new Error(`No permitted archive image endpoint succeeded: ${failures.slice(0, 3).join(' · ')}`);
}

function iiifId(value) {
  if (typeof value === 'string') return value;
  return value?.['@id'] || value?.id || null;
}

function iiifLabel(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(iiifLabel).filter(Boolean).join(' ');
  if (value && typeof value === 'object') return Object.values(value).flat().map(String).join(' ');
  return '';
}

function iiifCanvases(manifest) {
  const versionTwo = Array.isArray(manifest?.sequences) ? manifest.sequences.flatMap((sequence) => sequence?.canvases || []) : [];
  return versionTwo.length ? versionTwo : (Array.isArray(manifest?.items) ? manifest.items : []);
}

function iiifBody(canvas) {
  return canvas?.images?.[0]?.resource || canvas?.items?.[0]?.items?.[0]?.body || {};
}

function iiifRenderings(canvas, body) {
  const renderings = [...(Array.isArray(canvas?.rendering) ? canvas.rendering : canvas?.rendering ? [canvas.rendering] : []),
    ...(Array.isArray(body?.rendering) ? body.rendering : body?.rendering ? [body.rendering] : [])];
  const originals = renderings.filter((item) => /original/i.test(iiifLabel(item?.label))).map(iiifId);
  const downloads = renderings.map(iiifId);
  const services = (Array.isArray(body?.service) ? body.service : body?.service ? [body.service] : []).map(iiifId).filter(Boolean);
  const serviceImages = services.flatMap((service) => [`${String(service).replace(/\/$/, '')}/full/full/0/default.jpg`, `${String(service).replace(/\/$/, '')}/full/max/0/default.jpg`]);
  return [...originals, ...serviceImages, iiifId(body), ...downloads].filter((value) => /^https?:\/\//i.test(String(value || '')));
}

function iiifSkimUrls(imageUrls) {
  const serviceImages=imageUrls.filter((url)=>/\/full\/(?:full|max)\/0\/default\.jpg(?:\?|$)/i.test(String(url)));
  const reduced=serviceImages.map((url)=>String(url)
    .replace('/full/full/0/default.jpg','/full/1600,/0/default.jpg')
    .replace('/full/max/0/default.jpg','/full/1600,/0/default.jpg'));
  const boundedRenderings=imageUrls.filter((url)=>/[?&](?:HEI|WID)=\d+/i.test(String(url)));
  return [...new Set([...reduced,...boundedRenderings])];
}

function manifestIdentity(manifestUrl) {
  const parsed = new URL(manifestUrl);
  return parsed.pathname.match(/\/ark:\/\d+\/(vta[a-z0-9]+)/i)?.[1] || parsed.pathname.split('/').filter(Boolean).at(-2) || null;
}

function normalizeIiifManifestUrl(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:') throw new Error('A secure IIIF archive or manifest URL is required.');
  const morbihan = parsed.pathname.match(/\/ark:\/(\d+)\/(vta[a-z0-9]+)/i);
  if (morbihan && /(?:^|\.)patrimoines-archives\.morbihan\.fr$/i.test(parsed.hostname)) {
    return `${parsed.origin}/ark:/${morbihan[1]}/${morbihan[2]}/manifest`;
  }
  return parsed.toString();
}

async function readIiifManifest(response, manifestUrl) {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    const type = response.headers.get('content-type') || 'unknown content';
    throw new Error(`The archive returned ${type} instead of a JSON IIIF manifest. Use the archive viewer or manifest address for ${manifestUrl}.`);
  }
}

async function prepareIiif(manifestUrl, pageFrom, pageTo) {
  const normalizedManifestUrl = normalizeIiifManifestUrl(manifestUrl);
  const response = await fetch(normalizedManifestUrl, { credentials: 'include', cache: 'no-store' });
  if (!response.ok) throw new Error(`IIIF manifest returned HTTP ${response.status}`);
  const manifest = await readIiifManifest(response, normalizedManifestUrl), canvases = iiifCanvases(manifest);
  if (!canvases.length) throw new Error('This IIIF manifest contains no canvases.');
  const from = Number(pageFrom), to = Number(pageTo), direction = to >= from ? 1 : -1;
  if (![from, to].every(Number.isInteger) || from < 1 || to < 1 || from > canvases.length || to > canvases.length) throw new Error(`Choose pages between 1 and ${canvases.length}.`);
  if (Math.abs(to - from) > 500) throw new Error('One IIIF capture run is limited to 501 selected pages.');
  const allPages = canvases.map((canvas, index) => {
    const body = iiifBody(canvas), pageNumber = index + 1;
    const sourceUrl = canvas?.ligeoPermalink || iiifId(canvas);
    const imageUrls = iiifRenderings(canvas, body);
    if (!sourceUrl || !imageUrls.length) throw new Error(`Manifest page ${pageNumber} has no usable image reference.`);
    const skimUrls=iiifSkimUrls(imageUrls);
    return {
      pageNumber, sourceUrl, imageUrls, skimUrls, width:Number(canvas?.width || body?.width) || null,
      height:Number(canvas?.height || body?.height) || null, label:iiifLabel(canvas?.label).slice(0, 500), canvasId:iiifId(canvas),
    };
  });
  const queue = [];
  for (let pageNumber = from; direction > 0 ? pageNumber <= to : pageNumber >= to; pageNumber += direction) {
    queue.push(allPages[pageNumber - 1]);
  }
  const indexPages = allPages.map((page) => ({ pageNumber:page.pageNumber, sourceUrl:page.sourceUrl, width:page.width,
    height:page.height, label:page.label, metadata:{ canvasId:page.canvasId, imageUrls:page.imageUrls.slice(0, 6) } }));
  return { queue, indexPages, archiveId:manifestIdentity(normalizedManifestUrl), manifestUrl:normalizedManifestUrl,
    totalPages:canvases.length, title:iiifLabel(manifest?.label).slice(0, 500) };
}

async function schedule(delayMs) {
  await chrome.alarms.create('mastermind-archive-step', { when: Date.now() + Math.max(1500, Number(delayMs) || 2500) });
}

async function crawlNliStep(state) {
  const pageNumber = Number(state.nextPage), end = Number(state.pageTo), direction = end >= Number(state.pageFrom) ? 1 : -1;
  if ((direction > 0 && pageNumber > end) || (direction < 0 && pageNumber < end)) return false;
  const page = await inspectNli(String(state.registerId).replace(/\D/g, ''), pageNumber);
  await save({ status: `downloading page ${pageNumber}`, currentPage: pageNumber });
  const blob = await fetchImage(page.imageUrl), size = await dimensions(blob);
  await upload(blob, { adapter: 'nli-register-v1', registerId: String(state.registerId).replace(/\D/g, ''), pageNumber, sourceUrl: page.sourceUrl, imageUrl: page.imageUrl, filename: page.filename, ...size });
  await save({ status: `saved page ${pageNumber}`, processed: Number(state.processed) + 1, saved: Number(state.saved) + 1, bytesSaved: Number(state.bytesSaved) + blob.size, nextPage: pageNumber + direction, lastError: null });
  return true;
}

async function crawlIiifStep(state) {
  const queue = Array.isArray(state.iiifQueue) ? state.iiifQueue : [], index = Number(state.nextQueueIndex) || 0;
  if (index >= queue.length) return false;
  const page = queue[index];
  await save({ status: `downloading IIIF page ${page.pageNumber}`, currentPage: page.pageNumber });
  const fetched = await firstAvailableImage(page.imageUrls), measured = await dimensions(fetched.blob);
  await upload(fetched.blob, {
    adapter:'iiif-manifest-v1', archiveId:state.archiveId, registerId:state.archiveId, manifestUrl:state.manifestUrl,
    pageNumber:page.pageNumber, sourceUrl:page.sourceUrl, imageUrl:fetched.imageUrl,
    filename:`${state.archiveId || 'iiif'}-${String(page.pageNumber).padStart(4, '0')}.${fetched.blob.type === 'image/png' ? 'png' : 'jpg'}`,
    width:measured.width || page.width, height:measured.height || page.height, label:page.label, manifestTitle:state.manifestTitle,
  });
  await save({ status:`saved IIIF page ${page.pageNumber}`, processed:Number(state.processed) + 1, saved:Number(state.saved) + 1,
    bytesSaved:Number(state.bytesSaved) + fetched.blob.size, nextQueueIndex:index + 1, lastError:null });
  return true;
}

async function crawlIiifIndexStep(state) {
  const queue=Array.isArray(state.iiifQueue)?state.iiifQueue:[],index=Number(state.nextQueueIndex)||0;
  if(index>=queue.length)return false;
  const page=queue[index];
  await save({status:`skimming names and dates on page ${page.pageNumber}`,currentPage:page.pageNumber});
  const fetched=await firstAvailableImage(page.skimUrls||page.imageUrls);
  await uploadIndexProbe(fetched.blob,{pageNumber:page.pageNumber,sourceUrl:page.sourceUrl,imageUrl:fetched.imageUrl,
    archiveId:state.archiveId,manifestUrl:state.manifestUrl,width:page.width,height:page.height});
  await save({status:`indexed page ${page.pageNumber}`,processed:Number(state.processed)+1,indexed:Number(state.indexed)+1,
    nextQueueIndex:index+1,lastError:null});
  return true;
}

async function crawlIiifExtractionStep(state){
  const queue=Array.isArray(state.iiifQueue)?state.iiifQueue:[],index=Number(state.nextQueueIndex)||0;if(index>=queue.length)return false;
  const page=queue[index];await save({status:`extracting every record on page ${page.pageNumber}`,currentPage:page.pageNumber});
  const fetched=await firstAvailableImage(page.imageUrls);
  await uploadRecordExtraction(fetched.blob,{pageNumber:page.pageNumber,sourceUrl:page.sourceUrl,imageUrl:fetched.imageUrl,archiveId:state.archiveId,manifestUrl:state.manifestUrl,width:page.width,height:page.height});
  await save({status:`structured page ${page.pageNumber}`,processed:Number(state.processed)+1,extracted:Number(state.extracted)+1,nextQueueIndex:index+1,lastError:null});return true;
}

async function crawlIiifLibraryStep(state){
  const queue=Array.isArray(state.iiifQueue)?state.iiifQueue:[],index=Number(state.nextQueueIndex)||0;if(index>=queue.length)return false;
  const page=queue[index];await save({status:`archiving ordered page ${page.pageNumber}`,currentPage:page.pageNumber});
  const fetched=await firstAvailableImage(page.imageUrls),measured=await dimensions(fetched.blob);
  const metadata={adapter:'iiif-training-library-v1',archiveId:state.archiveId,registerId:state.archiveId,manifestUrl:state.manifestUrl,pageNumber:page.pageNumber,
    sourceUrl:page.sourceUrl,imageUrl:fetched.imageUrl,filename:`${state.archiveId||'iiif'}-${String(page.pageNumber).padStart(4,'0')}.${fetched.blob.type==='image/png'?'png':'jpg'}`,
    width:measured.width||page.width,height:measured.height||page.height,label:page.label,manifestTitle:state.manifestTitle};
  const captured=await upload(fetched.blob,metadata);
  await save({status:`detecting date on page ${page.pageNumber}`});
  await uploadIndexProbe(fetched.blob,{...metadata,mode:'date_only'});
  await save({status:`library page ${page.pageNumber} ready`,processed:Number(state.processed)+1,saved:Number(state.saved)+1,indexed:Number(state.indexed)+1,
    bytesSaved:Number(state.bytesSaved)+(captured.asset?.created?fetched.blob.size:0),nextQueueIndex:index+1,lastError:null});return true;
}

async function crawlStep() {
  const state = await stored();
  if (!state.running) return;
  const now=Date.now(),started=Number(state.stepStartedAt)||0;
  if(started&&now-started<110000){await schedule(15000);return;}
  const queueIndex=state.archiveKind==='iiif'?Number(state.nextQueueIndex)||0:Number(state.nextPage)||0;
  await save({stepStartedAt:now,stepQueueIndex:queueIndex});
  await chrome.alarms.create('mastermind-archive-step',{when:now+120000});
  try {
    const progressed = state.archiveKind === 'iiif' ? (state.operation==='skim'?await crawlIiifIndexStep(state):state.operation==='extract'?await crawlIiifExtractionStep(state):state.operation==='library'?await crawlIiifLibraryStep(state):await crawlIiifStep(state)) : await crawlNliStep(state);
    if (!progressed) { await save({ running:false, status:'complete', currentPage:null, iiifQueue:[],stepStartedAt:null,stepQueueIndex:null,pageRetryCount:0 }); return; }
  } catch (error) {
    const retry=Number(state.pageRetryCount)||0,message=error instanceof Error?error.message:String(error);
    if(retry<3){await save({status:`retrying page ${state.currentPage||queueIndex} (${retry+1}/3)`,running:true,failed:Number(state.failed)+1,lastError:message,stepStartedAt:null,stepQueueIndex:null,pageRetryCount:retry+1});await schedule(15000);return;}
    await save({ status: 'capture stopped after 3 retries', running: false, failed: Number(state.failed) + 1, lastError: message,stepStartedAt:null,stepQueueIndex:null });
    return;
  }
  await save({stepStartedAt:null,stepQueueIndex:null,pageRetryCount:0});const fresh = await stored();
  if (fresh.running) await schedule(fresh.delayMs);
}

async function largestVisibleImage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const images = [...document.images].filter((image) => image.currentSrc || image.src).map((image) => ({
        url: image.currentSrc || image.src, width: image.naturalWidth || image.width, height: image.naturalHeight || image.height,
        alt: String(image.alt || '').slice(0, 500), visible: image.getBoundingClientRect().width > 20 && image.getBoundingClientRect().height > 20,
      })).filter((image) => image.visible).sort((a, b) => (b.width * b.height) - (a.width * a.height));
      return { pageUrl: location.href, title: document.title.slice(0, 500), image: images[0] || null };
    },
  });
  return result;
}

async function captureCurrent() {
  const state = await stored(), pair = await pairing(false);
  if (pair.status !== 'approved') throw new Error('Approve this extension in Mastermind Genealogy first.');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active archive tab');
  const found = await largestVisibleImage(tab.id);
  if (!found?.image?.url) throw new Error('No visible archive image was found on this page');
  const blob = await fetchImage(found.image.url);
  const registerId = found.pageUrl.match(/vtls(\d{6,18})/i)?.[1] || null;
  const pageNumber = Number(found.pageUrl.match(/_(\d+)(?:\D|$)/)?.[1]) || null;
  const result = await upload(blob, { adapter: 'generic-visible-image-v1', registerId, pageNumber, sourceUrl: found.pageUrl, imageUrl: found.image.url, filename: `archive-page.${blob.type === 'image/png' ? 'png' : 'jpg'}`, width: found.image.width || null, height: found.image.height || null, title: found.title, alt: found.image.alt });
  await save({ status: 'current page saved', processed: Number(state.processed) + 1, saved: Number(state.saved) + 1, bytesSaved: Number(state.bytesSaved) + blob.size, lastError: null });
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'MM_STATUS') return statusInfo();
    if (message.type === 'MM_CONFIG') { await save(message.config || {}); return { ok: true, state: await stored() }; }
    if (message.type === 'MM_CONNECT') {
      const pair = await pairing(true), state = await stored();
      if (pair.status !== 'approved') await chrome.tabs.create({ url: `${state.apiBase}/?tab=genealogy` });
      await save({ status: pair.status === 'approved' ? 'paired' : 'approval required', lastError: null });
      return { ok: true, pairing: pair };
    }
    if (message.type === 'MM_START_NLI') {
      const pair = await pairing(false);
      if (pair.status !== 'approved') throw new Error('Approve this extension in Mastermind Genealogy first.');
      const mission = message.mission || {};
      if (!/^\d{6,18}$/.test(String(mission.registerId)) || !Number.isInteger(Number(mission.pageFrom)) || !Number.isInteger(Number(mission.pageTo))) throw new Error('A valid register and bounded page range are required');
      if (Math.abs(Number(mission.pageTo) - Number(mission.pageFrom)) > 5000) throw new Error('One capture run is limited to 5,001 pages');
      await chrome.alarms.clear('mastermind-archive-step');
      const registerId = String(mission.registerId);
      const jobId = await resolveJobId('nli', registerId, mission.jobId,
        `https://registers.nli.ie/pages/vtls${registerId}_001`);
      await save({ ...mission, jobId, archiveKind:'nli', running: true, status: 'starting archive capture', processed: 0, saved: 0, failed: 0, bytesSaved: 0, currentPage: null, nextPage: Number(mission.pageFrom), iiifQueue:[], lastError: null });
      await crawlStep();
      return { ok: true, state: await stored() };
    }
    if (message.type === 'MM_START_IIIF') {
      const pair = await pairing(false);
      if (pair.status !== 'approved') throw new Error('Approve this extension in Mastermind Genealogy first.');
      const mission = message.mission || {}, suppliedUrl = String(mission.manifestUrl || '').trim();
      if (!/^https:\/\//i.test(suppliedUrl)) throw new Error('A secure IIIF archive or manifest URL is required.');
      const prepared = await prepareIiif(suppliedUrl, Number(mission.pageFrom), Number(mission.pageTo));
      const manifestUrl = prepared.manifestUrl;
      if (!prepared.archiveId) throw new Error('The IIIF archive identity could not be read from the manifest URL.');
      const jobId = await resolveJobId('morbihan-iiif', prepared.archiveId, mission.jobId, manifestUrl, manifestUrl);
      await save({ status:`indexing ${prepared.totalPages} manifest pages`, currentPage:null });
      await indexManifest(jobId, prepared.archiveId, manifestUrl, prepared.title, prepared.indexPages);
      await chrome.alarms.clear('mastermind-archive-step');
      await save({ ...mission, jobId, manifestUrl, archiveKind:'iiif', operation:'capture', archiveId:prepared.archiveId, manifestTitle:prepared.title,
        totalPages:prepared.totalPages, iiifQueue:prepared.queue, nextQueueIndex:0, running:true, status:'starting IIIF capture',
        processed:0, saved:0, indexed:0, failed:0, bytesSaved:0, currentPage:null, lastError:null });
      await crawlStep();
      return { ok:true, state:await stored() };
    }
    if(message.type==='MM_START_IIIF_INDEX'){
      const pair=await pairing(false);if(pair.status!=='approved')throw new Error('Approve this extension in Mastermind Genealogy first.');
      const mission=message.mission||{},suppliedUrl=String(mission.manifestUrl||'').trim();
      if(!/^https:\/\//i.test(suppliedUrl))throw new Error('A secure IIIF archive or manifest URL is required.');
      const prepared=await prepareIiif(suppliedUrl,Number(mission.pageFrom),Number(mission.pageTo)),manifestUrl=prepared.manifestUrl;
      if(!prepared.archiveId)throw new Error('The IIIF archive identity could not be read from the manifest URL.');
      const jobId=await resolveJobId('morbihan-iiif',prepared.archiveId,mission.jobId,manifestUrl,manifestUrl);
      await save({status:`indexing ${prepared.totalPages} manifest pages`,currentPage:null});
      await indexManifest(jobId,prepared.archiveId,manifestUrl,prepared.title,prepared.indexPages);
      await chrome.alarms.clear('mastermind-archive-step');
      await save({...mission,jobId,manifestUrl,archiveKind:'iiif',operation:'skim',archiveId:prepared.archiveId,manifestTitle:prepared.title,
        totalPages:prepared.totalPages,iiifQueue:prepared.queue,nextQueueIndex:0,running:true,status:'starting fast name/date index',
        processed:0,saved:0,indexed:0,failed:0,bytesSaved:0,currentPage:null,lastError:null});
      await crawlStep();return{ok:true,state:await stored()};
    }
    if(message.type==='MM_START_IIIF_EXTRACT'){
      const pair=await pairing(false);if(pair.status!=='approved')throw new Error('Approve this extension in Mastermind Genealogy first.');
      const mission=message.mission||{},suppliedUrl=String(mission.manifestUrl||'').trim();if(!/^https:\/\//i.test(suppliedUrl))throw new Error('A secure IIIF archive or manifest URL is required.');
      const prepared=await prepareIiif(suppliedUrl,Number(mission.pageFrom),Number(mission.pageTo)),manifestUrl=prepared.manifestUrl;if(!prepared.archiveId)throw new Error('The IIIF archive identity could not be read from the manifest URL.');
      const jobId=await resolveJobId('morbihan-iiif',prepared.archiveId,mission.jobId,manifestUrl,manifestUrl);await save({status:`indexing ${prepared.totalPages} manifest pages`,currentPage:null});
      await indexManifest(jobId,prepared.archiveId,manifestUrl,prepared.title,prepared.indexPages);await chrome.alarms.clear('mastermind-archive-step');
      await save({...mission,jobId,manifestUrl,archiveKind:'iiif',operation:'extract',archiveId:prepared.archiveId,manifestTitle:prepared.title,totalPages:prepared.totalPages,
        iiifQueue:prepared.queue,nextQueueIndex:0,running:true,status:'starting overnight record extraction',processed:0,saved:0,indexed:0,extracted:0,failed:0,bytesSaved:0,currentPage:null,lastError:null});
      await crawlStep();return{ok:true,state:await stored()};
    }
    if(message.type==='MM_START_IIIF_LIBRARY'){
      const pair=await pairing(false);if(pair.status!=='approved')throw new Error('Approve this extension in Mastermind Genealogy first.');
      const mission=message.mission||{},suppliedUrl=String(mission.manifestUrl||'').trim();if(!/^https:\/\//i.test(suppliedUrl))throw new Error('A secure IIIF archive or manifest URL is required.');
      const prepared=await prepareIiif(suppliedUrl,Number(mission.pageFrom),Number(mission.pageTo)),manifestUrl=prepared.manifestUrl;if(!prepared.archiveId)throw new Error('The IIIF archive identity could not be read from the manifest URL.');
      const jobId=await resolveJobId('morbihan-iiif',prepared.archiveId,mission.jobId,manifestUrl,manifestUrl);await save({status:`indexing ${prepared.totalPages} manifest pages`,currentPage:null});
      await indexManifest(jobId,prepared.archiveId,manifestUrl,prepared.title,prepared.indexPages);await chrome.alarms.clear('mastermind-archive-step');
      const prior=await stored(),resume=prior.operation==='library'&&prior.manifestUrl===manifestUrl&&Number(prior.pageFrom)===Number(mission.pageFrom)&&Number(prior.pageTo)===Number(mission.pageTo)&&Number(prior.nextQueueIndex)>0&&Number(prior.nextQueueIndex)<prepared.queue.length;
      await save({...mission,jobId,manifestUrl,archiveKind:'iiif',operation:'library',archiveId:prepared.archiveId,manifestTitle:prepared.title,totalPages:prepared.totalPages,
        iiifQueue:prepared.queue,nextQueueIndex:resume?Number(prior.nextQueueIndex):0,running:true,status:resume?'resuming ordered date library':'starting ordered date library',
        processed:resume?Number(prior.processed)||0:0,saved:resume?Number(prior.saved)||0:0,indexed:resume?Number(prior.indexed)||0:0,extracted:0,failed:resume?Number(prior.failed)||0:0,bytesSaved:resume?Number(prior.bytesSaved)||0:0,currentPage:null,lastError:null});
      await crawlStep();return{ok:true,state:await stored()};
    }
    if (message.type === 'MM_STOP') { await chrome.alarms.clear('mastermind-archive-step'); await save({ running: false, status: 'stopped' }); return { ok: true }; }
    if (message.type === 'MM_CAPTURE_CURRENT') return { ok: true, result: await captureCurrent() };
    return { ok: false, error: 'Unknown archive-capture command' };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  return true;
});

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'mastermind-archive-step') crawlStep(); });
stored().then((state)=>{if(state.running)chrome.alarms.create('mastermind-archive-step',{when:Date.now()+2000});}).catch(()=>{});
