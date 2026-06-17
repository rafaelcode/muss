/* ═══════════════════════════════════════════════════════════════
   MUSS · LIBRARY + ROUTER
   Integration layer that sits on top of the workbench.
   - Holds the user's song library (persisted to localStorage)
   - Renders the dashboard (grid / list / searchable table)
   - Routes between the library screen and the workbench screen
   - Loads a song into the workbench STATE and saves edits back
   ═══════════════════════════════════════════════════════════════ */

const LIB = {
  records: [],          // [{ libId, song, genre, favorite, createdAt, updatedAt }]
  sort: 'artist',       // artist | title | genre | bpm
  sortDir: 1,           // 1 asc, -1 desc (table headers toggle this)
  view: 'table',         // grid | list | table
  nav: 'all',           // all | recent | favorites
  genre: null,          // genre filter or null
  search: '',
  current: null,        // libId currently open in the workbench
  setlists: [],         // [{id, name, items:[{kind:song,libId}|{kind:pending,title,artist,link}], createdAt, updatedAt}]
  currentSetlist: null, // setlist id open in the detail view
};
const LIB_KEY = 'muss_library_v2';

const GENRE_COLORS = {
  Rock:'var(--g-rock)', Pop:'var(--g-pop)', Jazz:'var(--g-jazz)', Metal:'var(--g-metal)',
  Folk:'var(--g-folk)', Blues:'var(--g-blues)', Latin:'var(--g-latin)', Indie:'var(--g-indie)',
  Country:'var(--g-country)', Other:'var(--g-other)'
};
const genreColor = g => GENRE_COLORS[g] || 'var(--ink-faint)';

const ARTIST_PALETTE = ['#4f6ef7','#2a9d8f','#e05c3a','#c46bb0','#c08040','#4fa8b8','#4aab6d','#d4521e','#7c69f5'];
function hashColor(str){
  let h=0; for(const c of (str||'')) h=(h*31+c.charCodeAt(0))>>>0;
  return ARTIST_PALETTE[h%ARTIST_PALETTE.length];
}

/* ── Persistence ─────────────────────────────────────────────── */
function libSave(){ try{ localStorage.setItem(LIB_KEY, JSON.stringify(LIB.records)); }catch(e){} }
function libLoad(){
  try{ const d=localStorage.getItem(LIB_KEY); if(d) LIB.records=JSON.parse(d); }catch(e){ LIB.records=[]; }
}
const SET_KEY = 'muss_setlists_v1';
function setSave(){ try{ localStorage.setItem(SET_KEY, JSON.stringify(LIB.setlists)); }catch(e){} }
function setLoad(){ try{ const d=localStorage.getItem(SET_KEY); if(d) LIB.setlists=JSON.parse(d)||[]; }catch(e){ LIB.setlists=[]; } setMigrate(); }

/* ── Record helpers (read derived metadata from the muss song) ── */
/* Aggregates / helpers used by the library views. */
function sigBeatsOf(sig){const n=parseInt((sig||'4/4').split('/')[0]);return isNaN(n)?4:n}
function songTotalBeats(s){return (s.blocks||[]).reduce((a,b)=>a+(b.bars||0),0)*sigBeatsOf(s.signature)}
function chHasContent(song,ch){
  return (song.blocks||[]).some(b=>{
    const d=b.content&&b.content[ch.id];if(!d)return false;
    if(ch.type==='lyrics')return !!(d.text||'').trim();
    if(ch.type==='rhythm')return (d.chords||[]).length>0||!!b.chordpro;
    if(ch.type==='lead'||ch.type==='bass'){const t=Array.isArray(d.tab)?d.tab:[];return t.some(s=>Array.isArray(s)&&s.some(c=>c&&c!=='-'))}
    if(ch.type==='drums'){const p=d.pattern||{};return Object.values(p).some(arr=>Array.isArray(arr)&&arr.some(v=>v))}
    return !!(d.text||d.notes||'').trim();
  });
}
function songActiveChannels(song){return (song.channels||[]).filter(ch=>chHasContent(song,ch))}
function songChords(song){
  const set=new Set();
  (song.channels||[]).filter(c=>c.type==='rhythm').forEach(rh=>{
    (song.blocks||[]).forEach(b=>{(b.content&&b.content[rh.id]&&b.content[rh.id].chords||[]).forEach(c=>{if(c.name)set.add(c.name.trim())})});
  });
  (song.blocks||[]).forEach(b=>{if(b.chordpro){const re=/\[([^\]]+)\]/g;let m;while((m=re.exec(b.chordpro)))set.add(m[1].trim())}});
  return [...set];
}
/* Group consecutive same-section blocks: [{section,n}, ...] */
function songStructure(song){
  const out=[];
  (song.blocks||[]).forEach(b=>{
    const sec=b.section||'—';
    if(out.length&&out[out.length-1].section===sec)out[out.length-1].n++;
    else out.push({section:sec,n:1});
  });
  return out;
}

const meta = {
  title: r => r.song.title || 'Sin título',
  artist: r => r.song.artist || 'Artista desconocido',
  genre: r => r.genre || r.song.genre || '',
  bpm: r => r.song.bpm || 0,
  sig: r => r.song.signature || '4/4',
  link: r => r.song.link || '',
  channels: r => (r.song.channels || []).map(c => c.type),
  activeChannels: r => songActiveChannels(r.song),
  beats: r => songTotalBeats(r.song),
  chords: r => songChords(r.song),
  structure: r => songStructure(r.song),
};

/* ── Setlists ─────────────────────────────────────────────────
   Persistent collections of songs with a custom, draggable order.
   Items are objects so a setlist can also hold "pending" songs that
   don't exist in the library yet (just title / artist / link).
     item = { kind:'song', libId }              · references a library song
           | { kind:'pending', title, artist, link }  · a placeholder
   ───────────────────────────────────────────────────────────── */
let SET_DRAG_FROM = null;

/* Migrate any legacy {songIds:[...]} setlists to the items model. */
function setMigrate(){
  (LIB.setlists||[]).forEach(s=>{
    if(!Array.isArray(s.items)){
      s.items = (s.songIds||[]).map(id=>({kind:'song', libId:id}));
    }
    delete s.songIds;
  });
}

function setFmtDate(t){ if(!t) return '—'; try{ return new Date(t).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}); }catch(_){ return '—'; } }

function setNew(){
  const s={ id:uid(), name:'Nuevo setlist', items:[], createdAt:Date.now(), updatedAt:Date.now() };
  LIB.setlists.push(s); setSave();
  LIB.nav='setlist'; LIB.currentSetlist=s.id; libSyncNavActive(); libRender();
  flash('Setlist creado');
}
function setOpen(id){ LIB.nav='setlist'; LIB.currentSetlist=id; libSyncNavActive(); libRender(); }
function setBack(){ LIB.nav='setlists'; libSyncNavActive(); libRender(); }
function setRename(id,name){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  s.name=(name||'').trim()||'Setlist'; s.updatedAt=Date.now(); setSave(); libUpdateCounts();
}
function setAddSong(id,libId){
  const s=LIB.setlists.find(x=>x.id===id); if(!s||!libId) return;
  s.items.push({kind:'song', libId}); s.updatedAt=Date.now(); setSave(); libRenderSetlistDetail(); libUpdateCounts();
}
/* Add a song from the title/artist/link inputs. If a matching library song exists,
   reference it; otherwise add it as a "pending" placeholder. */
function setAddNew(id){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  const tEl=$('#setNewTitle'), aEl=$('#setNewArtist'), lEl=$('#setNewLink');
  const title=(tEl?tEl.value:'').trim(); if(!title){ if(tEl)tEl.focus(); return; }
  const artist=(aEl?aEl.value:'').trim();
  const link=(lEl?lEl.value:'').trim();
  const existing=LIB.records.find(r=>
    meta.title(r).toLowerCase()===title.toLowerCase() &&
    (!artist || meta.artist(r).toLowerCase()===artist.toLowerCase()));
  if(existing) s.items.push({kind:'song', libId:existing.libId});
  else s.items.push({kind:'pending', title, artist, link});
  s.updatedAt=Date.now(); setSave(); libRenderSetlistDetail(); libUpdateCounts();
  flash(existing?'Canción existente añadida':'Añadida como pendiente');
}
/* Materialise a pending item into a real library song (and reference it). */
function setMaterialize(id,idx){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  const it=s.items[idx]; if(!it||it.kind!=='pending') return;
  const song=normalizeSong(blankSong({title:it.title, artist:it.artist, link:it.link}));
  const rec={ libId:uid(), song, genre:song.genre||'', favorite:false, createdAt:Date.now(), updatedAt:Date.now() };
  LIB.records.push(rec); libSave();
  s.items[idx]={kind:'song', libId:rec.libId}; s.updatedAt=Date.now(); setSave();
  libRenderSetlistDetail(); libUpdateCounts();
  flash('Canción creada en la biblioteca');
}
function setRemoveSong(id,idx){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  s.items.splice(idx,1); s.updatedAt=Date.now(); setSave(); libRenderSetlistDetail(); libUpdateCounts();
}
function setReorder(id,from,to){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  if(from<0||to<0||from>=s.items.length||to>=s.items.length||from===to) return;
  const [m]=s.items.splice(from,1); s.items.splice(to,0,m);
  s.updatedAt=Date.now(); setSave(); libRenderSetlistDetail();
}
function setDuplicate(id){
  const s=LIB.setlists.find(x=>x.id===id); if(!s) return;
  const copy={ id:uid(), name:s.name+' (copia)', items:s.items.map(it=>({...it})), createdAt:Date.now(), updatedAt:Date.now() };
  LIB.setlists.push(copy); setSave();
  LIB.nav='setlist'; LIB.currentSetlist=copy.id; libSyncNavActive(); libRender();
  flash('Copia guardada');
}
function setDelete(id){
  if(!confirm('¿Eliminar este setlist?')) return;
  LIB.setlists=LIB.setlists.filter(x=>x.id!==id);
  if(LIB.currentSetlist===id) LIB.currentSetlist=null;
  if(LIB.nav==='setlist') LIB.nav='setlists';
  setSave(); libSyncNavActive(); libRender(); flash('Setlist eliminado');
}

