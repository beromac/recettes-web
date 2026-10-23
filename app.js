// Mes Recettes — application web (PWA) 100% locale.
// Les données restent sur votre téléphone (localStorage). La clé API Claude aussi.

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const titleEl = $('#title');
const backBtn = $('#btn-back');

const CATEGORIES = {
  fruits_legumes: '🥬 Fruits & légumes',
  viande_poisson: '🥩 Viande & poisson',
  cremerie: '🧀 Crèmerie & œufs',
  boulangerie: '🥖 Boulangerie',
  epicerie: '🥫 Épicerie',
  surgele: '🧊 Surgelés',
  boissons: '🥤 Boissons',
  autre: '🛍️ Autre',
};

// ---------- Stockage ----------
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const state = {
  recipes: load('recipes', []),
  shopping: load('shopping', []),
  settings: load('settings', { provider: 'gemini', apiKey: '', model: '' }),
};
const persist = () => { save('recipes', state.recipes); save('shopping', state.shopping); save('settings', state.settings); };

// ---------- Utilitaires ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500);
}
function fmtQty(q) {
  if (q == null || q === '') return '';
  const n = Number(q);
  if (!isFinite(n)) return String(q);
  const fr = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.33: '⅓', 0.67: '⅔' };
  const whole = Math.floor(n), dec = Math.round((n - whole) * 100) / 100;
  if (dec === 0) return String(whole);
  const key = Object.keys(fr).find(k => Math.abs(k - dec) < 0.02);
  if (key) return (whole ? whole + ' ' : '') + fr[key];
  return String(Math.round(n * 100) / 100).replace('.', ',');
}
const ingLine = (i, factor = 1) => {
  const q = i.qty != null ? fmtQty(i.qty * factor) : '';
  return [q, i.unit, i.name].filter(Boolean).join(' ') + (i.note ? ` (${i.note})` : '');
};
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// ---------- Appel Claude ----------
const SYSTEM_PROMPT = `Tu es un assistant culinaire. On te donne le texte d'une vidéo de recette (légende de réseau social et/ou transcription de l'audio, souvent imparfaite).
Tu produis UNE recette claire en français. Réponds UNIQUEMENT avec un objet JSON valide, sans texte autour, sans balises markdown, au format :
{
  "title": "Nom de la recette",
  "emoji": "un emoji représentatif",
  "servings": 4,
  "prep_minutes": 15,
  "cook_minutes": 30,
  "tags": ["dessert", "rapide"],
  "ingredients": [
    {"qty": 200, "unit": "g", "name": "farine", "note": "tamisée", "category": "epicerie"}
  ],
  "steps": ["Étape 1 …", "Étape 2 …"],
  "tips": "Astuces éventuelles ou chaîne vide"
}
Règles :
- "qty" est un nombre (ou null si non précisé, ex. "sel"), "unit" une chaîne courte (g, kg, ml, cl, l, c. à soupe, c. à café, pincée, tranche…) ou "" si aucune.
- "category" vaut exactement l'une de : fruits_legumes, viande_poisson, cremerie, boulangerie, epicerie, surgele, boissons, autre.
- Si le texte contient des quantités approximatives ou absentes, estime des quantités raisonnables pour "servings" personnes et ne les invente pas de façon absurde.
- Les étapes sont courtes, ordonnées, à l'impératif, avec températures et durées quand elles sont citées.
- Ne rajoute pas d'ingrédients absents de la vidéo, sauf sel/poivre/huile évidents.
- Si le texte ne contient pas de recette, renvoie {"error": "Aucune recette trouvée dans ce texte."}.`;

const PROVIDERS = {
  gemini: { name: 'Google Gemini (gratuit)', model: 'gemini-2.5-flash', link: 'aistudio.google.com/apikey', ph: 'AIza…' },
  claude: { name: 'Claude (payant)', model: 'claude-sonnet-5-5', link: 'console.anthropic.com', ph: 'sk-ant-…' },
};

