/* ═══════════════════════════════════════════════════════════
   CHORD CATALOG — built-in + user chord library
   Multi-instrument, multi-voicing. Persists to localStorage.
   ═══════════════════════════════════════════════════════════ */

const CC_STORAGE_KEY = 'muss_chord_catalog_v1';
const CHROMATIC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_ALIASES = {Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};
function normalizeNote(n){return NOTE_ALIASES[n]||n}
function noteIdx(n){return CHROMATIC.indexOf(normalizeNote(n))}
function noteFromIdx(i){return CHROMATIC[((i%12)+12)%12]}

/* Interval → semitones map (root=0) */
const INTERVAL_SEMITONES = {
  '1':0,'b2':1,'2':2,'#2':3,'b3':3,'3':4,'4':5,'#4':6,'b5':6,'5':7,'#5':8,'b6':8,'6':9,'bb7':9,'b7':10,'7':11,
  'b9':13,'9':14,'#9':15,'11':17,'#11':18,'b13':20,'13':21,
};

/* Chord quality formulas (intervals from root) */
const QUALITY_FORMULAS = {
  '':       {intervals:['1','3','5'],          label:'Major'},
  'maj':    {intervals:['1','3','5'],          label:'Major'},
  'M':      {intervals:['1','3','5'],          label:'Major'},
  'm':      {intervals:['1','b3','5'],         label:'Minor'},
  'min':    {intervals:['1','b3','5'],         label:'Minor'},
  '5':      {intervals:['1','5'],              label:'Power chord'},
  '6':      {intervals:['1','3','5','6'],      label:'Major 6th'},
  'm6':     {intervals:['1','b3','5','6'],     label:'Minor 6th'},
  '7':      {intervals:['1','3','5','b7'],     label:'Dominant 7th'},
  'maj7':   {intervals:['1','3','5','7'],      label:'Major 7th'},
  'm7':     {intervals:['1','b3','5','b7'],    label:'Minor 7th'},
  'mMaj7':  {intervals:['1','b3','5','7'],     label:'Minor-Major 7th'},
  'dim':    {intervals:['1','b3','b5'],        label:'Diminished'},
  'dim7':   {intervals:['1','b3','b5','bb7'],  label:'Diminished 7th'},
  'm7b5':   {intervals:['1','b3','b5','b7'],   label:'Half-diminished'},
  'aug':    {intervals:['1','3','#5'],         label:'Augmented'},
  'sus2':   {intervals:['1','2','5'],          label:'Suspended 2'},
  'sus4':   {intervals:['1','4','5'],          label:'Suspended 4'},
  '7sus4':  {intervals:['1','4','5','b7'],     label:'Dominant 7 sus4'},
  'add9':   {intervals:['1','3','5','9'],      label:'Add 9'},
  '9':      {intervals:['1','3','5','b7','9'], label:'Dominant 9th'},
  'maj9':   {intervals:['1','3','5','7','9'],  label:'Major 9th'},
  'm9':     {intervals:['1','b3','5','b7','9'],label:'Minor 9th'},
};