/* Date-ordered table of setlists (shared by the full view and the dashboard panel). */
function setlistsTableHTML(){
  const sets=LIB.setlists.slice().sort((a,b)=>(b.updatedAt||b.createdAt)-(a.updatedAt||a.createdAt));
  if(!sets.length) return `<div class="set-empty">Aún no tienes setlists. <button class="lib-link" onclick="setNew()">Crear uno</button></div>`;
  return `<table class="set-table"><thead><tr><th>Setlist</th><th>Canciones</th><th>Actualizado</th><th></th></tr></thead><tbody>${sets.map(s=>{
    const n=(s.items||[]).length, pend=(s.items||[]).filter(it=>it.kind==='pending').length;
    return `<tr onclick="setOpen('${s.id}')">
      <td class="set-name">${escapeHTML(s.name)}</td>
      <td class="set-count">${n}${pend?` · ${pend} pend.`:''}</td>
      <td class="set-date">${setFmtDate(s.updatedAt||s.createdAt)}</td>
      <td class="set-row-actions">
        <button onclick="event.stopPropagation();setDuplicate('${s.id}')" title="Guardar copia">⧉</button>
        <button onclick="event.stopPropagation();setDelete('${s.id}')" title="Eliminar">×</button>
      </td>
    </tr>`;}).join('')}</tbody></table>`;
}

/* Full "Setlists" view (sidebar nav). */
function libRenderSetlists(){
  $('#libList').innerHTML=`<div class="set-view">
    <div class="set-view-head"><button class="action-btn primary" onclick="setNew()">+ Nuevo setlist</button></div>
    ${setlistsTableHTML()}
  </div>`;
}

/* Compact "Mis setlists" panel below the songs on the main view. */
function libAppendSetlistsPanel(){
  if(LIB.nav!=='all' || LIB.genre) return;
  const box=$('#libList'); if(!box) return;
  box.insertAdjacentHTML('beforeend', `<div class="set-panel">
    <div class="set-panel-head"><span class="set-panel-title">Mis setlists</span><button class="lib-link" onclick="setNew()">+ Nuevo setlist</button></div>
    ${setlistsTableHTML()}
  </div>`);
}

/* One row in the setlist detail (existing song or pending placeholder). */
function setItemRowHTML(setId, it, i){
  if(it.kind==='pending'){
    return `<div class="set-song-row pending" draggable="true" data-index="${i}">
      <span class="set-drag" title="Arrastrar para reordenar">⠿</span>
      <span class="set-song-num">${i+1}</span>
      <span class="set-song-title">${escapeHTML(it.title||'(sin título)')}</span>
      <span class="set-song-artist">${escapeHTML(it.artist||'')}</span>
      <span class="set-pending-badge" title="No existe aún en la biblioteca">pendiente</span>
      ${it.link?`<a class="set-song-open" href="${escapeHTML(it.link)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Abrir link">↗</a>`:`<span class="set-song-bpm"></span>`}
      <button class="set-song-make" onclick="event.stopPropagation();setMaterialize('${setId}',${i})" title="Crear esta canción en la biblioteca">＋ crear</button>
      <button class="set-song-del" onclick="event.stopPropagation();setRemoveSong('${setId}',${i})" title="Quitar del setlist">×</button>
    </div>`;
  }
  const r=LIB.records.find(x=>x.libId===it.libId);
  if(!r){ // referenced song was deleted — show a tombstone the user can remove
    return `<div class="set-song-row missing" data-index="${i}">
      <span class="set-drag">⠿</span><span class="set-song-num">${i+1}</span>
      <span class="set-song-title" style="color:var(--ink-faint)">(canción eliminada)</span>
      <button class="set-song-del" onclick="event.stopPropagation();setRemoveSong('${setId}',${i})" title="Quitar">×</button>
    </div>`;
  }
  return `<div class="set-song-row" draggable="true" data-index="${i}">
    <span class="set-drag" title="Arrastrar para reordenar">⠿</span>
    <span class="set-song-num">${i+1}</span>
    <span class="set-song-title">${escapeHTML(meta.title(r))}</span>
    <span class="set-song-artist">${escapeHTML(meta.artist(r))}</span>
    <span class="set-song-bpm">${meta.bpm(r)?meta.bpm(r)+' BPM':''}</span>
    <button class="set-song-open" onclick="event.stopPropagation();libOpen('${r.libId}')" title="Abrir canción">↗</button>
    <button class="set-song-del" onclick="event.stopPropagation();setRemoveSong('${setId}',${i})" title="Quitar del setlist">×</button>
  </div>`;
}

/* Setlist detail / editor — rename, add existing or new (pending) songs, drag-reorder, save copy. */
function libRenderSetlistDetail(){
  const box=$('#libList');
  const s=LIB.setlists.find(x=>x.id===LIB.currentSetlist);
  if(!s){ LIB.nav='setlists'; return libRenderSetlists(); }
  const usedIds=s.items.filter(it=>it.kind==='song').map(it=>it.libId);
  const addable=LIB.records.filter(r=>!usedIds.includes(r.libId)).sort((a,b)=>meta.title(a).localeCompare(meta.title(b)));
  box.innerHTML=`<div class="set-detail">
    <div class="set-detail-head">
      <button class="lib-link" onclick="setBack()">← Setlists</button>
      <input class="set-name-input" id="setName" value="${escapeHTML(s.name)}" onchange="setRename('${s.id}',this.value)" placeholder="Nombre del setlist">
      <div class="set-detail-actions">
        <button class="action-btn" onclick="setDuplicate('${s.id}')" title="Guardar una copia de este setlist">⧉ Guardar copia</button>
        <button class="action-btn danger" onclick="setDelete('${s.id}')" title="Eliminar setlist">Eliminar</button>
      </div>
    </div>

    <div class="set-add-bar">
      <select class="set-add" onchange="if(this.value){setAddSong('${s.id}',this.value);}">
        <option value="">+ Añadir canción existente…</option>
        ${addable.map(r=>`<option value="${r.libId}">${escapeHTML(meta.title(r))} — ${escapeHTML(meta.artist(r))}</option>`).join('')}
      </select>
      <div class="set-newsong">
        <input id="setNewTitle" class="set-new-in" type="text" placeholder="Título" onkeydown="if(event.key==='Enter')setAddNew('${s.id}')">
        <input id="setNewArtist" class="set-new-in" type="text" placeholder="Artista" onkeydown="if(event.key==='Enter')setAddNew('${s.id}')">
        <input id="setNewLink" class="set-new-in set-new-link" type="text" placeholder="Link (opcional)" onkeydown="if(event.key==='Enter')setAddNew('${s.id}')">
        <button class="action-btn" onclick="setAddNew('${s.id}')" title="Añade la canción; si no existe en la biblioteca queda como pendiente">+ Añadir nueva</button>
      </div>
    </div>

    <div class="set-songs" id="setSongs">
      ${s.items.length?s.items.map((it,i)=>setItemRowHTML(s.id,it,i)).join(''):`<div class="set-empty">Sin canciones todavía. Añade una existente o una nueva (pendiente).</div>`}
    </div>
  </div>`;
  bindSetlistDnD(s.id);
}

/* Drag-and-drop reordering of songs within a setlist. */
function bindSetlistDnD(setId){
  $$('#setSongs .set-song-row[draggable="true"]').forEach(row=>{
    row.addEventListener('dragstart',e=>{ SET_DRAG_FROM=+row.dataset.index; row.classList.add('dragging'); try{e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(SET_DRAG_FROM));}catch(_){} });
    row.addEventListener('dragend',()=>{ row.classList.remove('dragging'); $$('#setSongs .set-song-row').forEach(r=>r.classList.remove('drag-over')); });
    row.addEventListener('dragover',e=>{ e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{ e.preventDefault(); const to=+row.dataset.index; if(SET_DRAG_FROM!=null && SET_DRAG_FROM!==to) setReorder(setId,SET_DRAG_FROM,to); SET_DRAG_FROM=null; });
  });
}