async function askClaude(text, sourceUrl) {
  const { apiKey } = state.settings;
  const provider = state.settings.provider || 'gemini';
  const model = state.settings.model || PROVIDERS[provider].model;
  if (!apiKey) throw new Error('Ajoutez d\'abord votre clé API dans les réglages (⚙︎).');
  const userMsg = (sourceUrl ? `Lien de la vidéo : ${sourceUrl}\n\n` : '') + `Texte de la vidéo :\n"""\n${text}\n"""`;
  let res;
  if (provider === 'gemini') {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
      }),
    });
  } else {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: 3000, system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userMsg }] }),
    });
  }
  if (!res.ok) {
    let m = `Erreur ${res.status}`;
    try { const j = await res.json(); m += ' : ' + (j.error?.message || ''); } catch {}
    if (res.status === 401 || res.status === 403 || (res.status === 400 && /API key/i.test(m))) m = 'Clé API invalide. Vérifiez-la dans les réglages.';
    if (res.status === 429) m = 'Limite gratuite atteinte. Patientez une minute (ou demain) et réessayez.';
    throw new Error(m);
  }
  const data = await res.json();
  const raw = (provider === 'gemini'
    ? (data.candidates?.[0]?.content?.parts || []).map(b => b.text || '').join('')
    : (data.content || []).map(b => b.text || '').join('')).trim();
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let r;
  try { r = JSON.parse(json); } catch { throw new Error('Réponse illisible, réessayez.'); }
  if (r.error) throw new Error(r.error);
  if (!r.title || !Array.isArray(r.ingredients) || !Array.isArray(r.steps)) throw new Error('Recette incomplète, réessayez.');
  return r;
}

// ---------- Transcription vidéo (Whisper dans le navigateur) ----------
let asrPromise = null;
async function getAsr(onProgress) {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3');
      env.allowLocalModels = false;
      return pipeline('automatic-speech-recognition', 'Xenova/whisper-base', {
        dtype: 'q8',
        progress_callback: p => { if (p.status === 'progress') onProgress?.(`Téléchargement du modèle… ${Math.round(p.progress || 0)}%`, p.progress || 0); },
      });
    })().catch(e => { asrPromise = null; throw e; });
  }
  return asrPromise;
}
async function decodeAudio(file) {
  const buf = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC({ sampleRate: 16000 });
  const audio = await new Promise((ok, ko) => ctx.decodeAudioData(buf, ok, ko));
  const ch = audio.numberOfChannels;
  const out = new Float32Array(audio.length);
  for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < d.length; i++) out[i] += d[i] / ch; }
  ctx.close?.();
  return out;
}
async function transcribeVideo(file, onProgress) {
  onProgress('Extraction du son…', 0);
  let audio;
  try { audio = await decodeAudio(file); }
  catch { throw new Error('Impossible de lire le son de cette vidéo. Essayez un fichier .mp4 ou .mov.'); }
  const asr = await getAsr(onProgress);
  onProgress('Transcription en cours (peut prendre 1 à 3 minutes)…', 100);
  const out = await asr(audio, { language: 'french', task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 });
  return (out.text || '').trim();
}

// ---------- Courses ----------
function addToShopping(recipe, factor) {
  let added = 0;
  for (const ing of recipe.ingredients) {
    const key = norm(ing.name), unit = norm(ing.unit);
    const q = ing.qty != null ? ing.qty * factor : null;
    const ex = state.shopping.find(s => !s.done && norm(s.name) === key && norm(s.unit) === unit);
    if (ex) {
      if (ex.qty != null && q != null) ex.qty += q;
      if (!ex.from.includes(recipe.title)) ex.from.push(recipe.title);
    } else {
      state.shopping.push({ id: uid(), name: ing.name, qty: q, unit: ing.unit || '', category: CATEGORIES[ing.category] ? ing.category : 'autre', done: false, from: [recipe.title] });
    }
    added++;
  }
  persist();
  return added;
}