/* Parse a chord name → {root, quality} */
function parseChordName(name){
  const m = (name||'').match(/^([A-G][#b]?)(.*)$/);
  if(!m) return {root:'C',quality:''};
  return {root:normalizeNote(m[1]), quality:m[2]||''};
}
/* Compute notes for a chord from root + quality formula */
function computeChordNotes(root,quality){
  const f = QUALITY_FORMULAS[quality] || QUALITY_FORMULAS[''];
  const rootIdx = noteIdx(root);
  if(rootIdx<0) return [];
  return f.intervals.map(i=>{
    const s = INTERVAL_SEMITONES[i];
    return s==null ? null : noteFromIdx(rootIdx+s);
  }).filter(Boolean);
}
function chordCategoryOf(quality){
  if(/^(maj|M|)$/.test(quality)) return 'major';
  if(/^m$|^min$/.test(quality)) return 'minor';
  if(/^7$|^9$/.test(quality)) return 'dom';
  if(/maj7|maj9/.test(quality)) return 'maj7';
  if(/^m7|^m9|mMaj/.test(quality)) return 'min7';
  if(/dim/.test(quality)) return 'dim';
  if(/aug/.test(quality)) return 'aug';
  if(/sus/.test(quality)) return 'sus';
  if(/^5$/.test(quality)) return 'power';
  return 'other';
}

/* ── Built-in seed catalog (common guitar chords) ── */
/* frets: [low-E, A, D, G, B, high-E]  · -1 = mute · 0 = open */
const BUILTIN_CHORDS = [
  // Major open
  {name:'C',  frets:[-1,3,2,0,1,0], fingers:[null,3,2,null,1,null]},
  {name:'D',  frets:[-1,-1,0,2,3,2],fingers:[null,null,null,1,3,2]},
  {name:'E',  frets:[0,2,2,1,0,0],  fingers:[null,2,3,1,null,null]},
  {name:'F',  frets:[1,3,3,2,1,1],  fingers:[1,3,4,2,1,1], barre:{fret:1,fromString:6,toString:1}},
  {name:'G',  frets:[3,2,0,0,0,3],  fingers:[3,2,null,null,null,4]},
  {name:'A',  frets:[-1,0,2,2,2,0], fingers:[null,null,1,2,3,null]},
  {name:'B',  frets:[-1,2,4,4,4,2], fingers:[null,1,3,3,3,1], barre:{fret:2,fromString:5,toString:1}},
  // Minor open
  {name:'Am', frets:[-1,0,2,2,1,0], fingers:[null,null,2,3,1,null]},
  {name:'Dm', frets:[-1,-1,0,2,3,1],fingers:[null,null,null,2,3,1]},
  {name:'Em', frets:[0,2,2,0,0,0],  fingers:[null,2,3,null,null,null]},
  {name:'Bm', frets:[-1,2,4,4,3,2], fingers:[null,1,3,4,2,1], barre:{fret:2,fromString:5,toString:1}},
  {name:'F#m',frets:[2,4,4,2,2,2],  fingers:[1,3,4,1,1,1], barre:{fret:2,fromString:6,toString:1}},
  {name:'C#m',frets:[-1,4,6,6,5,4], fingers:[null,1,3,4,2,1], barre:{fret:4,fromString:5,toString:1}},
  // Dominant 7
  {name:'A7', frets:[-1,0,2,0,2,0], fingers:[null,null,2,null,3,null]},
  {name:'B7', frets:[-1,2,1,2,0,2], fingers:[null,2,1,3,null,4]},
  {name:'C7', frets:[-1,3,2,3,1,0], fingers:[null,3,2,4,1,null]},
  {name:'D7', frets:[-1,-1,0,2,1,2],fingers:[null,null,null,2,1,3]},
  {name:'E7', frets:[0,2,0,1,0,0],  fingers:[null,2,null,1,null,null]},
  {name:'G7', frets:[3,2,0,0,0,1],  fingers:[3,2,null,null,null,1]},
  // Maj7 / m7
  {name:'Cmaj7', frets:[-1,3,2,0,0,0], fingers:[null,3,2,null,null,null]},
  {name:'Dmaj7', frets:[-1,-1,0,2,2,2], fingers:[null,null,null,1,1,1]},
  {name:'Gmaj7', frets:[3,-1,0,0,0,2], fingers:[3,null,null,null,null,2]},
  {name:'Em7',   frets:[0,2,0,0,0,0], fingers:[null,2,null,null,null,null]},
  {name:'Am7',   frets:[-1,0,2,0,1,0], fingers:[null,null,2,null,1,null]},
  {name:'Dm7',   frets:[-1,-1,0,2,1,1], fingers:[null,null,null,2,1,1]},
  // Sus
  {name:'Dsus2', frets:[-1,-1,0,2,3,0], fingers:[null,null,null,1,3,null]},
  {name:'Dsus4', frets:[-1,-1,0,2,3,3], fingers:[null,null,null,1,2,3]},
  {name:'Asus2', frets:[-1,0,2,2,0,0], fingers:[null,null,1,2,null,null]},
  {name:'Asus4', frets:[-1,0,2,2,3,0], fingers:[null,null,1,2,3,null]},
  {name:'Esus4', frets:[0,2,2,2,0,0], fingers:[null,1,2,3,null,null]},
];

/* Build the seed catalog entries from BUILTIN_CHORDS */
function ccBuildSeed(){
  return BUILTIN_CHORDS.map(b=>{
    const {root,quality} = parseChordName(b.name);
    const notes = computeChordNotes(root,quality);
    const f = QUALITY_FORMULAS[quality] || QUALITY_FORMULAS[''];
    return {
      id: 'cc_'+b.name.toLowerCase().replace(/[#b]/g,c=>c==='#'?'s':'f'),
      name: b.name,
      root, quality,
      notes,
      intervals: f.intervals,
      category: chordCategoryOf(quality),
      voicings: [{
        id: 'v_'+uid().slice(0,5),
        name: 'Open',
        instrument: 'guitar-6',
        frets: b.frets,
        fingers: b.fingers||b.frets.map(()=>null),
        barre: b.barre||null,
        position: 0,
      }],
      source: 'built-in',
    };
  });
}

/* Load merged catalog (built-ins + user-saved) */
function ccLoad(){
  let user = [];
  try{const raw=localStorage.getItem(CC_STORAGE_KEY);if(raw)user=JSON.parse(raw)||[]}catch(_){}
  const seed = ccBuildSeed();
  // user entries override seed by name
  const byName = {};
  seed.forEach(c=>byName[c.name]=c);
  user.forEach(c=>byName[c.name]=c);
  return Object.values(byName);
}
function ccSave(){
  // Save only user-source entries (or modified built-ins)
  const all = STATE.catalog?.chords||[];
  const userChords = all.filter(c=>c.source==='user'||c._modified);
  try{localStorage.setItem(CC_STORAGE_KEY,JSON.stringify(userChords))}catch(_){}
}
function ccEnsure(){
  if(!STATE.catalog) STATE.catalog={chords:ccLoad()};
  if(!STATE.catalog.chords) STATE.catalog.chords=ccLoad();
}

/* ── SVG fret diagram (mini + full) ── */
function ccDiagramSVG(voicing, opts){
  opts = opts||{};
  const W = opts.size||120, H = opts.size?opts.size*1.25:150;
  const strings = 6, frets = 5;
  const pad = 14;
  const top = 22, bottom = 14;
  const sx = (W - pad*2) / (strings-1);
  const fy = (H - top - bottom) / frets;
  const v = voicing.frets || [];
  const fg = voicing.fingers || [];
  // Determine display range — if all frets are 0/-1, show position 0; else find min/max
  const fretted = v.filter(f=>f>0);
  const minFret = fretted.length ? Math.min(...fretted) : 0;
  const maxFret = fretted.length ? Math.max(...fretted) : 0;
  let basePos = 0;
  if(maxFret > frets) basePos = minFret;  // shift up if outside view
  
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="cc-diag">`;
  // Strings
  for(let s=0;s<strings;s++){
    const x = pad + s*sx;
    svg += `<line x1="${x}" y1="${top}" x2="${x}" y2="${top+frets*fy}" stroke="#999" stroke-width="1"/>`;
  }
  // Frets
  for(let f=0;f<=frets;f++){
    const y = top + f*fy;
    const sw = (f===0 && basePos===0) ? 3 : 1;
    svg += `<line x1="${pad}" y1="${y}" x2="${pad+(strings-1)*sx}" y2="${y}" stroke="#999" stroke-width="${sw}"/>`;
  }
  // Position label (if shifted)
  if(basePos>0){
    svg += `<text x="${pad-6}" y="${top+fy*0.7}" font-size="10" fill="#666" text-anchor="end" font-family="JetBrains Mono">${basePos}fr</text>`;
  }
  // Top markers (X / O)
  for(let s=0;s<strings;s++){
    const x = pad + s*sx;
    const f = v[strings-1-s];   // string index 0 = high E (rightmost), reverse for display
    // Actually frets array is [low-E .. high-E] (6→1); for display left=low-E (string 6) so reverse
    // Let me re-do this more carefully below.
  }
  // Re-render markers with correct string ordering: frets[0]=low E (leftmost), frets[5]=high E (rightmost)
  for(let s=0;s<strings;s++){
    const x = pad + s*sx;
    const f = v[s];
    if(f===-1){
      svg += `<text x="${x}" y="${top-6}" font-size="11" fill="#aa3" text-anchor="middle" font-weight="600">×</text>`;
    } else if(f===0){
      svg += `<circle cx="${x}" cy="${top-8}" r="4" fill="none" stroke="#666" stroke-width="1.2"/>`;
    }
  }
  // Fretted notes (dots)
  for(let s=0;s<strings;s++){
    const x = pad + s*sx;
    const f = v[s];
    if(f>0){
      const rel = f - basePos;
      if(rel>=1 && rel<=frets){
        const y = top + (rel-0.5)*fy;
        svg += `<circle cx="${x}" cy="${y}" r="${Math.min(sx,fy)*0.32}" fill="var(--accent,#4f6ef7)"/>`;
        if(fg[s]){
          svg += `<text x="${x}" y="${y+3}" font-size="9" fill="#fff" text-anchor="middle" font-family="Inter" font-weight="700">${fg[s]}</text>`;
        }
      }
    }
  }
  // Barre indicator
  if(voicing.barre){
    const b = voicing.barre;
    const rel = b.fret - basePos;
    if(rel>=1 && rel<=frets){
      const y = top + (rel-0.5)*fy;
      // fromString/toString are 1-6 (1=high E, 6=low E). Convert to display index:
      const fromX = pad + (6 - b.fromString)*sx;
      const toX   = pad + (6 - b.toString)*sx;
      const x1 = Math.min(fromX, toX) - sx*0.25;
      const x2 = Math.max(fromX, toX) + sx*0.25;
      svg += `<rect x="${x1}" y="${y-fy*0.32}" width="${x2-x1}" height="${fy*0.64}" rx="${fy*0.32}" fill="var(--accent,#4f6ef7)" opacity=".25"/>`;
    }
  }
  svg += `</svg>`;
  return svg;
}

/* ── Filter state (per session) ── */
const CC_UI = {root:'', category:'', search:'', selected:null, picker:false, pickerCtx:null};

/* Main view: replaces the placeholder renderChordCatalog */
function renderChordCatalog(ch, cv){
  ccEnsure();
  cv.innerHTML='';
  if(ch){const t=document.createElement('div');t.innerHTML=rhythmTabsHTML(ch);cv.appendChild(t.firstElementChild)}
  
  const wrap = document.createElement('div');
  wrap.className = 'cc-wrap';
  
  const all = STATE.catalog.chords;
  const filtered = ccFilter(all);
  const cats = ['major','minor','dom','maj7','min7','dim','aug','sus','power','other'];
  const catLabels = {major:'Mayor',minor:'Menor',dom:'Dom 7',maj7:'Maj 7',min7:'Min 7',dim:'Disminuido',aug:'Aumentado',sus:'Suspendido',power:'Power',other:'Otros'};
  
  wrap.innerHTML = `
    <div class="cc-toolbar">
      <input type="text" class="cc-search" placeholder="Buscar acorde (A, Bm7, C#dim...)" value="${escapeHTML(CC_UI.search)}" oninput="ccSetFilter('search',this.value)">
      <select class="cc-filter" onchange="ccSetFilter('root',this.value)">
        <option value="">Todas las notas</option>
        ${CHROMATIC.map(n=>`<option value="${n}"${CC_UI.root===n?' selected':''}>${n}</option>`).join('')}
      </select>
      <select class="cc-filter" onchange="ccSetFilter('category',this.value)">
        <option value="">Todas las categorías</option>
        ${cats.map(c=>`<option value="${c}"${CC_UI.category===c?' selected':''}>${catLabels[c]}</option>`).join('')}
      </select>
      <button class="cc-btn-new" onclick="ccOpenNewForm()">+ Nuevo acorde</button>
    </div>
    <div class="cc-counter">${filtered.length} de ${all.length} acordes</div>
    <div class="cc-grid" id="ccGrid">
      ${filtered.map(c=>ccCardHTML(c)).join('') || '<div class="cc-empty">Sin resultados.</div>'}
    </div>
    <div class="cc-detail" id="ccDetail">${CC_UI.selected?ccDetailHTML(all.find(x=>x.id===CC_UI.selected)):''}</div>
  `;
  cv.appendChild(wrap);
}

function ccFilter(list){
  const q = CC_UI.search.toLowerCase().trim();
  return list.filter(c=>{
    if(CC_UI.root && c.root !== CC_UI.root) return false;
    if(CC_UI.category && c.category !== CC_UI.category) return false;
    if(q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
}
function ccSetFilter(k,v){CC_UI[k]=v;renderEditor()}

function ccCardHTML(c){
  const v0 = c.voicings[0];
  const sel = CC_UI.selected===c.id;
  return `<div class="cc-card${sel?' selected':''}" onclick="ccSelect('${c.id}')">
    <div class="cc-card-name">${escapeHTML(c.name)}</div>
    <div class="cc-card-diag">${ccDiagramSVG(v0,{size:88})}</div>
    <div class="cc-card-meta">
      <span class="cc-card-notes">${c.notes.join(' · ')}</span>
    </div>
  </div>`;
}

function ccSelect(id){
  CC_UI.selected = CC_UI.selected===id ? null : id;
  renderEditor();
}

function ccDetailHTML(c){
  if(!c) return '';
  const f = QUALITY_FORMULAS[c.quality] || QUALITY_FORMULAS[''];
  const isPicker = CC_UI.picker;
  return `<div class="cc-detail-inner">
    <div class="cc-detail-head">
      <div>
        <div class="cc-detail-name">${escapeHTML(c.name)}</div>
        <div class="cc-detail-sub">${f.label} · ${c.root}</div>
      </div>
      <div class="cc-detail-acts">
        ${isPicker?`<button class="cc-btn-primary" onclick="ccPickerApply('${c.id}')">Aplicar al bloque</button>`:''}
        ${c.source==='user'?`<button class="cc-btn-del" onclick="ccDeleteChord('${c.id}')">Eliminar</button>`:''}
      </div>
    </div>
    <div class="cc-detail-body">
      <div class="cc-detail-info">
        <div class="cc-info-row"><div class="cc-info-l">Notas</div><div class="cc-info-v">${c.notes.map(n=>`<span class="cc-note-pill">${n}</span>`).join('')}</div></div>
        <div class="cc-info-row"><div class="cc-info-l">Intervalos</div><div class="cc-info-v">${c.intervals.map(i=>`<span class="cc-int-pill">${i}</span>`).join('')}</div></div>
        <div class="cc-info-row"><div class="cc-info-l">Categoría</div><div class="cc-info-v">${chordCategoryOf(c.quality)}</div></div>
      </div>
      <div class="cc-detail-voicings">
        <div class="cc-voicings-title">Voicings (${c.voicings.length})</div>
        <div class="cc-voicings-grid">
          ${c.voicings.map((v,i)=>`<div class="cc-voicing">
            <div class="cc-voicing-name">${escapeHTML(v.name||('Voicing '+(i+1)))}</div>
            ${ccDiagramSVG(v,{size:130})}
            <div class="cc-voicing-meta">${(v.instrument||'guitar-6').replace('guitar-6','Guitarra 6c').replace('bass-4','Bajo 4c')}</div>
          </div>`).join('')}
        </div>
      </div>
    </div>
  </div>`;
}

/* ── New / Edit chord form ── */
function ccOpenNewForm(){
  const name = prompt('Nombre del acorde (ej: G#m7, Dadd9, Bbsus4):','');
  if(!name) return;
  const trimmed = name.trim();
  if(!trimmed) return;
  // Check if already exists
  if(STATE.catalog.chords.find(c=>c.name===trimmed)){
    alert('Ya existe un acorde con ese nombre. Podés agregar un nuevo voicing desde el detalle.');
    return;
  }
  const fretStr = prompt('Voicing (6 trastes separados por coma, -1 = mute, ej: -1,3,2,0,1,0):','-1,0,0,0,0,0');
  if(!fretStr) return;
  const frets = fretStr.split(',').map(s=>parseInt(s.trim()));
  if(frets.length!==6 || frets.some(isNaN)){alert('Voicing inválido. Debe tener exactamente 6 valores numéricos.');return}
  
  const {root,quality} = parseChordName(trimmed);
  const notes = computeChordNotes(root,quality);
  const f = QUALITY_FORMULAS[quality] || {intervals:['1','3','5']};
  const newC = {
    id: 'cc_'+trimmed.toLowerCase().replace(/[^a-z0-9]/g,'_'),
    name: trimmed,
    root, quality,
    notes,
    intervals: f.intervals,
    category: chordCategoryOf(quality),
    voicings: [{
      id: 'v_'+uid().slice(0,5),
      name: 'Custom',
      instrument: 'guitar-6',
      frets,
      fingers: frets.map(()=>null),
      barre: null,
      position: 0,
    }],
    source: 'user',
    created_at: Date.now(),
  };
  STATE.catalog.chords.push(newC);
  ccSave();
  CC_UI.selected = newC.id;
  renderEditor();
}

function ccDeleteChord(id){
  if(!confirm('¿Eliminar este acorde del catálogo?')) return;
  STATE.catalog.chords = STATE.catalog.chords.filter(c=>c.id!==id);
  ccSave();
  CC_UI.selected = null;
  renderEditor();
}

/* ── Picker: opened from block/pattern chord editor ── */
function ccOpenPicker(blockId, chId){
  ccEnsure();
  CC_UI.picker = true;
  CC_UI.pickerCtx = {blockId, chId};
  CC_UI.selected = null;
  // Switch to chord catalog tab if in rhythm channel
  STATE.ui.rhythmTab = 'chords';
  STATE.ui.activeChannelId = chId;
  STATE.ui.view = 'channel';
  renderEditor();
}
function ccPickerApply(chordId){
  const c = STATE.catalog.chords.find(x=>x.id===chordId);
  if(!c || !CC_UI.pickerCtx) return;
  const {blockId, chId} = CC_UI.pickerCtx;
  const block = STATE.song.blocks.find(b=>b.id===blockId);
  if(!block) return;
  if(!block.content[chId]) block.content[chId] = {chords:[],notes:''};
  if(!block.content[chId].chords) block.content[chId].chords = [];
  block.content[chId].chords.push({name:c.name, beats:sigBeats()});
  CC_UI.picker = false;
  CC_UI.pickerCtx = null;
  // Return to blocks view
  STATE.ui.rhythmTab = 'blocks';
  flash && flash('Acorde "'+c.name+'" agregado al bloque');
  renderEditor();
}
function ccClosePicker(){CC_UI.picker=false;CC_UI.pickerCtx=null;renderEditor()}