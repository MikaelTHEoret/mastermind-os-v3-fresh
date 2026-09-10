const $ = (id) => document.getElementById(id);
const command = (message) => chrome.runtime.sendMessage(message);

function status(title, detail, error = '') {
  $('status').replaceChildren();
  const strong = document.createElement('strong'); strong.textContent = title;
  const span = document.createElement('span'); span.textContent = detail;
  $('status').append(strong, span);
  if (error) { const em = document.createElement('em'); em.textContent = error; $('status').append(em); }
}

function setPair(value) {
  const badge = $('pairBadge'); badge.textContent = String(value || 'offline').toUpperCase();
  badge.className = `badge ${value === 'approved' ? 'ok' : value === 'pending' ? 'wait' : ''}`;
  $('start').disabled = value !== 'approved'; $('library').disabled = value !== 'approved'; $('index').disabled = value !== 'approved'; $('extract').disabled = value !== 'approved'; $('capture').disabled = value !== 'approved';
}

function showArchiveFields() {
  const iiif = $('archiveKind').value === 'iiif';
  $('manifestField').classList.toggle('hidden', !iiif);
  $('registerField').classList.toggle('hidden', iiif);
}

async function refresh() {
  const result = await command({ type: 'MM_STATUS' }), state = result.state || {}, pair = result.pairing?.status || 'offline';
  setPair(pair);
  if (state.jobId) $('jobId').value = state.jobId;
  const mib = ((Number(state.bytesSaved) || 0) / 1048576).toFixed(1);
  status(state.status || 'idle', `${state.processed || 0} pages processed · ${state.saved || 0} saved · ${state.indexed || 0} indexed · ${state.extracted || 0} extracted · ${mib} MB${state.currentPage ? ` · page ${state.currentPage}` : ''}`, state.lastError || '');
}

async function saveConfig() {
  const config = { apiBase: $('apiBase').value.trim().replace(/\/$/, ''), jobId: Number($('jobId').value), archiveKind:$('archiveKind').value,
    manifestUrl:$('manifestUrl').value.trim(), registerId:$('registerId').value.trim(), pageFrom:Number($('pageFrom').value),
    pageTo:Number($('pageTo').value), delayMs: Number($('delayMs').value) };
  const result = await command({ type: 'MM_CONFIG', config });
  if (!result?.ok) throw new Error(result?.error || 'Could not save capture settings');
}

$('connect').onclick = async () => {
  try { await saveConfig(); const result = await command({ type: 'MM_CONNECT' }); if (!result?.ok) throw new Error(result?.error); setPair(result.pairing?.status); status('Connection requested', result.pairing?.status === 'approved' ? 'Mastermind is ready.' : 'Approve Chrome archive capture in the Genealogy tab that just opened.'); }
  catch (error) { status('Connection failed', 'Start the local Mastermind command center, then try again.', String(error)); }
};

$('start').onclick = async () => {
  try {
    await saveConfig(); status('Starting', 'Preparing the first archive image…');
    const mission = { jobId:Number($('jobId').value), pageFrom:Number($('pageFrom').value), pageTo:Number($('pageTo').value) };
    let result;
    if ($('archiveKind').value === 'iiif') {
      const manifestUrl = $('manifestUrl').value.trim(), origin = new URL(manifestUrl).origin;
      const granted = await chrome.permissions.request({ origins:[`${origin}/*`] });
      if (!granted) throw new Error('Site access was not granted');
      result = await command({ type:'MM_START_IIIF', mission:{ ...mission, manifestUrl } });
    } else {
      result = await command({ type:'MM_START_NLI', mission:{ ...mission, registerId:$('registerId').value.trim().replace(/\D/g, '') } });
    }
    if (!result?.ok) throw new Error(result?.error || 'Capture worker could not start');
    await refresh();
  } catch (error) { status('Start failed', 'No pages were queued.', String(error)); }
};

$('stop').onclick = async () => { await command({ type: 'MM_STOP' }); await refresh(); };