/* ── Tool: chord catalog (dashboard) — browses the current chord base ── */
function libSetChordCat(cat){ LIB.chordCat = cat; libRenderChordsTool(); }
function chordCatalogCard(c){
  const v=(c.voicings&&c.voicings[0])||null;
  const diag=(v&&typeof ccDiagramSVG==='function')?ccDiagramSVG(v,{size:92}):'';
  const tab=(typeof chordTabHTML==='function')?chordTabHTML(c.name):'';
  return `<div class="chcard">
    <div class="chcard-head"><span class="chcard-name">${escapeHTML(c.name)}</span>${c.category?`<span class="chcard-cat">${escapeHTML(c.category)}</span>`:''}</div>
    <div class="chcard-body"><div class="chcard-diag">${diag}</div>${tab}</div>
    ${(c.notes&&c.notes.length)?`<div class="chcard-notes">${c.notes.map(n=>`<span>${escapeHTML(n)}</span>`).join('')}</div>`:''}
  </div>`;
}
function libRenderChordsTool(){
  if(typeof ccEnsure==='function') ccEnsure();
  const chords=((STATE.catalog&&STATE.catalog.chords)||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
  const q=(LIB.chordQuery||'').trim().toLowerCase();
  const activeCat=LIB.chordCat||'all';
  const cats=[...new Set(chords.map(c=>c.category).filter(Boolean))];
  const filtered=chords.filter(c=>{
    if(activeCat!=='all' && c.category!==activeCat) return false;
    if(q && !(c.name.toLowerCase().includes(q) || (c.notes||[]).join('').toLowerCase().includes(q))) return false;
    return true;
  });
  const box=$('#libList');
  box.innerHTML=`<div class="chtool">
    <div class="chtool-bar">
      <input id="chSearch" class="chtool-search" type="text" placeholder="Buscar acorde o nota…" value="${escapeHTML(LIB.chordQuery||'')}">
      <div class="chtool-cats">
        <button class="${activeCat==='all'?'active':''}" onclick="libSetChordCat('all')">Todos</button>
        ${cats.map(cat=>`<button class="${activeCat===cat?'active':''}" onclick="libSetChordCat('${cat}')">${escapeHTML(cat)}</button>`).join('')}
      </div>
    </div>
    <div class="chtool-grid">${filtered.length?filtered.map(chordCatalogCard).join(''):'<div class="chtool-empty">Sin acordes para ese filtro.</div>'}</div>
  </div>`;
  const s=$('#chSearch');
  if(s) s.addEventListener('input',()=>{ LIB.chordQuery=s.value; libRenderChordsTool(); const ns=$('#chSearch'); if(ns){ns.focus(); const L=ns.value.length; ns.setSelectionRange(L,L);} });
}

/* Build a blank muss song (mirrors workbench defaults) */
function blankSong(info){
  const chId = uid();
  const blId = uid();
  return {
    title: info.title || '',
    artist: info.artist || '',
    genre: info.genre || '',
    link: info.link || '',
    bpm: info.bpm || 120,
    signature: info.signature || '4/4',
    channels: [{ id: chId, name:'Vocals', type:'lyrics', color:'#4f6ef7', muted:false }],
    blocks: [{ id: blId, section:'VERSE', bars:4, enabled:true, comment:'', content:{ [chId]:{ text:'' } } }],
    progressions: [],
    library: { riffs: [] },
  };
}

/* Normalize an imported / loaded song so the workbench can render it */
function normalizeSong(song){
  song.channels = song.channels || [];
  song.blocks = song.blocks || [];
  song.progressions = song.progressions || [];
  if(!song.library) song.library = { riffs: [] };
  if(!song.library.riffs) song.library.riffs = [];
  return song;
}

/* ── Filtering & sorting ─────────────────────────────────────── */
function libFiltered(){
  let list = [...LIB.records];
  const q = LIB.search.toLowerCase().trim();
  if(q) list = list.filter(r => meta.title(r).toLowerCase().includes(q) || meta.artist(r).toLowerCase().includes(q));
  if(LIB.nav === 'favorites') list = list.filter(r => r.favorite);
  if(LIB.nav === 'recent'){ const cut = Date.now()-8.64e7*30; list = list.filter(r => (r.updatedAt||r.createdAt) > cut); }
  if(LIB.genre) list = list.filter(r => meta.genre(r) === LIB.genre);
  return list;
}
function libSorted(list){
  const k = LIB.sort, dir = LIB.sortDir;
  return [...list].sort((a,b)=>{
    if(k==='bpm') return (meta.bpm(b)-meta.bpm(a))*dir*-1; // bpm default high→low when asc feels natural
    if(k==='beats') return (meta.beats(b)-meta.beats(a))*dir*-1;
    const va=(k==='title'?meta.title(a):k==='genre'?meta.genre(a):meta.artist(a)).toLowerCase();
    const vb=(k==='title'?meta.title(b):k==='genre'?meta.genre(b):meta.artist(b)).toLowerCase();
    return (va<vb?-1:va>vb?1:0)*dir;
  });
}
function libGrouped(list){
  const k = LIB.sort, groups = {};
  list.forEach(r=>{
    let g='';
    if(k==='artist') g=meta.artist(r);
    else if(k==='genre') g=meta.genre(r)||'Sin género';
    else if(k==='title') g=meta.title(r).charAt(0).toUpperCase();
    (groups[g] ||= []).push(r);
  });
  return groups;
}

/* ── Render: counts, genres, list ────────────────────────────── */
function libRender(){ libUpdateCounts(); libRenderGenres(); libRenderList(); libAppendSetlistsPanel(); }

function libUpdateCounts(){
  const all = LIB.records.length;
  const recent = LIB.records.filter(r => (r.updatedAt||r.createdAt) > Date.now()-8.64e7*30).length;
  const fav = LIB.records.filter(r => r.favorite).length;
  $('#cntAll').textContent = all;
  $('#cntRecent').textContent = recent;
  $('#cntFav').textContent = fav;
  const setCnt=$('#cntSet'); if(setCnt) setCnt.textContent = LIB.setlists.length;
  if(LIB.nav==='setlists'){ $('#libTitle').innerHTML=`Mis setlists <span>— ${LIB.setlists.length} setlist${LIB.setlists.length!==1?'s':''}</span>`; return; }
  if(LIB.nav==='setlist'){ const s=LIB.setlists.find(x=>x.id===LIB.currentSetlist); const n=s?(s.items||[]).length:0; $('#libTitle').innerHTML=`${s?escapeHTML(s.name):'Setlist'} <span>— ${n} canción${n!==1?'es':''}</span>`; return; }
  if(LIB.nav==='chords'){
    if(typeof ccEnsure==='function')ccEnsure();
    const nC=((STATE.catalog&&STATE.catalog.chords)||[]).length;
    $('#libTitle').innerHTML = `Catálogo de acordes <span>— ${nC} acordes</span>`;
    return;
  }
  const vis = libFiltered().length;
  const titles = { all:'Todas las canciones', recent:'Recientes', favorites:'Favoritas' };
  const sub = `${vis} canción${vis!==1?'es':''}${LIB.genre?` · ${escapeHTML(LIB.genre)}`:''}`;
  $('#libTitle').innerHTML = `${escapeHTML(titles[LIB.nav]||'Biblioteca')} <span>— ${sub}</span>`;
}

function libRenderGenres(){
  const counts = {};
  LIB.records.forEach(r => { const g=meta.genre(r); (counts[g] ??= 0, counts[g]++); });
  const el = $('#libGenres'); el.innerHTML='';
  const all = document.createElement('div');
  all.className = 'lib-genre'+(LIB.genre===null?' active':'');
  all.innerHTML = `<div class="lib-dot" style="background:var(--accent-dim)"></div><span class="lib-genre-name">Todos</span><span class="lib-genre-count">${LIB.records.length}</span>`;
  all.onclick = ()=>{ if(LIB.nav==='chords'){LIB.nav='all';libSyncNavActive();} LIB.genre=null; libRender(); };
  el.appendChild(all);
  Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([g,c])=>{
    const d = document.createElement('div');
    d.className = 'lib-genre'+(LIB.genre===g?' active':'');
    d.innerHTML = `<div class="lib-dot" style="background:${genreColor(g)}"></div><span class="lib-genre-name">${escapeHTML(g||'Sin género')}</span><span class="lib-genre-count">${c}</span>`;
    d.onclick = ()=>{ if(LIB.nav==='chords'){LIB.nav='all';libSyncNavActive();} LIB.genre=g; libRender(); };
    el.appendChild(d);
  });
}