// ---------- Navigation ----------
let currentTab = 'recipes';
function setTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ({ recipes: viewRecipes, add: viewAdd, shopping: viewShopping })[tab]();
}
document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => setTab(b.dataset.tab));
$('#btn-settings').onclick = viewSettings;
function header(title, back) {
  titleEl.textContent = title;
  backBtn.classList.toggle('hidden', !back);
  backBtn.onclick = back || null;
  window.scrollTo(0, 0);
}

// ---------- Vue : liste des recettes ----------
function viewRecipes() {
  header('Mes recettes');
  if (!state.recipes.length) {
    view.innerHTML = `<div class="empty"><div class="big">🍳</div><p><b>Aucune recette pour l'instant</b></p>
      <p>Ajoutez votre première recette depuis une vidéo Instagram ou Facebook.</p>
      <button class="btn" id="go-add">Ajouter une recette</button></div>`;
    $('#go-add').onclick = () => setTab('add');
    return;
  }
  view.innerHTML = `<input id="q" type="search" placeholder="Rechercher une recette ou un ingrédient…">
    <div id="list"></div>`;
  const render = () => {
    const q = norm($('#q').value);
    const items = state.recipes.filter(r => !q || norm(r.title).includes(q) || r.ingredients.some(i => norm(i.name).includes(q)) || (r.tags || []).some(t => norm(t).includes(q)));
    $('#list').innerHTML = items.map(r => `
      <div class="card recipe-item" data-id="${r.id}">
        <div class="emoji">${esc(r.emoji || '🍽️')}</div>
        <div><div class="t">${esc(r.title)}</div>
        <div class="muted">${r.servings || '?'} pers.${r.prep_minutes || r.cook_minutes ? ` · ${(+r.prep_minutes || 0) + (+r.cook_minutes || 0)} min` : ''} · ${r.ingredients.length} ingrédients</div></div>
      </div>`).join('') || '<p class="empty">Aucun résultat.</p>';
    document.querySelectorAll('.recipe-item').forEach(el => el.onclick = () => viewRecipe(el.dataset.id));
  };
  $('#q').oninput = render; render();
}