$('library').onclick=async()=>{
  try{
    await saveConfig();
    if($('archiveKind').value!=='iiif')throw new Error('The ordered training library currently requires an IIIF manifest.');
    const manifestUrl=$('manifestUrl').value.trim(),origin=new URL(manifestUrl).origin;
    const granted=await chrome.permissions.request({origins:[`${origin}/*`]});if(!granted)throw new Error('Site access was not granted');
    status('Building ordered library','Saving each original once and reading dates/layout only…');
    const mission={jobId:Number($('jobId').value),manifestUrl,pageFrom:Number($('pageFrom').value),pageTo:Number($('pageTo').value)};
    const result=await command({type:'MM_START_IIIF_LIBRARY',mission});if(!result?.ok)throw new Error(result?.error||'Ordered library could not start');
    await refresh();
  }catch(error){status('Library failed','The completed pages remain safely stored and can be resumed.',String(error));}
};

$('index').onclick=async()=>{
  try{
    await saveConfig();
    if($('archiveKind').value!=='iiif')throw new Error('Fast indexing currently requires an IIIF manifest.');
    const manifestUrl=$('manifestUrl').value.trim(),origin=new URL(manifestUrl).origin;
    const granted=await chrome.permissions.request({origins:[`${origin}/*`]});if(!granted)throw new Error('Site access was not granted');
    status('Starting fast index','Extracting only page type, names, dates, and place terms…');
    const mission={jobId:Number($('jobId').value),manifestUrl,pageFrom:Number($('pageFrom').value),pageTo:Number($('pageTo').value)};
    const result=await command({type:'MM_START_IIIF_INDEX',mission});if(!result?.ok)throw new Error(result?.error||'Fast index could not start');
    await refresh();
  }catch(error){status('Index failed','No full transcription was attempted.',String(error));}
};

$('extract').onclick=async()=>{
  try{
    await saveConfig();
    if($('archiveKind').value!=='iiif')throw new Error('Structured overnight extraction currently requires an IIIF manifest.');
    const manifestUrl=$('manifestUrl').value.trim(),origin=new URL(manifestUrl).origin;
    const granted=await chrome.permissions.request({origins:[`${origin}/*`]});if(!granted)throw new Error('Site access was not granted');
    status('Starting overnight extraction','Reading every record and connected person; source images remain transient…');
    const mission={jobId:Number($('jobId').value),manifestUrl,pageFrom:Number($('pageFrom').value),pageTo:Number($('pageTo').value)};
    const result=await command({type:'MM_START_IIIF_EXTRACT',mission});if(!result?.ok)throw new Error(result?.error||'Structured extraction could not start');
    await refresh();
  }catch(error){status('Extraction failed','No source image was retained.',String(error));}
};

$('capture').onclick = async () => {
  try {
    await saveConfig();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) throw new Error('No active web page');
    const origin = new URL(tab.url).origin;
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) throw new Error('Site access was not granted');
    status('Capturing', 'Reading the largest visible archive image…');
    const result = await command({ type: 'MM_CAPTURE_CURRENT' }); if (!result?.ok) throw new Error(result?.error || 'Page capture failed');
    await refresh();
  } catch (error) { status('Capture failed', 'The page was left unchanged.', String(error)); }
};

const popupDefaults = { apiBase:'http://127.0.0.1:3000', jobId:1, archiveKind:'iiif',
  manifestUrl:'https://rechercher.patrimoines-archives.morbihan.fr/ark:/15049/vta54487c774652a/manifest',
  registerId:'000631963', pageFrom:1, pageTo:1, delayMs:2500 };
chrome.storage.local.get(null).then((current) => {
  const state = { ...popupDefaults, ...current };
  if (Number(current.configVersion) < 2) Object.assign(state, { archiveKind:'iiif', manifestUrl:popupDefaults.manifestUrl, pageFrom:1, pageTo:1 });
  for (const id of ['apiBase', 'jobId', 'archiveKind', 'manifestUrl', 'registerId', 'pageFrom', 'pageTo', 'delayMs']) $(id).value = state[id];
  showArchiveFields();
});
$('archiveKind').onchange=showArchiveFields;
refresh(); setInterval(refresh, 2000);