function libSyncNavActive(){ const n=(LIB.nav==='setlist')?'setlists':LIB.nav; $$('#screen-library [data-nav]').forEach(x=>x.classList.toggle('active', x.dataset.nav===n)); }
function libRenderList(){
  const hideTb = LIB.nav==='chords'||LIB.nav==='setlists'||LIB.nav==='setlist';
  const sortEl=document.querySelector('#screen-library .lib-sort'), viewEl=$('#libView');
  if(sortEl) sortEl.style.display = hideTb?'none':'';
  if(viewEl) viewEl.style.display = hideTb?'none':'';
  if(LIB.nav==='chords') return libRenderChordsTool();
  if(LIB.nav==='setlists') return libRenderSetlists();
  if(LIB.nav==='setlist') return libRenderSetlistDetail();
  const data = libSorted(libFiltered());
  const box = $('#libList');

  if(!data.length){
    box.innerHTML = `<div class="lib-empty">
      <div class="lib-empty-icon">♩</div>
      <div class="lib-empty-title">No hay canciones aquí</div>
      <div class="lib-empty-sub">Crea tu primera canción o importa un<br>archivo .muss.json para comenzar.</div>
      <button class="lib-cta" onclick="libOpenNew()">+ Nueva canción</button>
    </div>`;
    return;
  }

  if(LIB.view === 'table'){ box.innerHTML = libTableHTML(data); return; }

  // grid / list — group by sort key (except bpm = flat)
  if(LIB.sort === 'bpm'){
    box.innerHTML = `<div class="${LIB.view==='grid'?'lib-grid':'lib-list'}">${
      data.map((r,i)=> LIB.view==='grid'? libCardHTML(r) : libRowHTML(r,i+1)).join('')
    }</div>`;
    return;
  }
  const groups = libGrouped(data);
  let html='';
  Object.keys(groups).forEach(key=>{
    const songs = groups[key];
    const isArtist = LIB.sort==='artist';
    const color = isArtist ? hashColor(key) : genreColor(key);
    const initial = (key||'?').charAt(0).toUpperCase();
    html += `<div class="lib-group">
      <div class="lib-group-head">
        <div class="lib-avatar" style="background:${color}">${escapeHTML(initial)}</div>
        <div class="lib-group-name">${escapeHTML(key||'Desconocido')}</div>
        <div class="lib-group-count">${songs.length} canción${songs.length!==1?'es':''}</div>
      </div>
      <div class="${LIB.view==='grid'?'lib-grid':'lib-list'}">
        ${songs.map((r,i)=> LIB.view==='grid'? libCardHTML(r) : libRowHTML(r,i+1)).join('')}
      </div>
    </div>`;
  });
  box.innerHTML = html;
}

/* ── Templates ───────────────────────────────────────────────── */
function chInitialsHTML(channels){
  if(!channels||!channels.length)return '<span style="color:var(--ink-faint);font-size:10px">—</span>';
  return channels.map(ch=>{
    const info=(typeof CH_TYPE_INFO!=='undefined'&&CH_TYPE_INFO[ch.type])||{letter:'?',label:ch.type};
    return `<span class="lib-chini" style="background:${ch.color||'#888'}" title="${escapeHTML(ch.name||info.label)}">${info.letter}</span>`;
  }).join('');
}
/* Compact structure: pill-row of section initials (first letter, section color), groups ×N. */
function structureMiniHTML(struct){
  if(!struct||!struct.length)return '<span style="color:var(--ink-faint);font-size:10px">—</span>';
  const SC=(typeof SECTION_COLORS!=='undefined')?SECTION_COLORS:{};
  return struct.slice(0,16).map(g=>{
    const col=SC[g.section]||'#999';const ini=(g.section||'?').charAt(0).toUpperCase();
    return `<span class="lib-stmini" style="background:${col}" title="${escapeHTML(g.section)}${g.n>1?' ×'+g.n:''}">${ini}${g.n>1?'<sup>'+g.n+'</sup>':''}</span>`;
  }).join('')+(struct.length>16?'<span class="lib-stmini-more">+'+(struct.length-16)+'</span>':'');
}
/* Compact chord list as pills */
function chordsMiniHTML(chords){
  if(!chords||!chords.length)return '<span style="color:var(--ink-faint);font-size:10px">—</span>';
  const show=chords.slice(0,8);
  const more=chords.length>show.length?`<span class="lib-chordmore">+${chords.length-show.length}</span>`:'';
  return show.map(n=>`<span class="lib-chordmini">${escapeHTML(n)}</span>`).join('')+more;
}

function libCardHTML(r){
  const g = meta.genre(r), bg = hashColor(meta.artist(r)+meta.title(r));
  const initial = meta.title(r).charAt(0).toUpperCase();
  return `<div class="lib-card" onclick="libOpen('${r.libId}')">
    <div class="lib-thumb" style="background:linear-gradient(135deg,${bg}22,${bg}55)">
      <div class="lib-thumb-letter" style="color:${bg}">${escapeHTML(initial)}</div>
      ${g?`<div class="lib-badge" style="background:${genreColor(g)}">${escapeHTML(g)}</div>`:''}
      <div class="lib-play"><svg viewBox="0 0 20 20" fill="currentColor"><path d="M7 5l10 5-10 5V5z"/></svg></div>
    </div>
    <div class="lib-card-ov">
      <button class="lib-mini fav ${r.favorite?'on':''}" onclick="event.stopPropagation();libFav('${r.libId}')" title="Favorito">${r.favorite?'♥':'♡'}</button>
      <button class="lib-mini del" onclick="event.stopPropagation();libDelete('${r.libId}')" title="Eliminar">✕</button>
    </div>
    <div class="lib-card-body">
      <div class="lib-card-title">${escapeHTML(meta.title(r))}</div>
      <div class="lib-card-artist">${escapeHTML(meta.artist(r))}</div>
      <div class="lib-card-meta">
        <span class="lib-bpm">${meta.bpm(r)||'—'} bpm</span>
        <span class="lib-sig">${escapeHTML(meta.sig(r))}</span>
        <div class="lib-chans">${chInitialsHTML(meta.activeChannels(r))}</div>
      </div>
    </div>
  </div>`;
}

function libRowHTML(r,i){
  return `<div class="lib-row" onclick="libOpen('${r.libId}')">
    <div class="lib-row-num">${i}</div>
    <div class="lib-row-info">
      <div class="lib-row-title">${escapeHTML(meta.title(r))}</div>
      <div class="lib-row-artist">${escapeHTML(meta.artist(r))}</div>
    </div>
    <div class="lib-dot" style="background:${genreColor(meta.genre(r))}" title="${escapeHTML(meta.genre(r))}"></div>
    <div class="lib-row-bpm">${meta.bpm(r)||'—'} bpm</div>
    <div class="lib-row-sig">${escapeHTML(meta.sig(r))}</div>
    <div class="lib-row-acts">
      <button class="lib-num fav ${r.favorite?'on':''}" onclick="event.stopPropagation();libFav('${r.libId}')" title="Favorito">${r.favorite?'♥':'♡'}</button>
      <button class="lib-num del" onclick="event.stopPropagation();libDelete('${r.libId}')" title="Eliminar">✕</button>
    </div>
  </div>`;
}

