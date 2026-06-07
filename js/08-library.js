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
function libRender(){ libUpdateCounts(); libRenderGenres(); libRenderList(); }

function libUpdateCounts(){
  const all = LIB.records.length;
  const recent = LIB.records.filter(r => (r.updatedAt||r.createdAt) > Date.now()-8.64e7*30).length;
  const fav = LIB.records.filter(r => r.favorite).length;
  $('#cntAll').textContent = all;
  $('#cntRecent').textContent = recent;
  $('#cntFav').textContent = fav;
  const vis = libFiltered().length;
  const titles = { all:'Todas las canciones', recent:'Recientes', favorites:'Favoritas' };
  const sub = `${vis} canción${vis!==1?'es':''}${LIB.genre?` · ${escapeHTML(LIB.genre)}`:''}`;
  $('#libTitle').innerHTML = `${escapeHTML(titles[LIB.nav])} <span>— ${sub}</span>`;
}

function libRenderGenres(){
  const counts = {};
  LIB.records.forEach(r => { const g=meta.genre(r); (counts[g] ??= 0, counts[g]++); });
  const el = $('#libGenres'); el.innerHTML='';
  const all = document.createElement('div');
  all.className = 'lib-genre'+(LIB.genre===null?' active':'');
  all.innerHTML = `<div class="lib-dot" style="background:var(--accent-dim)"></div><span class="lib-genre-name">Todos</span><span class="lib-genre-count">${LIB.records.length}</span>`;
  all.onclick = ()=>{ LIB.genre=null; libRender(); };
  el.appendChild(all);
  Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([g,c])=>{
    const d = document.createElement('div');
    d.className = 'lib-genre'+(LIB.genre===g?' active':'');
    d.innerHTML = `<div class="lib-dot" style="background:${genreColor(g)}"></div><span class="lib-genre-name">${escapeHTML(g||'Sin género')}</span><span class="lib-genre-count">${c}</span>`;
    d.onclick = ()=>{ LIB.genre=g; libRender(); };
    el.appendChild(d);
  });
}

function libRenderList(){
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
  libOpen(rec.libId);  // jump straight into the editor
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
function libOpen(id){
  const r = LIB.records.find(x=>x.libId===id); if(!r) return;
  LIB.current = id;
  // Deep copy so workbench edits don't mutate the library until we save back
  STATE.song = normalizeSong(JSON.parse(JSON.stringify(r.song)));
  STATE.ui.activeChannelId = STATE.song.channels[0]?.id || null;
  STATE.ui.view = 'overview';
  STATE.ui.currentBlockIndex = 0;
  STATE.ui.currentBeat = 0;
  $$('.view-tab').forEach(t=>t.classList.toggle('active', t.dataset.view==='overview'));
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


init();