// ---------- Vue : détail d'une recette ----------
function viewRecipe(id, tab = 'ing') {
  const r = state.recipes.find(x => x.id === id);
  if (!r) return viewRecipes();
  header(r.title, viewRecipes);
  r._servings ??= r.servings || 4;
  const factor = r._servings / (r.servings || 4);
  r._done ??= [];
  const total = (+r.prep_minutes || 0) + (+r.cook_minutes || 0);
  view.innerHTML = `
    <div class="card">
      <div style="font-size:42px">${esc(r.emoji || '🍽️')}</div>
      <div class="chips">
        ${r.prep_minutes ? `<span class="chip">⏱ Prépa ${r.prep_minutes} min</span>` : ''}
        ${r.cook_minutes ? `<span class="chip">🔥 Cuisson ${r.cook_minutes} min</span>` : ''}
        ${total ? `<span class="chip">Total ${total} min</span>` : ''}
        ${(r.tags || []).map(t => `<span class="chip">${esc(t)}</span>`).join('')}
      </div>
      <div class="servings"><span>Pour</span><button id="minus">−</button><b>${r._servings}</b><button id="plus">+</button><span>personnes</span></div>
      ${r.source ? `<p class="muted" style="margin:10px 0 0">Source : <a href="${esc(r.source)}" target="_blank" rel="noopener">voir la vidéo ↗</a></p>` : ''}
    </div>
    <div class="tabs"><button data-t="ing" class="${tab === 'ing' ? 'on' : ''}">Ingrédients</button><button data-t="steps" class="${tab === 'steps' ? 'on' : ''}">Étapes</button></div>
    <div id="body" class="card"></div>
    ${r.tips ? `<div class="hint">💡 ${esc(r.tips)}</div>` : ''}
    <button class="btn" id="add-shop">🛒 Ajouter à ma liste de courses</button>
    <div class="row"><button class="btn secondary" id="share">Partager</button><button class="btn danger" id="del">Supprimer</button></div>`;

  const body = $('#body');
  if (tab === 'ing') {
    body.innerHTML = r.ingredients.map(i => `<div class="ing"><span>•</span><span>${esc(ingLine(i, factor))}</span></div>`).join('');
  } else {
    body.innerHTML = r.steps.map((s, i) => `<div class="step ${r._done.includes(i) ? 'done' : ''}" data-i="${i}"><div class="n">${i + 1}</div><div>${esc(s)}</div></div>`).join('')
      + `<p class="muted">Touchez une étape pour la cocher.</p>`;
    body.querySelectorAll('.step').forEach(el => el.onclick = () => {
      const i = +el.dataset.i;
      r._done = r._done.includes(i) ? r._done.filter(x => x !== i) : [...r._done, i];
      el.classList.toggle('done'); persist();
    });
  }
  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => viewRecipe(id, b.dataset.t));
  const step = d => { r._servings = Math.max(1, r._servings + d); persist(); viewRecipe(id, tab); };
  $('#minus').onclick = () => step(-1); $('#plus').onclick = () => step(1);
  $('#add-shop').onclick = () => { const n = addToShopping(r, factor); toast(`${n} ingrédients ajoutés aux courses`); };
  $('#share').onclick = async () => {
    const text = `${r.emoji || ''} ${r.title}\nPour ${r._servings} personnes\n\nIngrédients :\n${r.ingredients.map(i => '- ' + ingLine(i, factor)).join('\n')}\n\nÉtapes :\n${r.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
    try { if (navigator.share) await navigator.share({ title: r.title, text }); else { await navigator.clipboard.writeText(text); toast('Recette copiée'); } } catch {}
  };
  $('#del').onclick = () => {
    if (!confirm('Supprimer cette recette ?')) return;
    state.recipes = state.recipes.filter(x => x.id !== id); persist(); viewRecipes();
  };
}

// ---------- Partage depuis une autre app (Android) ----------
let prefill = null;
(function readShare() {
  const p = new URLSearchParams(location.search);
  if (!p.has('text') && !p.has('url') && !p.has('title')) return;
  const text = [p.get('title'), p.get('text')].filter(Boolean).join('\n');
  const found = (p.get('url') || text).match(/https?:\/\/[^\s]+/);
  const url = p.get('url') || (found ? found[0] : '');
  prefill = { url, text: text.replace(url, '').trim() };
  history.replaceState(null, '', location.pathname);
})();

// ---------- Vue : ajouter une recette ----------
function viewAdd() {
  header('Nouvelle recette');
  view.innerHTML = `
    <div class="hint">💡 Dans Instagram/Facebook : ouvrez la vidéo, copiez la <b>légende</b> (souvent la recette y est), puis collez-la ici. Si la recette n'est que parlée, importez la vidéo.</div>
    <label>Lien de la vidéo (facultatif)</label>
    <input id="url" type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…">
    <label>Légende / texte de la recette</label>
    <textarea id="txt" placeholder="Collez ici la description de la vidéo…"></textarea>
    <button class="btn secondary" id="paste" type="button">📋 Coller depuis le presse-papiers</button>
    <div class="hint hidden" id="warn"></div>
    <label>Ou importer la vidéo (son transcrit sur votre téléphone)</label>
    <input id="vid" type="file" accept="video/*,audio/*">
    <div class="progress hidden" id="prog"><div></div></div>
    <p class="muted hidden" id="status"></p>
    <button class="btn" id="go">✨ Créer la recette</button>`;
  if (prefill) { $('#url').value = prefill.url; $('#txt').value = prefill.text; prefill = null; }
  const setStatus = (m, pct) => {
    $('#status').textContent = m; $('#status').classList.toggle('hidden', !m);
    $('#prog').classList.toggle('hidden', pct == null); if (pct != null) $('#prog > div').style.width = pct + '%';
  };
  $('#paste').onclick = async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) return toast('Presse-papiers vide', true);
      if (/^https?:\/\/\S+$/.test(t)) { $('#url').value = t; toast('Lien collé. Il faut aussi la légende ou la vidéo.'); }
      else { $('#txt').value = t; toast('Texte collé ✓'); }
    } catch { toast('Collez avec un appui long dans le champ.', true); }
  };
  $('#go').onclick = async () => {
    const btn = $('#go'), url = $('#url').value.trim(), file = $('#vid').files[0];
    let text = $('#txt').value.trim();
    if (!file && /^https?:\/\/\S+$/.test(text) && !$('#url').value.trim()) { $('#url').value = text; $('#txt').value = ''; text = ''; }
    const link = $('#url').value.trim();
    if (!text && !file) {
      $('#warn').classList.remove('hidden');
      $('#warn').innerHTML = `⚠️ <b>Un lien seul ne suffit pas.</b> Instagram et Facebook empêchent l'app de lire la vidéo depuis son adresse.<br><br>
        <b>Faites l'un des deux :</b><br>1. Ouvrez la vidéo, <b>copiez la légende</b> (le texte sous la vidéo) et collez-la dans « Légende / texte ».<br>
        2. Ou <b>enregistrez l'écran</b> pendant la lecture, puis importez la vidéo ci-dessus.` +
        (/^https?:\/\//.test(link) ? `<br><br><a href="${esc(link)}" target="_blank" rel="noopener"><b>Ouvrir la vidéo ↗</b></a>` : '');
      $('#warn').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    $('#warn').classList.add('hidden');
    btn.disabled = true;
    try {
      if (file) {
        const tr = await transcribeVideo(file, setStatus);
        text = (text ? text + '\n\n' : '') + 'Transcription audio :\n' + tr;
      }
      setStatus('Rédaction de votre recette…', null);
      const r = await askClaude(text, url);
      const recipe = { id: uid(), ...r, source: url || '', created: Date.now() };
      state.recipes.unshift(recipe); persist();
      toast('Recette créée ✓'); viewRecipe(recipe.id);
    } catch (e) {
      toast(e.message || String(e), true); setStatus('', null);
    } finally { btn.disabled = false; }
  };
}