/* Searchable table view with sortable headers */
function libTableHTML(data){
  const cols = [
    { k:'#',        label:'#',         cls:'col-num' },
    { k:'title',    label:'Título',    sort:'title' },
    { k:'artist',   label:'Artista',   sort:'artist' },
    { k:'genre',    label:'Género',    sort:'genre', cls:'col-genre' },
    { k:'bpm',      label:'BPM',       sort:'bpm', cls:'center' },
    { k:'sig',      label:'Compás',    cls:'center col-sig' },
    { k:'beats',    label:'Beats',     sort:'beats', cls:'center col-beats' },
    { k:'struct',   label:'Estructura',cls:'col-struct' },
    { k:'chords',   label:'Acordes',   cls:'col-chords' },
    { k:'chans',    label:'Canales',   cls:'center col-chans' },
    { k:'acts',     label:'',          cls:'center' },
  ];
  const arrow = c => c.sort===LIB.sort ? `<span class="arr">${LIB.sortDir>0?'▲':'▼'}</span>` : '';
  const head = cols.map(c=>{
    const sortable = c.sort ? `onclick="libSortTable('${c.sort}')"` : '';
    return `<th class="${c.cls||''}" ${sortable}>${c.label}${c.sort?arrow(c):''}</th>`;
  }).join('');

  const rows = data.map((r,i)=>`<tr onclick="libOpen('${r.libId}')">
    <td class="lib-td-mono lib-td-center col-num">${i+1}</td>
    <td><div class="lib-td-title">${escapeHTML(meta.title(r))}</div></td>
    <td>${escapeHTML(meta.artist(r))}</td>
    <td class="col-genre">${meta.genre(r)?`<span class="lib-pill"><span class="lib-dot" style="background:${genreColor(meta.genre(r))}"></span>${escapeHTML(meta.genre(r))}</span>`:'<span style="color:var(--ink-faint)">—</span>'}</td>
    <td class="lib-td-mono lib-td-center">${meta.bpm(r)||'—'}</td>
    <td class="lib-td-mono lib-td-center col-sig">${escapeHTML(meta.sig(r))}</td>
    <td class="lib-td-mono lib-td-center col-beats">${meta.beats(r)||'—'}</td>
    <td class="col-struct"><div class="lib-struct">${structureMiniHTML(meta.structure(r))}</div></td>
    <td class="col-chords"><div class="lib-chords-mini">${chordsMiniHTML(meta.chords(r))}</div></td>
    <td class="lib-td-center col-chans"><div class="lib-chans" style="justify-content:center">${chInitialsHTML(meta.activeChannels(r))}</div></td>
    <td>
      <div class="lib-td-acts">
        <button class="lib-num fav ${r.favorite?'on':''}" onclick="event.stopPropagation();libFav('${r.libId}')" title="Favorito">${r.favorite?'♥':'♡'}</button>
        <button class="lib-num del" onclick="event.stopPropagation();libDelete('${r.libId}')" title="Eliminar">✕</button>
      </div>
    </td>
  </tr>`).join('');

  return `<div class="lib-table-wrap"><table class="lib-table">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/* ── Actions ─────────────────────────────────────────────────── */
function libFav(id){
  const r = LIB.records.find(x=>x.libId===id); if(!r) return;
  r.favorite = !r.favorite; libSave(); libRender();
  flash(r.favorite?'Agregado a favoritas':'Removido de favoritas');
}
function libDelete(id){
  const r = LIB.records.find(x=>x.libId===id); if(!r) return;
  if(!confirm(`¿Eliminar "${meta.title(r)}"?`)) return;
  LIB.records = LIB.records.filter(x=>x.libId!==id);
  libSave(); libRender(); flash('Canción eliminada');
}
function libSortTable(k){
  if(LIB.sort===k) LIB.sortDir*=-1; else { LIB.sort=k; LIB.sortDir=1; }
  $$('#libSort button').forEach(b=>b.classList.toggle('active', b.dataset.sort===k));
  libRender();
}

/* ── New song modal ──────────────────────────────────────────── */
function libOpenNew(){
  ['ns_title','ns_artist','ns_link'].forEach(i=>$('#'+i).value='');
  $('#ns_genre').value=''; $('#ns_bpm').value='120'; $('#ns_sig').value='4/4';
  $('#newSongModal').classList.add('show');
  setTimeout(()=>$('#ns_title').focus(),60);
}
function libCloseNew(){ $('#newSongModal').classList.remove('show'); }
function libCreateNew(){
  const title = $('#ns_title').value.trim();
  if(!title){ $('#ns_title').focus(); return; }
  const song = blankSong({
    title,
    artist: $('#ns_artist').value.trim(),
    genre: $('#ns_genre').value,
    bpm: parseInt($('#ns_bpm').value)||120,
    signature: $('#ns_sig').value,
    link: $('#ns_link').value.trim(),
  });
  const rec = { libId:uid(), song, genre:song.genre, favorite:false, createdAt:Date.now(), updatedAt:Date.now() };
  LIB.records.unshift(rec);
  libSave(); libCloseNew();
  flash(`"${title}" creada`);
  libOpen(rec.libId, true);  // new song → open on the Lyrics paste view
}

/* ── Import .muss.json into the library ──────────────────────── */
function libHandleImport(e){
  const f=e.target.files[0]; if(!f) return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      const song = normalizeSong(d.song || d);
      if(!song.title) song.title='Sin título';
      const rec = { libId:uid(), song, genre:song.genre||'', favorite:false, createdAt:Date.now(), updatedAt:Date.now() };
      LIB.records.unshift(rec);
      libSave(); libRender();
      flash(`"${song.title}" importada`);
    }catch(err){ alert('Error al importar: '+err.message); }
  };
  r.readAsText(f); e.target.value='';
}

/* ════════ ROUTER ════════ */
function showScreen(name){
  $$('.screen').forEach(s=>s.classList.remove('active'));
  $('#screen-'+name).classList.add('active');
}

/* Open a song record in the workbench */
function libOpen(id, isNew){
  const r = LIB.records.find(x=>x.libId===id); if(!r) return;
  LIB.current = id;
  // Deep copy so workbench edits don't mutate the library until we save back
  STATE.song = normalizeSong(JSON.parse(JSON.stringify(r.song)));
  STATE.ui.activeChannelId = STATE.song.channels[0]?.id || null;
  STATE.ui.lyricsTab = null; // recompute the lyrics sub-tab default for this song
  STATE.ui.currentBlockIndex = 0;
  STATE.ui.currentBeat = 0;
  if(isNew){
    // A brand-new song opens straight on the Lyrics paste view so you can paste first.
    const lyCh = STATE.song.channels.find(c=>c.type==='lyrics');
    if(lyCh){ STATE.ui.activeChannelId = lyCh.id; STATE.ui.lyricsTab = 'lyrics'; STATE.ui.view = 'channel'; }
    else STATE.ui.view = 'summary';
  } else {
    STATE.ui.view = 'summary';
  }
  $$('.view-tab').forEach(t=>t.classList.toggle('active', t.dataset.view===STATE.ui.view));
  showScreen('workbench');
  renderAll();
  renderBeatLeds();
  $('#autoScroll').classList.toggle('on', STATE.ui.autoScroll);
}

/* Persist current workbench edits back into the library, then go home */
function libBack(){
  if(STATE.ui.isPlaying) stopPlayback();
  if(LIB.current){
    const r = LIB.records.find(x=>x.libId===LIB.current);
    if(r){
      r.song = JSON.parse(JSON.stringify(STATE.song));
      r.genre = STATE.song.genre || r.genre || '';
      r.updatedAt = Date.now();
      libSave();
    }
  }
  LIB.current = null;
  showScreen('library');
  libRender();
}

/* ── Library event bindings ──────────────────────────────────── */
function libBind(){
  $('#libSearch').addEventListener('input', e=>{ LIB.search=e.target.value; libRender(); });
  $$('#screen-library [data-nav]').forEach(el=>el.addEventListener('click',()=>{
    LIB.nav = el.dataset.nav; LIB.genre=null;
    $$('#screen-library [data-nav]').forEach(x=>x.classList.toggle('active', x===el));
    libRender();
  }));
  $$('#libSort button').forEach(b=>b.addEventListener('click',()=>{
    LIB.sort=b.dataset.sort; LIB.sortDir=1;
    $$('#libSort button').forEach(x=>x.classList.toggle('active', x===b));
    libRender();
  }));
  $$('#libView button').forEach(b=>b.addEventListener('click',()=>{
    LIB.view=b.dataset.view;
    $$('#libView button').forEach(x=>x.classList.toggle('active', x===b));
    libRender();
  }));
  $('#libNewBtn').addEventListener('click', libOpenNew);
  $('#libImportBtn').addEventListener('click', ()=>$('#libImportFile').click());
  $('#libImportFile').addEventListener('change', libHandleImport);
  $('#ns_cancel').addEventListener('click', libCloseNew);
  $('#ns_create').addEventListener('click', libCreateNew);
  // mobile sidebar
  const toggleSide=()=>{ $('#libSidebar').classList.toggle('open'); $('#libOverlay').classList.toggle('show'); };
  $('#libMenuBtn').addEventListener('click', toggleSide);
  $('#libOverlay').addEventListener('click', toggleSide);
  // modal mask click + keyboard
  $('#newSongModal').addEventListener('click', e=>{ if(e.target.id==='newSongModal') libCloseNew(); });
  document.addEventListener('keydown', e=>{
    if(e.key==='Escape') $('#newSongModal').classList.remove('show');
    if(e.key==='Enter' && $('#newSongModal').classList.contains('show')) libCreateNew();
  });
}

/* ── Seed (first run): "Nunca Quise" by Intoxicados ──────────── */
const SEED_SONGS = [{"title": "Nunca Quise", "artist": "Intoxicados", "link": "", "bpm": 120, "signature": "4/4", "blocks": [{"id": "id_e5azbab", "section": "INTRO", "bars": 9, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": ""}, "id_lfprcii": {"chords": [{"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 8}], "notes": ""}, "id_4clocjv": {"tab": "e|--------------------------------------------------------------------------------------------------------------------------------------|\nB|--------------------------------------------------------------------------------------------------------------------------------------|\nG|------------9/11-13/14--11--------------------9/11-13/14--11------9/7-6-----------------------4----6-----7---4------------------------|\nD|--------------------------------------------------------------------------------------------------------------------------------------|\nA|------------7/9--11/12--9---------------------7/9--11/12--9-------7/5--4----------------------2----4-----5---2------------------------|\nE|--------------------------------------------------------------------------------------------------------------------------------------|"}}}, {"id": "id_90t9ug4", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Nunca quise tanto a nadie como a vos\nPor eso es que empiezo a dudar\nSi seremos hermanos que nos separaron\nY nosotros, sin saberlo, nos volvimos a juntar"}, "id_lfprcii": {"chords": ["D", "Bm", "C#m", "F#m", "Bm", "E", "A", "A7"], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_d4c4bnw", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Tu sangre es roja, la mía también\nPero no me equivoco, algo tendremos que ver\nSomos indios latinos con guitarra eléctrica\nY comunicados a través de internet"}, "id_lfprcii": {"chords": [{"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A7", "beats": 4}], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_vqtky58", "section": "CHORUS", "bars": 9, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Para odiar, hay que querer\nPara destruir, hay que hacer\nY estoy orgulloso de quererte romper\nLa cabeza contra la pared, sí"}, "id_lfprcii": {"chords": [{"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 8}], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_rjhpuc5", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Y por todas esas cosas que tenemos en común\nHace tiempo ya marchaste de acá\nTe cansaste de mí, yo me cansé de vos\nPero cuando nos miramos sabemos que no es verdad"}, "id_lfprcii": {"chords": [{"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A7", "beats": 4}], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_fne07db", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Porque tanto te quise y tanto te quiero\nSiempre, una marca tuya, llevará mi corazón\nDisculpa si te parece raro, pero comparto la opinión\nQue escuché en una canción (let it be)"}, "id_lfprcii": {"chords": [{"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A7", "beats": 4}], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_7bwefzm", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Si la amas, déjala ser, si la quieres, déjala volar\nNunca fui tu patrón, no quisiera cambiarte\nY no quiero que pierdas tu personalidad"}, "id_lfprcii": {"chords": [{"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A7", "beats": 4}], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_k5cyc7x", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Para odiar, hay que querer\nPara destruir, hay que hacer\nY estoy orgulloso de quererte romper\nLa cabeza contra la pared, sí"}, "id_lfprcii": {"chords": [], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_q3g7r0h", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Para odiar, hay que querer\nPara destruir, hay que hacer\nY estoy orgulloso de quererte romper\nLa cabeza contra la pared"}, "id_lfprcii": {"chords": [], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_61rd3tu", "section": "VERSE", "bars": 4, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Para dejar, hay que beber\nPara morir, primero, hay que nacer\nSiento ganas nuevamente de tirarme a tus pies\nY llevarte a mi morada otra vez"}, "id_lfprcii": {"chords": [], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}, {"id": "id_urqvctj", "section": "VERSE", "bars": 4, "enabled": true, "comment": "", "content": {"id_elmycwc": {"text": "Si lo sembrás, lo recogés\nY si esperás, vas a entender\nCuando las cosas salen como no las espero\nLa vida me hace más guerrero"}, "id_lfprcii": {"chords": [], "notes": ""}, "id_4clocjv": {"tab": "e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|"}}}], "channels": [{"id": "id_elmycwc", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_lfprcii", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}, {"id": "id_4clocjv", "name": "Primera", "type": "lead", "color": "#e05c3a", "muted": false}], "progressions": [{"id": "id_fufpwcn", "name": "Verso_Chords_8", "chords": [{"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A7", "beats": 4}]}, {"id": "id_8oroozy", "name": "IntrCoro_Chords_9", "chords": [{"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "A", "beats": 4}, {"name": "D", "beats": 2}, {"name": "E", "beats": 2}, {"name": "F#m", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "E", "beats": 8}]}], "genre": "Rock"}];
function librarySeed(){
  SEED_SONGS.forEach((song, i)=>{
    LIB.records.push({
      libId: uid(),
      song: normalizeSong(song),
      genre: song.genre || '',
      favorite: i===0,
      createdAt: Date.now() - i*8.64e7,
      updatedAt: Date.now() - i*8.64e7,
    });
  });
}

/* 25 famous songs (5 each: rock, reggae, pop, jazz, blues) — title/artist/genre/
   tempo/signature + chord progressions per channel. Lyrics are intentionally
   left empty (copyrighted). Seeded ONCE (idempotent by title+artist) so they
   appear for existing users too, without coming back after you delete them. */
const FAMOUS_SONGS = [{"title": "Bohemian Rhapsody", "artist": "Queen", "link": "", "bpm": 72, "signature": "4/4", "genre": "Rock", "channels": [{"id": "id_hbrpoig", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_8f1cbfn", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_o6b9m80", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_hbrpoig": {"text": ""}, "id_8f1cbfn": {"chords": [{"name": "Bb", "beats": 8}, {"name": "Gm", "beats": 8}], "notes": ""}}}, {"id": "id_o2rak1v", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_hbrpoig": {"text": ""}, "id_8f1cbfn": {"chords": [{"name": "Bb", "beats": 4}, {"name": "Gm", "beats": 4}, {"name": "Cm", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Eb", "beats": 4}, {"name": "Cm", "beats": 4}, {"name": "F", "beats": 4}], "notes": ""}}}, {"id": "id_rjnvgfy", "section": "BALLAD", "bars": 8, "enabled": true, "comment": "", "content": {"id_hbrpoig": {"text": ""}, "id_8f1cbfn": {"chords": [{"name": "Eb", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Eb", "beats": 4}, {"name": "Cm", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Eb", "beats": 4}], "notes": ""}}}, {"id": "id_gwwqc38", "section": "GUITAR", "bars": 4, "enabled": true, "comment": "", "content": {"id_hbrpoig": {"text": ""}, "id_8f1cbfn": {"chords": [{"name": "Eb", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}], "notes": ""}}}, {"id": "id_hyf9sxm", "section": "OUTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_hbrpoig": {"text": ""}, "id_8f1cbfn": {"chords": [{"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Stairway to Heaven", "artist": "Led Zeppelin", "link": "", "bpm": 82, "signature": "4/4", "genre": "Rock", "channels": [{"id": "id_ecosfog", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_yr3xkxw", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_nrek8pk", "section": "INTRO", "bars": 8, "enabled": true, "comment": "", "content": {"id_ecosfog": {"text": ""}, "id_yr3xkxw": {"chords": [{"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "F", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_3yr9oud", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_ecosfog": {"text": ""}, "id_yr3xkxw": {"chords": [{"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_ocuzren", "section": "BRIDGE", "bars": 4, "enabled": true, "comment": "", "content": {"id_ecosfog": {"text": ""}, "id_yr3xkxw": {"chords": [{"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Am", "beats": 4}], "notes": ""}}}, {"id": "id_un5z3jq", "section": "SOLO", "bars": 8, "enabled": true, "comment": "", "content": {"id_ecosfog": {"text": ""}, "id_yr3xkxw": {"chords": [{"name": "Am", "beats": 4}, {"name": "G", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "G", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}, {"id": "id_ip98q1z", "section": "OUTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_ecosfog": {"text": ""}, "id_yr3xkxw": {"chords": [{"name": "Am", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Am", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Smells Like Teen Spirit", "artist": "Nirvana", "link": "", "bpm": 117, "signature": "4/4", "genre": "Rock", "channels": [{"id": "id_xoi65fd", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_hjk1eyy", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_37q9ah8", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_xoi65fd": {"text": ""}, "id_hjk1eyy": {"chords": [{"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}], "notes": ""}}}, {"id": "id_rvhs1k3", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_xoi65fd": {"text": ""}, "id_hjk1eyy": {"chords": [{"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}], "notes": ""}}}, {"id": "id_aq6l6gt", "section": "PRECHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_xoi65fd": {"text": ""}, "id_hjk1eyy": {"chords": [{"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}], "notes": ""}}}, {"id": "id_6mjxk87", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_xoi65fd": {"text": ""}, "id_hjk1eyy": {"chords": [{"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "Ab", "beats": 4}, {"name": "Db", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Sweet Child O' Mine", "artist": "Guns N' Roses", "link": "", "bpm": 125, "signature": "4/4", "genre": "Rock", "channels": [{"id": "id_au5bhxt", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_pdpff5e", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_8ii49kq", "section": "INTRO", "bars": 8, "enabled": true, "comment": "", "content": {"id_au5bhxt": {"text": ""}, "id_pdpff5e": {"chords": [{"name": "D", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_71n8mtz", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_au5bhxt": {"text": ""}, "id_pdpff5e": {"chords": [{"name": "D", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_x272hpo", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_au5bhxt": {"text": ""}, "id_pdpff5e": {"chords": [{"name": "Em", "beats": 4}, {"name": "G", "beats": 4}, {"name": "A", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "G", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}, {"id": "id_evb9ooa", "section": "BRIDGE", "bars": 8, "enabled": true, "comment": "", "content": {"id_au5bhxt": {"text": ""}, "id_pdpff5e": {"chords": [{"name": "Em", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "C", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "C", "beats": 4}], "notes": ""}}}, {"id": "id_edoecve", "section": "OUTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_au5bhxt": {"text": ""}, "id_pdpff5e": {"chords": [{"name": "D", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Hotel California", "artist": "Eagles", "link": "", "bpm": 75, "signature": "4/4", "genre": "Rock", "channels": [{"id": "id_6pr5n8i", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_4p40mgg", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_1w103dg", "section": "INTRO", "bars": 8, "enabled": true, "comment": "", "content": {"id_6pr5n8i": {"text": ""}, "id_4p40mgg": {"chords": [{"name": "Bm", "beats": 4}, {"name": "F#", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "F#", "beats": 4}], "notes": ""}}}, {"id": "id_dzvgpmm", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_6pr5n8i": {"text": ""}, "id_4p40mgg": {"chords": [{"name": "Bm", "beats": 4}, {"name": "F#", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "F#", "beats": 4}], "notes": ""}}}, {"id": "id_82i1lr3", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_6pr5n8i": {"text": ""}, "id_4p40mgg": {"chords": [{"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "F#", "beats": 4}], "notes": ""}}}, {"id": "id_pe29gd8", "section": "SOLO", "bars": 8, "enabled": true, "comment": "", "content": {"id_6pr5n8i": {"text": ""}, "id_4p40mgg": {"chords": [{"name": "Bm", "beats": 4}, {"name": "F#", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "G", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "F#", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "No Woman, No Cry", "artist": "Bob Marley", "link": "", "bpm": 78, "signature": "4/4", "genre": "Reggae", "channels": [{"id": "id_afpk054", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_nzdkyay", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_q3s195j", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_afpk054": {"text": ""}, "id_nzdkyay": {"chords": [{"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "F", "beats": 4}], "notes": ""}}}, {"id": "id_msnd8du", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_afpk054": {"text": ""}, "id_nzdkyay": {"chords": [{"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}, {"id": "id_dd467kd", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_afpk054": {"text": ""}, "id_nzdkyay": {"chords": [{"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Three Little Birds", "artist": "Bob Marley", "link": "", "bpm": 76, "signature": "4/4", "genre": "Reggae", "channels": [{"id": "id_6fleepz", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_hpcf07u", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_qnupqzi", "section": "VERSE", "bars": 4, "enabled": true, "comment": "", "content": {"id_6fleepz": {"text": ""}, "id_hpcf07u": {"chords": [{"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}, {"id": "id_t3uea3g", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_6fleepz": {"text": ""}, "id_hpcf07u": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}, {"id": "id_e8n6qiw", "section": "VERSE", "bars": 4, "enabled": true, "comment": "", "content": {"id_6fleepz": {"text": ""}, "id_hpcf07u": {"chords": [{"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Could You Be Loved", "artist": "Bob Marley", "link": "", "bpm": 103, "signature": "4/4", "genre": "Reggae", "channels": [{"id": "id_epxsk28", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_t7a9tgi", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_qhg9jrs", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_epxsk28": {"text": ""}, "id_t7a9tgi": {"chords": [{"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_nvnq65q", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_epxsk28": {"text": ""}, "id_t7a9tgi": {"chords": [{"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}, {"id": "id_df1rcav", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_epxsk28": {"text": ""}, "id_t7a9tgi": {"chords": [{"name": "G", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "G", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Red Red Wine", "artist": "UB40", "link": "", "bpm": 92, "signature": "4/4", "genre": "Reggae", "channels": [{"id": "id_iqk2919", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_ahej8cx", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_9j1ictx", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_iqk2919": {"text": ""}, "id_ahej8cx": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}, {"id": "id_cwnpgw9", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_iqk2919": {"text": ""}, "id_ahej8cx": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Is This Love", "artist": "Bob Marley", "link": "", "bpm": 80, "signature": "4/4", "genre": "Reggae", "channels": [{"id": "id_0jpkl0b", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_lv0prkg", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_yc4om3w", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_0jpkl0b": {"text": ""}, "id_lv0prkg": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}, {"id": "id_toobmzv", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_0jpkl0b": {"text": ""}, "id_lv0prkg": {"chords": [{"name": "Bm", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}, {"id": "id_rerw6z8", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_0jpkl0b": {"text": ""}, "id_lv0prkg": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Billie Jean", "artist": "Michael Jackson", "link": "", "bpm": 117, "signature": "4/4", "genre": "Pop", "channels": [{"id": "id_vbhqlqc", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_g1wu16h", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_ymqc1a7", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_vbhqlqc": {"text": ""}, "id_g1wu16h": {"chords": [{"name": "F#m", "beats": 4}, {"name": "G#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}, {"id": "id_8mx1evu", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_vbhqlqc": {"text": ""}, "id_g1wu16h": {"chords": [{"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}], "notes": ""}}}, {"id": "id_ht6t0uz", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_vbhqlqc": {"text": ""}, "id_g1wu16h": {"chords": [{"name": "F#m", "beats": 4}, {"name": "G#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "F#m", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Like a Prayer", "artist": "Madonna", "link": "", "bpm": 100, "signature": "4/4", "genre": "Pop", "channels": [{"id": "id_s9im0yl", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_tz9atsn", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_1u322n6", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_s9im0yl": {"text": ""}, "id_tz9atsn": {"chords": [{"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}, {"id": "id_4kfs6vf", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_s9im0yl": {"text": ""}, "id_tz9atsn": {"chords": [{"name": "Dm", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "F", "beats": 4}, {"name": "Bb", "beats": 4}, {"name": "F", "beats": 4}], "notes": ""}}}, {"id": "id_ptomjbc", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_s9im0yl": {"text": ""}, "id_tz9atsn": {"chords": [{"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Shape of You", "artist": "Ed Sheeran", "link": "", "bpm": 96, "signature": "4/4", "genre": "Pop", "channels": [{"id": "id_p4e30my", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_5zpjag1", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_ol73d9p", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_p4e30my": {"text": ""}, "id_5zpjag1": {"chords": [{"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}, {"id": "id_h3i379u", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_p4e30my": {"text": ""}, "id_5zpjag1": {"chords": [{"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}, {"name": "C#m", "beats": 4}, {"name": "F#m", "beats": 4}, {"name": "A", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Rolling in the Deep", "artist": "Adele", "link": "", "bpm": 105, "signature": "4/4", "genre": "Pop", "channels": [{"id": "id_26192k4", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_2qpr75p", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_r2esprv", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_26192k4": {"text": ""}, "id_2qpr75p": {"chords": [{"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}], "notes": ""}}}, {"id": "id_u8fijoy", "section": "PRECHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_26192k4": {"text": ""}, "id_2qpr75p": {"chords": [{"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}, {"id": "id_jne00v8", "section": "CHORUS", "bars": 8, "enabled": true, "comment": "", "content": {"id_26192k4": {"text": ""}, "id_2qpr75p": {"chords": [{"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "F", "beats": 4}, {"name": "C", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Am", "beats": 4}, {"name": "Am", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Uptown Funk", "artist": "Bruno Mars", "link": "", "bpm": 115, "signature": "4/4", "genre": "Pop", "channels": [{"id": "id_30dn0yb", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_y4awty0", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_88o5or1", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_30dn0yb": {"text": ""}, "id_y4awty0": {"chords": [{"name": "Dm", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "Dm", "beats": 4}], "notes": ""}}}, {"id": "id_5byvzk3", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_30dn0yb": {"text": ""}, "id_y4awty0": {"chords": [{"name": "Dm", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "G", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "G", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}, {"id": "id_i8bzbf1", "section": "CHORUS", "bars": 4, "enabled": true, "comment": "", "content": {"id_30dn0yb": {"text": ""}, "id_y4awty0": {"chords": [{"name": "Dm", "beats": 4}, {"name": "G", "beats": 4}, {"name": "Dm", "beats": 4}, {"name": "G", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Take Five", "artist": "Dave Brubeck", "link": "", "bpm": 174, "signature": "5/4", "genre": "Jazz", "channels": [{"id": "id_i3ldqyu", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_n3uvyr0", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_qf4b8dw", "section": "HEAD", "bars": 8, "enabled": true, "comment": "", "content": {"id_i3ldqyu": {"text": ""}, "id_n3uvyr0": {"chords": [{"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}], "notes": ""}}}, {"id": "id_oecbpmb", "section": "BRIDGE", "bars": 8, "enabled": true, "comment": "", "content": {"id_i3ldqyu": {"text": ""}, "id_n3uvyr0": {"chords": [{"name": "Bbm", "beats": 5}, {"name": "Gb", "beats": 5}, {"name": "Cb", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Gb", "beats": 5}, {"name": "Cb", "beats": 5}, {"name": "Bbm", "beats": 5}], "notes": ""}}}, {"id": "id_jpi4hn3", "section": "SOLO", "bars": 8, "enabled": true, "comment": "", "content": {"id_i3ldqyu": {"text": ""}, "id_n3uvyr0": {"chords": [{"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}, {"name": "Ebm", "beats": 5}, {"name": "Bbm", "beats": 5}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "So What", "artist": "Miles Davis", "link": "", "bpm": 136, "signature": "4/4", "genre": "Jazz", "channels": [{"id": "id_qxkhktg", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_btyzmep", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_gthcw81", "section": "HEAD", "bars": 16, "enabled": true, "comment": "", "content": {"id_qxkhktg": {"text": ""}, "id_btyzmep": {"chords": [{"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}], "notes": ""}}}, {"id": "id_xe6va05", "section": "SOLO", "bars": 16, "enabled": true, "comment": "", "content": {"id_qxkhktg": {"text": ""}, "id_btyzmep": {"chords": [{"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Ebm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "Dm7", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Fly Me to the Moon", "artist": "Frank Sinatra", "link": "", "bpm": 120, "signature": "4/4", "genre": "Jazz", "channels": [{"id": "id_g1x3j1l", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_7r8431r", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_upfr2p3", "section": "HEAD", "bars": 8, "enabled": true, "comment": "", "content": {"id_g1x3j1l": {"text": ""}, "id_7r8431r": {"chords": [{"name": "Am7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "G7", "beats": 4}, {"name": "Cmaj7", "beats": 4}, {"name": "Fmaj7", "beats": 4}, {"name": "Bm7b5", "beats": 4}, {"name": "E7", "beats": 4}, {"name": "Am7", "beats": 4}], "notes": ""}}}, {"id": "id_yvb5ul5", "section": "BRIDGE", "bars": 8, "enabled": true, "comment": "", "content": {"id_g1x3j1l": {"text": ""}, "id_7r8431r": {"chords": [{"name": "Dm7", "beats": 4}, {"name": "G7", "beats": 4}, {"name": "Cmaj7", "beats": 4}, {"name": "Am7", "beats": 4}, {"name": "Dm7", "beats": 4}, {"name": "G7", "beats": 4}, {"name": "Cmaj7", "beats": 4}, {"name": "E7", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Autumn Leaves", "artist": "Standard", "link": "", "bpm": 120, "signature": "4/4", "genre": "Jazz", "channels": [{"id": "id_nwqvrr9", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_a7mfp05", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_9p452bf", "section": "A", "bars": 8, "enabled": true, "comment": "", "content": {"id_nwqvrr9": {"text": ""}, "id_a7mfp05": {"chords": [{"name": "Cm7", "beats": 4}, {"name": "F7", "beats": 4}, {"name": "Bbmaj7", "beats": 4}, {"name": "Ebmaj7", "beats": 4}, {"name": "Am7b5", "beats": 4}, {"name": "D7", "beats": 4}, {"name": "Gm", "beats": 4}, {"name": "Gm", "beats": 4}], "notes": ""}}}, {"id": "id_sozptx4", "section": "B", "bars": 8, "enabled": true, "comment": "", "content": {"id_nwqvrr9": {"text": ""}, "id_a7mfp05": {"chords": [{"name": "Am7b5", "beats": 4}, {"name": "D7", "beats": 4}, {"name": "Gm", "beats": 4}, {"name": "Gm", "beats": 4}, {"name": "Cm7", "beats": 4}, {"name": "F7", "beats": 4}, {"name": "Bbmaj7", "beats": 4}, {"name": "Ebmaj7", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "My Favorite Things", "artist": "John Coltrane", "link": "", "bpm": 130, "signature": "3/4", "genre": "Jazz", "channels": [{"id": "id_97w19vw", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_3rtqohm", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_uh8lmn4", "section": "A", "bars": 8, "enabled": true, "comment": "", "content": {"id_97w19vw": {"text": ""}, "id_3rtqohm": {"chords": [{"name": "Em", "beats": 3}, {"name": "Em", "beats": 3}, {"name": "Em", "beats": 3}, {"name": "Em", "beats": 3}, {"name": "C", "beats": 3}, {"name": "C", "beats": 3}, {"name": "Em", "beats": 3}, {"name": "Em", "beats": 3}], "notes": ""}}}, {"id": "id_r7sgmso", "section": "B", "bars": 8, "enabled": true, "comment": "", "content": {"id_97w19vw": {"text": ""}, "id_3rtqohm": {"chords": [{"name": "Emaj7", "beats": 3}, {"name": "Emaj7", "beats": 3}, {"name": "F#m7", "beats": 3}, {"name": "B7", "beats": 3}, {"name": "Emaj7", "beats": 3}, {"name": "Emaj7", "beats": 3}, {"name": "F#m7", "beats": 3}, {"name": "B7", "beats": 3}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "The Thrill Is Gone", "artist": "B.B. King", "link": "", "bpm": 78, "signature": "4/4", "genre": "Blues", "channels": [{"id": "id_xlta8ir", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_cd9si5g", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_as442vl", "section": "VERSE", "bars": 8, "enabled": true, "comment": "", "content": {"id_xlta8ir": {"text": ""}, "id_cd9si5g": {"chords": [{"name": "Bm", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "Em", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "Bm", "beats": 4}, {"name": "Gmaj7", "beats": 4}, {"name": "F#7", "beats": 4}], "notes": ""}}}, {"id": "id_dq4hez5", "section": "TURN", "bars": 4, "enabled": true, "comment": "", "content": {"id_xlta8ir": {"text": ""}, "id_cd9si5g": {"chords": [{"name": "Bm", "beats": 4}, {"name": "Gmaj7", "beats": 4}, {"name": "F#7", "beats": 4}, {"name": "Bm", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Pride and Joy", "artist": "Stevie Ray Vaughan", "link": "", "bpm": 130, "signature": "4/4", "genre": "Blues", "channels": [{"id": "id_edjjtfp", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_h90o7y2", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_2t1tdgn", "section": "VERSE", "bars": 12, "enabled": true, "comment": "", "content": {"id_edjjtfp": {"text": ""}, "id_h90o7y2": {"chords": [{"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}, {"id": "id_nqfkpl9", "section": "SOLO", "bars": 12, "enabled": true, "comment": "", "content": {"id_edjjtfp": {"text": ""}, "id_h90o7y2": {"chords": [{"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Sweet Home Chicago", "artist": "Robert Johnson", "link": "", "bpm": 110, "signature": "4/4", "genre": "Blues", "channels": [{"id": "id_eka024s", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_coss3eo", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_qm1h8oj", "section": "VERSE", "bars": 12, "enabled": true, "comment": "", "content": {"id_eka024s": {"text": ""}, "id_coss3eo": {"chords": [{"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}, {"id": "id_rjedkts", "section": "VERSE", "bars": 12, "enabled": true, "comment": "", "content": {"id_eka024s": {"text": ""}, "id_coss3eo": {"chords": [{"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "B", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Hoochie Coochie Man", "artist": "Muddy Waters", "link": "", "bpm": 80, "signature": "4/4", "genre": "Blues", "channels": [{"id": "id_2h3tzr6", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_852fc1u", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_qbfobrc", "section": "VERSE", "bars": 12, "enabled": true, "comment": "", "content": {"id_2h3tzr6": {"text": ""}, "id_852fc1u": {"chords": [{"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}, {"title": "Crossroads", "artist": "Cream", "link": "", "bpm": 115, "signature": "4/4", "genre": "Blues", "channels": [{"id": "id_l472rl1", "name": "Vocals", "type": "lyrics", "color": "#4f6ef7", "muted": false}, {"id": "id_5f4w0vu", "name": "Ritmica", "type": "rhythm", "color": "#2a9d8f", "muted": false}], "blocks": [{"id": "id_gkv05sz", "section": "INTRO", "bars": 4, "enabled": true, "comment": "", "content": {"id_l472rl1": {"text": ""}, "id_5f4w0vu": {"chords": [{"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}], "notes": ""}}}, {"id": "id_9c3fuqu", "section": "VERSE", "bars": 12, "enabled": true, "comment": "", "content": {"id_l472rl1": {"text": ""}, "id_5f4w0vu": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}, {"id": "id_hz6a830", "section": "SOLO", "bars": 12, "enabled": true, "comment": "", "content": {"id_l472rl1": {"text": ""}, "id_5f4w0vu": {"chords": [{"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "D", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}, {"name": "D", "beats": 4}, {"name": "A", "beats": 4}, {"name": "E", "beats": 4}], "notes": ""}}}], "progressions": [], "library": {"riffs": []}}];
function librarySeedFamous(){
  try{ if(localStorage.getItem('muss_famous_seeded_v1')) return; }catch(e){ return; }
  let added=0;
  FAMOUS_SONGS.forEach(song=>{
    const dup=LIB.records.some(r=>meta.title(r).toLowerCase()===song.title.toLowerCase() && meta.artist(r).toLowerCase()===song.artist.toLowerCase());
    if(!dup){
      LIB.records.push({ libId:uid(), song:normalizeSong(JSON.parse(JSON.stringify(song))),
        genre:song.genre||'', favorite:false, createdAt:Date.now(), updatedAt:Date.now() });
      added++;
    }
  });
  if(added) libSave();
  try{ localStorage.setItem('muss_famous_seeded_v1','1'); }catch(e){}
}


init();