// ---------- Vue : courses ----------
function viewShopping() {
  header('Liste de courses');
  const items = state.shopping;
  if (!items.length) {
    view.innerHTML = `<div class="empty"><div class="big">🛒</div><p><b>Votre liste est vide</b></p><p>Ouvrez une recette puis touchez « Ajouter à ma liste de courses ».</p></div>`;
    return;
  }
  const groups = Object.keys(CATEGORIES).map(k => [k, items.filter(i => i.category === k)]).filter(([, l]) => l.length);
  const left = items.filter(i => !i.done).length;
  view.innerHTML = `<p class="muted">${left} article${left > 1 ? 's' : ''} à acheter</p>` +
    groups.map(([k, l]) => `<h3>${CATEGORIES[k]}</h3><div class="card">${l.map(i => `
      <div class="shop ${i.done ? 'done' : ''}" data-id="${i.id}">
        <input type="checkbox" ${i.done ? 'checked' : ''}>
        <div class="name">${esc([i.qty != null ? fmtQty(i.qty) : '', i.unit, i.name].filter(Boolean).join(' '))}<div class="src">${esc(i.from.join(', '))}</div></div>
        <button class="del" aria-label="Supprimer">✕</button>
      </div>`).join('')}</div>`).join('') +
    `<div class="row"><button class="btn secondary" id="clear-done">Retirer les cochés</button><button class="btn secondary" id="copy">Copier la liste</button></div>
     <button class="btn danger" id="clear-all">Tout vider</button>`;
  view.querySelectorAll('.shop').forEach(el => {
    const it = state.shopping.find(s => s.id === el.dataset.id);
    el.querySelector('input').onchange = () => { it.done = !it.done; persist(); viewShopping(); };
    el.querySelector('.del').onclick = () => { state.shopping = state.shopping.filter(s => s !== it); persist(); viewShopping(); };
  });
  $('#clear-done').onclick = () => { state.shopping = state.shopping.filter(s => !s.done); persist(); viewShopping(); };
  $('#clear-all').onclick = () => { if (confirm('Vider toute la liste ?')) { state.shopping = []; persist(); viewShopping(); } };
  $('#copy').onclick = async () => {
    const txt = groups.map(([k, l]) => CATEGORIES[k] + '\n' + l.filter(i => !i.done).map(i => '- ' + [i.qty != null ? fmtQty(i.qty) : '', i.unit, i.name].filter(Boolean).join(' ')).join('\n')).join('\n\n');
    try { if (navigator.share) await navigator.share({ text: txt }); else { await navigator.clipboard.writeText(txt); toast('Liste copiée'); } } catch {}
  };
}

// ---------- Vue : réglages ----------
function viewSettings() {
  header('Réglages', () => setTab(currentTab));
  const prov = state.settings.provider || 'gemini';
  view.innerHTML = `
    <div class="hint">🆓 <b>Gratuit :</b> choisissez Google Gemini. Créez une clé sans carte bancaire sur <b>aistudio.google.com/apikey</b> (connexion avec un compte Google). Elle reste <b>uniquement sur ce téléphone</b>.</div>
    <label>Service d'IA</label>
    <select id="prov">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === prov ? 'selected' : ''}>${v.name}</option>`).join('')}</select>
    <label>Clé API</label>
    <input id="key" type="password" autocomplete="off" placeholder="${PROVIDERS[prov].ph}" value="${esc(state.settings.apiKey)}">
    <label>Modèle (laisser vide = recommandé)</label>
    <input id="model" placeholder="${esc(PROVIDERS[prov].model)}" value="${esc(state.settings.model)}">
    <button class="btn" id="save">Enregistrer</button>
    <h2>Sauvegarde</h2>
    <div class="row"><button class="btn secondary" id="export">Exporter</button><button class="btn secondary" id="import">Importer</button></div>
    <input id="file" type="file" accept="application/json" class="hidden">
    <p class="muted">Les recettes sont stockées dans Safari. Exportez-les de temps en temps pour ne rien perdre.</p>`;
  $('#prov').onchange = () => { state.settings.provider = $('#prov').value; state.settings.apiKey = ''; state.settings.model = ''; persist(); viewSettings(); };
  $('#save').onclick = () => { state.settings.provider = $('#prov').value; state.settings.apiKey = $('#key').value.trim(); state.settings.model = $('#model').value.trim(); persist(); toast('Enregistré ✓'); };
  $('#export').onclick = async () => {
    const blob = new Blob([JSON.stringify({ recipes: state.recipes, shopping: state.shopping }, null, 2)], { type: 'application/json' });
    const f = new File([blob], 'mes-recettes.json', { type: 'application/json' });
    try { if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f] }); else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mes-recettes.json'; a.click(); } } catch {}
  };
  $('#import').onclick = () => $('#file').click();
  $('#file').onchange = async e => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (Array.isArray(d.recipes)) { const ids = new Set(state.recipes.map(r => r.id)); state.recipes.push(...d.recipes.filter(r => !ids.has(r.id))); }
      if (Array.isArray(d.shopping)) state.shopping = d.shopping;
      persist(); toast('Import terminé ✓');
    } catch { toast('Fichier invalide', true); }
  };
}

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (prefill) currentTab = 'add';
if (!state.settings.apiKey) { viewSettings(); toast('Commencez par ajouter votre clé API gratuite'); } else setTab(prefill ? 'add' : 'recipes');
