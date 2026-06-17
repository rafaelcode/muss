/* ═══════════════════════════════════════════════════════════════
   READING MODE · ChordPro lead sheet
   A songbook-style view: section headers with bar count + mm:ss
   timing derived from the tempo, chords anchored to a character
   point in each lyric line. Editable as plain text and saved back
   into the block model (lyrics + rhythm chords + per-block chordpro).
   ═══════════════════════════════════════════════════════════════ */
function fmtTime(sec){const m=Math.floor(sec/60),s=Math.round(sec%60);return m+':'+String(s).padStart(2,'0')}
function secPerBeat(){return 60/(STATE.song.bpm||120)}
function totalDur(){return STATE.song.blocks.reduce((t,b)=>t+(b.enabled?b.bars*sigBeats()*secPerBeat():0),0)}

/* Even integer beat distribution that sums to `total`. */
function distributeBeat(total,n,k){const base=Math.floor(total/n),rem=total-base*n;return base+(k<rem?1:0)}

/* Build the ChordPro lines for a block (use saved chordpro, else synthesize). */
function blockToChordProLines(block,fresh){
  if(!fresh && block.chordpro!=null && block.chordpro!=='') return block.chordpro;
  const ly=getLyricsChannel();
  const text=block.content[ly.id]?.text||'';
  const rh=STATE.song.channels.find(c=>c.type==='rhythm');
  const chords=rh?getChords(block,rh.id):[];
  const lines=text.length?text.split('\n'):[''];
  if(!chords.length) return lines.join('\n');
  const per=Math.ceil(chords.length/lines.length);
  let ci=0;
  const out=lines.map(ln=>{const grp=chords.slice(ci,ci+per);ci+=per;if(!ln.trim()){let o='';grp.forEach((c,j)=>{if(j)o+='   ';o+=`[${c.name}]`});return o}return grp.map(c=>`[${c.name}]`).join('')+ln});
  if(ci<chords.length)out[out.length-1]+=chords.slice(ci).map(c=>`[${c.name}]`).join('');
  return out.join('\n');
}

/* Whole-song ChordPro source. */
function songToChordPro(fresh){
  const s=STATE.song;
  let out=`{title: ${s.title||''}}\n{artist: ${s.artist||''}}\n{bpm: ${s.bpm}}\n{signature: ${s.signature}}\n`;
  s.blocks.forEach(b=>{out+=`\n[${b.section} x${b.bars}]\n`+blockToChordProLines(b,fresh)+'\n'});
  return out.trim()+'\n';
}

/* Parse ChordPro source → metadata + blocks [{section,bars,lines[]}]. */
function chordProToBlocks(text){
  const lines=text.replace(/\r/g,'').split('\n');
  const blocks=[],meta={};let cur=null;
  for(const line of lines){
    const mMeta=line.match(/^\{(\w+):\s*(.*)\}\s*$/);
    if(mMeta){meta[mMeta[1].toLowerCase()]=mMeta[2].trim();continue}
    // Section header: a lone [NAME] or [NAME x9]; single bracket pair (no inner "][").
    // Only treat as a section if it carries an explicit xN bar count OR the name is a
    // known section keyword — otherwise a lone chord like [E] would become a phantom block.
    const mSec=line.match(/^\[([^\]\[]+?)\]\s*$/);
    if(mSec && !/\]\s*\[/.test(line)){
      const inner=mSec[1].trim();
      const xm=inner.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
      const name=(xm?xm[1]:inner).trim();
      const isSection=!!xm || (typeof SECTION_OPTIONS!=='undefined' && SECTION_OPTIONS.indexOf(name.toUpperCase())>=0);
      if(isSection){
        cur={section:name.toUpperCase(),bars:xm?parseInt(xm[2]):null,lines:[]};
        blocks.push(cur);continue;
      }
      // else: fall through — it's a chord-only line, keep it as content
    }
    if(line.trim()===''){continue}        // blank lines are separators (headers delimit blocks)
    if(!cur){cur={section:'VERSE',bars:null,lines:[]};blocks.push(cur)}
    cur.lines.push(line);
  }
  return {meta,blocks};
}

/* Save edited ChordPro back into the song model. */
function saveChordPro(text){
  const {meta,blocks:parsed}=chordProToBlocks(text);
  if(meta.title!=null)STATE.song.title=meta.title;
  if(meta.artist!=null)STATE.song.artist=meta.artist;
  if(meta.bpm)STATE.song.bpm=parseInt(meta.bpm)||STATE.song.bpm;
  if(meta.signature)STATE.song.signature=meta.signature;
  if(!parsed.length){flash('Nada que guardar');return}

  const ly=getLyricsChannel();
  let rh=STATE.song.channels.find(c=>c.type==='rhythm');
  const anyChords=parsed.some(b=>b.lines.some(l=>/\[[^\]]+\]/.test(l)));
  if(!rh && anyChords){const id=addChannel('Ritmica','rhythm');rh=STATE.song.channels.find(c=>c.id===id)}

  while(STATE.song.blocks.length<parsed.length)insertBlockAfter(STATE.song.blocks.length-1,'VERSE');
  while(STATE.song.blocks.length>parsed.length)STATE.song.blocks.pop();

  parsed.forEach((p,i)=>{
    const b=STATE.song.blocks[i];
    if(p.section)b.section=p.section;
    if(p.bars)b.bars=Math.max(1,Math.min(64,p.bars));
    const names=[];
    const stripped=p.lines.map(l=>l.replace(/\[([^\]]+)\]/g,(_,c)=>{names.push(c.trim());return''}));
    b.chordpro=p.lines.join('\n');
    if(!b.content[ly.id])b.content[ly.id]={};
    b.content[ly.id].text=stripped.join('\n').replace(/[ \t]+$/gm,'');
    if(rh){
      if(!b.content[rh.id])b.content[rh.id]=defaultContent('rhythm');
      const total=b.bars*sigBeats(),n=names.length;
      b.content[rh.id].chords=n?names.map((nm,k)=>({name:nm,beats:distributeBeat(total,n,k)})):[];
      b.content[rh.id].notes=b.content[rh.id].notes||'';
    }
  });
  renderAll();
  flash('Lead sheet guardado');
}
function saveChordProFromEditor(){const t=$('#rdSource');if(t)saveChordPro(t.value)}
function regenChordPro(){const t=$('#rdSource');if(t)t.value=songToChordPro(true)}

/* ── ChordPro single-line helpers (parse / rebuild, char-anchored) ── */
function rdParseLine(line){
  let stripped='';const chords=[];let last=0,m;const re=/\[([^\]]+)\]/g;
  while((m=re.exec(line))){stripped+=line.slice(last,m.index);chords.push({name:m[1].trim(),pos:stripped.length});last=m.index+m[0].length}
  stripped+=line.slice(last);
  return {stripped,chords};
}
function rdBuildLine(stripped,chords){
  // Pad stripped with spaces if chords sit beyond current text length (chord-only lines / tabs).
  const maxPos=chords.reduce((m,c)=>Math.max(m,c.pos),0);
  if(maxPos>stripped.length) stripped=stripped.padEnd(maxPos,' ');
  const sorted=[...chords].sort((a,b)=>a.pos-b.pos);
  let out='',last=0;
  for(const c of sorted){const p=Math.max(0,Math.min(stripped.length,c.pos));out+=stripped.slice(last,p)+`[${c.name}]`;last=p}
  out+=stripped.slice(last);
  return out;
}
function rdBlockById(bid){return STATE.song.blocks.find(b=>b.id===bid)}
function rdGetLines(b){return blockToChordProLines(b).split('\n')}

/* Move a chord to a new char index (within the SAME block; lines may differ).
   Only edits block.chordpro — beats (content.rhythm.chords) are NOT touched. */
/* Move a chord to the exact drop-cursor position (same block, any line).
   The chord lands where the drop cursor was; chords in a line are kept sorted
   by position (left→right), so the reading order follows the placement.
   Edits only block.chordpro; beats are untouched. */
/* Keep chords in a line strictly ordered (no overlap). The dragged chord stays
   in its slot; chords AHEAD of it are pushed forward so they "run with it" and a
   chord can never pass a neighbour. gap = previous chord's name length + 1 space. */
function rdEnforceOrder(chords,k){
  const gap=c=>Math.max(1,((c&&c.name?c.name.length:1)+1));
  if(chords[k].pos<0)chords[k].pos=0;
  if(k>0){const minp=chords[k-1].pos+gap(chords[k-1]); if(chords[k].pos<minp)chords[k].pos=minp;}  // can't pass left neighbour
  for(let i=k+1;i<chords.length;i++){               // push the ones ahead forward
    const minp=chords[i-1].pos+gap(chords[i-1]);
    if(chords[i].pos<minp)chords[i].pos=minp;
  }
}
/* Build a ChordPro line WITHOUT re-sorting — preserves the sequence order. */
function rdBuildLineKeepOrder(stripped,chords){
  const maxPos=chords.reduce((m,c)=>Math.max(m,c.pos),0);
  if(maxPos>stripped.length) stripped=stripped.padEnd(maxPos,' ');
  let out='',last=0;
  for(const c of chords){                            // already ordered; never step backwards
    const p=Math.max(last,Math.min(stripped.length,Math.max(0,c.pos)));
    out+=stripped.slice(last,p)+`[${c.name}]`;last=p;
  }
  out+=stripped.slice(last);
  return out;
}
/* Light refresh after a chord move: re-render only the lead sheet (and sync the
   ChordPro textarea if present) instead of the whole reading view. */
function rdRefreshSheet(){
  const sheet=document.querySelector('.rd-sheet');
  if(!sheet){renderReading();return;}
  sheet.innerHTML=renderLeadSheet();
  const ta=document.querySelector('#rdSource'); if(ta) ta.value=songToChordPro();
  requestAnimationFrame(()=>{bindReadingDnD();rdFixOverlaps()});
}

/* Move a chord to a new char index (same block; lines may differ). Order is
   preserved: within a line the chord keeps its slot and pushes the ones ahead;
   across lines it is inserted at the ordered slot. Only edits block.chordpro. */
function rdMoveChord(srcBid,srcLi,ci,dstBid,dstLi,newPos){
  if(srcBid!==dstBid)return;                         // keep moves inside one block
  const b=rdBlockById(srcBid);if(!b)return;
  const lines=rdGetLines(b);
  if(srcLi<0||srcLi>=lines.length||dstLi<0||dstLi>=lines.length)return;
  newPos=Math.max(0,newPos);
  if(srcLi===dstLi){
    const ln=rdParseLine(lines[srcLi]);
    if(ci<0||ci>=ln.chords.length)return;
    ln.chords[ci].pos=newPos;                        // keep its sequence slot — never reorder
    rdEnforceOrder(ln.chords,ci);                    // ones ahead run with it; can't pass a neighbour
    lines[srcLi]=rdBuildLineKeepOrder(ln.stripped,ln.chords);
  }else{
    const s=rdParseLine(lines[srcLi]);
    if(ci<0||ci>=s.chords.length)return;
    const [moved]=s.chords.splice(ci,1);
    lines[srcLi]=rdBuildLineKeepOrder(s.stripped,s.chords);
    const d=rdParseLine(lines[dstLi]);
    moved.pos=newPos;
    let k=d.chords.findIndex(c=>c.pos>newPos); if(k<0)k=d.chords.length;
    d.chords.splice(k,0,moved);                       // slot in by position (ordered)
    rdEnforceOrder(d.chords,k);
    lines[dstLi]=rdBuildLineKeepOrder(d.stripped,d.chords);
  }
  b.chordpro=lines.join('\n');                        // persist position with the lyric
  rdRefreshSheet();
}

/* Inline lyric edit: save new text to the block (chordpro), keep chord
   char-indices (clamped). Lets you stretch words / annotate. Beats untouched. */
function rdEditLine(bid,li,newText){
  const b=rdBlockById(bid);if(!b)return;
  const lines=rdGetLines(b);if(li<0||li>=lines.length)return;
  const {chords}=rdParseLine(lines[li]);
  const stripped=(newText||'').replace(/\u00a0/g,'');
  chords.forEach(c=>{c.pos=Math.max(0,Math.min(stripped.length,c.pos))});
  lines[li]=rdBuildLine(stripped,chords);
  b.chordpro=lines.join('\n');
  renderReading();
}

/* Split a line at char position (Enter key): chords before stay, chords after go to new line. */
function rdSplitLineAt(bid,li,charPos){
  const b=rdBlockById(bid);if(!b)return;
  const lines=rdGetLines(b);if(li<0||li>=lines.length)return;
  const {stripped,chords}=rdParseLine(lines[li]);
  const pos=Math.max(0,Math.min(stripped.length,charPos));
  const before=chords.filter(c=>c.pos<pos);
  const after=chords.filter(c=>c.pos>=pos);
  after.forEach(c=>{c.pos=Math.max(0,c.pos-pos)});
  lines[li]=rdBuildLine(stripped.slice(0,pos),before);
  lines.splice(li+1,0,rdBuildLine(stripped.slice(pos),after));
  b.chordpro=lines.join('\n');
  renderReading();
}

/* ── Lead-sheet preview (chords draggable + lyric editable inline) ── */
function rdLineHTML(line,bid,li,beatsList,gStart){
  const {stripped,chords}=rdParseLine(line);
  const len=stripped.length;
  const bof=i=>(beatsList&&beatsList[i]!=null)?beatsList[i]:sigBeats();
  const chordRow=chords.map((c,ci)=>`<span class="rd-chord" data-bid="${bid}" data-li="${li}" data-ci="${ci}" style="left:${c.pos}ch" title="Arrastrá a la línea anterior/siguiente (respeta el orden)"><span class="rd-chord-nm">${escapeHTML(c.name)}</span></span>`).join('');
  const txt=len?escapeHTML(stripped):'&nbsp;';
  const noLy=!stripped.trim();
  if(noLy){
    // Card-style flex row for chord-only lines (no text shown)
    const cardRow=chords.map((c,ci)=>`<span class="rd-chord rd-card" data-bid="${bid}" data-li="${li}" data-ci="${ci}" title="Arrastrá a la línea anterior/siguiente (respeta el orden)"><span class="rd-chord-nm">${escapeHTML(c.name)}</span></span>`).join('');
    return`<div class="rd-line no-lyrics" data-bid="${bid}" data-li="${li}" data-len="${len}"><div class="rd-chordrow cards">${cardRow}</div></div>`;
  }
  return`<div class="rd-line" data-bid="${bid}" data-li="${li}" data-len="${len}"><div class="rd-chordrow">${chordRow}</div><div class="rd-text" contenteditable="true" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();const s=window.getSelection();const p=s.rangeCount?s.getRangeAt(0).startOffset:0;rdSplitLineAt('${bid}',${li},p)}" onblur="rdEditLine('${bid}',${li},this.textContent)">${txt}</div></div>`;
}
function renderLeadSheet(){
  const s=STATE.song,spb=secPerBeat();let t=0;
  let html=`<div class="rd-meta"><h3>${escapeHTML(s.artist||'—')} — ${escapeHTML(s.title||'Sin título')}</h3>`+
           `<div class="rd-sub">${s.bpm} bpm · ${escapeHTML(s.signature)} · ${fmtTime(totalDur())} total</div></div>`;
  s.blocks.forEach(b=>{
    const beats=b.bars*sigBeats(),dur=beats*spb,start=t;if(b.enabled)t+=dur;
    const src=blockToChordProLines(b);
    const rh=STATE.song.channels.find(c=>c.type==='rhythm');
    const beatsList=rh?getChords(b,rh.id).map(c=>c.beats||sigBeats()):[];
    let g=0;
    const body=src.split('\n').map((ln,li)=>{const h=rdLineHTML(ln,b.id,li,beatsList,g);g+=rdParseLine(ln).chords.length;return h}).join('');
    html+=`<div class="rd-block${b.enabled?'':' muted'}">`+
      `<div class="rd-sec"><span class="rd-sec-tag" style="background:${SECTION_COLORS[b.section]||'#888'}">${escapeHTML(b.section)}</span>`+
      `<span class="rd-sec-meta">${b.bars} bars · ${fmtTime(start)}–${fmtTime(start+dur)}</span></div>`+
      body+
    `</div>`;
  });
  return html;
}

/* Drag a chord onto the nearest character of a line (same block).
   While dragging, a floating preview (.rd-drag-preview) snaps over the line
   and to the nearest character so you can see exactly where the chord will
   land. The contenteditable lyric is never modified by the drop. */
let _rdDrag=null;        // {bid,li,ci,name,pointerId,startX,startY,el,active,dropLine,dropIdx}
let _rdPreview=null;     // floating chord label (position:fixed)
let _rdCursor=null;      // single persistent drop-cursor overlay (fixed, never inside the sheet)
let _rdRaf=null;         // rAF throttle for pointermove
let _rdLast=null;        // last pointer {x,y}
let _rdLineCache=null;   // Map<lineEl,{rect,len}> cached during a drag (sheet not mutated → rects valid)
const RD_DRAG_THRESHOLD=4;   // px of movement before a press becomes a drag (so a plain click still works)

function rdEnsureCursor(){
  if(_rdCursor&&_rdCursor.parentNode)return _rdCursor;
  _rdCursor=document.createElement('div');
  _rdCursor.className='rd-drop-cursor fixed';
  _rdCursor.style.display='none';
  document.body.appendChild(_rdCursor);
  return _rdCursor;
}
function rdRemovePreview(){
  if(_rdRaf!=null){cancelAnimationFrame(_rdRaf);_rdRaf=null}
  if(_rdPreview&&_rdPreview.parentNode)_rdPreview.parentNode.removeChild(_rdPreview);
  _rdPreview=null;
  if(_rdCursor)_rdCursor.style.display='none';
  _rdLineCache=null;_rdLast=null;
}

let _rdCw=0;
function rdChWidth(){
  if(_rdCw)return _rdCw;
  const host=document.querySelector('.rd-sheet')||document.body;
  const t=document.createElement('span');
  t.style.cssText='position:absolute;visibility:hidden;font-family:\'JetBrains Mono\',monospace;font-size:13px;white-space:pre';
  t.textContent='0000000000';host.appendChild(t);
  const w=t.getBoundingClientRect().width/10;t.remove();_rdCw=w||8;return _rdCw;
}
function rdCharIdx(line,clientX){
  const txt=line.querySelector('.rd-text');
  const crow=line.querySelector('.rd-chordrow');
  const ref=txt&&txt.getBoundingClientRect().width>2?txt:(crow||line);
  const rect=ref.getBoundingClientRect();
  const len=parseInt(line.dataset.len)||0;
  const cw=rdChWidth();
  let idx=Math.round((clientX-rect.left)/cw);
  return {idx:Math.max(0,idx),rect,cw,len};
}

/* ── Chord dragging via Pointer Events ───────────────────────────────
   Lighter and smoother than the native HTML5 Drag-and-Drop API: no
   browser ghost image, no interference with the contenteditable lyric,
   and full control over throttling. The sheet is never mutated while
   dragging (the drop cursor is a fixed overlay), so the multi-column
   layout is not reflowed per move.
   ──────────────────────────────────────────────────────────────────── */
function rdDragFrame(){
  _rdRaf=null;
  if(!_rdDrag||!_rdDrag.active||!_rdPreview||!_rdLast)return;
  const x=_rdLast.x,y=_rdLast.y;
  _rdPreview.style.transform=`translate(${x}px,${y-22}px)`;
  _rdPreview.classList.remove('snapped');
  const cur=rdEnsureCursor();
  const under=document.elementFromPoint(x,y);
  const line=under&&under.closest&&under.closest('.rd-line');
  if(line&&line.dataset.bid===_rdDrag.bid){
    let geo=_rdLineCache.get(line);
    if(!geo){
      const txtEl=line.querySelector('.rd-text');
      const ref=(txtEl&&txtEl.getBoundingClientRect().width>2)?txtEl:(line.querySelector('.rd-chordrow')||line);
      geo={rect:ref.getBoundingClientRect(),len:parseInt(line.dataset.len)||0};
      _rdLineCache.set(line,geo);
    }
    const cw=rdChWidth();
    const idx=Math.max(0,Math.round((x-geo.rect.left)/cw));
    const px=geo.rect.left+idx*cw;
    _rdPreview.style.transform=`translate(${px}px,${geo.rect.top-20}px)`;
    _rdPreview.classList.add('snapped');
    cur.style.display='block';
    cur.style.height=geo.rect.height+'px';
    cur.style.transform=`translate(${px}px,${geo.rect.top}px)`;
    _rdDrag.dropLine=line;_rdDrag.dropIdx=idx;
  }else{
    cur.style.display='none';
    _rdDrag.dropLine=null;
  }
}

function rdPointerMove(e){
  if(!_rdDrag)return;
  if(!_rdDrag.active){
    if(Math.abs(e.clientX-_rdDrag.startX)+Math.abs(e.clientY-_rdDrag.startY)<RD_DRAG_THRESHOLD)return;
    _rdDrag.active=true;                              // promote press → drag
    _rdDrag.el.classList.add('dragging');
    _rdPreview=document.createElement('div');
    _rdPreview.className='rd-drag-preview';
    _rdPreview.textContent=_rdDrag.name;
    _rdPreview.style.transform=`translate(${e.clientX}px,${e.clientY-22}px)`;
    document.body.appendChild(_rdPreview);
    _rdLineCache=new Map();
    rdEnsureCursor();
  }
  _rdLast={x:e.clientX,y:e.clientY};
  if(_rdRaf==null)_rdRaf=requestAnimationFrame(rdDragFrame);
}

function rdPointerUp(e){
  const d=_rdDrag;if(!d)return;
  try{d.el.releasePointerCapture&&d.el.releasePointerCapture(d.pointerId)}catch(_){}
  d.el.removeEventListener('pointermove',rdPointerMove);
  d.el.removeEventListener('pointerup',rdPointerUp);
  d.el.removeEventListener('pointercancel',rdPointerUp);
  if(!d.active){_rdDrag=null;return}                 // it was a click, not a drag
  let line=d.dropLine,idx=d.dropIdx;
  if(!line){                                         // fallback hit-test on release
    const under=document.elementFromPoint(e.clientX,e.clientY);
    const l=under&&under.closest&&under.closest('.rd-line');
    if(l&&l.dataset.bid===d.bid){line=l;idx=rdCharIdx(l,e.clientX).idx;}
  }
  d.el.classList.remove('dragging');
  rdRemovePreview();
  _rdDrag=null;
  if(line) rdMoveChord(d.bid,d.li,d.ci,line.dataset.bid,parseInt(line.dataset.li),idx);
}

function rdPointerDown(e){
  if(e.button!=null&&e.button!==0)return;            // primary button only
  const ch=e.currentTarget;
  e.preventDefault();                                // no text selection / focus steal / native drag
  _rdDrag={bid:ch.dataset.bid,li:parseInt(ch.dataset.li),ci:parseInt(ch.dataset.ci),
           name:ch.textContent.trim(),pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,
           el:ch,active:false,dropLine:null,dropIdx:0};
  try{ch.setPointerCapture(e.pointerId)}catch(_){}
  ch.addEventListener('pointermove',rdPointerMove);
  ch.addEventListener('pointerup',rdPointerUp);
  ch.addEventListener('pointercancel',rdPointerUp);
}

function bindReadingDnD(){
  document.querySelectorAll('.rd-chord').forEach(ch=>{
    ch.addEventListener('pointerdown',rdPointerDown);
  });
}

/* Toggle chord visibility in the lead sheet. */
function rdToggleChords(){
  STATE.ui.rdShowChords=!(STATE.ui.rdShowChords!==false);
  renderReading();
}

function rdSetTab(tab){ STATE.ui.rdTab=tab; renderReading(); }

function renderReading(){
  const tab = STATE.ui.rdTab || 'leadsheet';      // 'leadsheet' | 'chordpro' | 'both'
  const _sc = STATE.ui.rdShowChords!==false;
  const tabLabel = tab==='chordpro' ? 'CHORD PRO' : (tab==='both' ? 'LEADSHEET + CHORD PRO' : 'LEADSHEET');
  $('#editorHead').innerHTML=
    `<div class="editor-title"><span class="editor-title-tag" style="background:var(--accent-bg);color:var(--accent)">${tabLabel}</span><h2>${escapeHTML(STATE.song.title)||'Untitled'}</h2></div>`+
    `<div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--ink-faint)">${STATE.song.bpm} bpm · ${escapeHTML(STATE.song.signature)} · ${fmtTime(totalDur())}</span></div>`;
  const cv=$('#canvas');cv.className='canvas';cv.style.cssText='';
  // Uniform line width = longest line in the whole song + 2 tab stops (8 ch), so chords
  // can be dragged anywhere across every line (not just up to each line's own length).
  let _maxLen=0;
  STATE.song.blocks.forEach(b=>blockToChordProLines(b).split('\n').forEach(ln=>{_maxLen=Math.max(_maxLen,rdParseLine(ln).stripped.length)}));
  const _lw=_maxLen+8;

  const sheetHTML = `<div class="rd-sheet${_sc?'':' rd-no-chords'}" style="--rd-lw:${_lw}ch">${renderLeadSheet()}</div>`;
  const editorHTML = `<div class="rd-editor">
        <div class="rd-ed-head"><span><b>ChordPro</b> — <code>[SECCIÓN x8]</code> inicia bloque · <code>[D]</code> coloca un acorde · línea en blanco separa bloques</span>
          <div class="rd-ed-actions">
            <button onclick="regenChordPro()" title="Reconstruir desde los canales">↻ Regenerar</button>
            <button class="primary" onclick="saveChordProFromEditor()">Guardar</button>
          </div>
        </div>
        <textarea id="rdSource" spellcheck="false">${escapeHTML(songToChordPro())}</textarea>
        <div class="rd-ed-hint">Editá el ChordPro y pulsá <b>Guardar</b> para aplicar. En <b>LEADSHEET</b> arrastrá los <code>[acordes]</code> sobre la sílaba (los tiempos no cambian).</div>
      </div>`;

  const tabsBar = `<div class="rd-tabs">
      <div class="rd-tab-group">
        <button class="rd-tab${tab==='leadsheet'?' active':''}" onclick="rdSetTab('leadsheet')">LEADSHEET</button>
        <button class="rd-tab${tab==='chordpro'?' active':''}" onclick="rdSetTab('chordpro')">CHORD PRO</button>
        <button class="rd-tab${tab==='both'?' active':''}" onclick="rdSetTab('both')" title="Mostrar ambos, mitad y mitad">▥ Ambos</button>
      </div>
      ${tab!=='chordpro'?`<button class="${_sc?'rd-chord-toggle on':'rd-chord-toggle'}" onclick="rdToggleChords()" title="Mostrar/ocultar acordes">♫ Acordes</button>`:''}
    </div>`;

  const body = (tab==='leadsheet') ? sheetHTML
             : (tab==='chordpro')  ? editorHTML
             : sheetHTML + editorHTML;

  cv.innerHTML = tabsBar + `<div class="rd-wrap ${tab==='both'?'split':'solo'}">${body}</div>`;

  requestAnimationFrame(()=>{ if(tab!=='chordpro'){ bindReadingDnD(); rdFixOverlaps(); } });
}

/* Prevent over-lyric chord cards from overlapping: walk each row left→right and
   nudge any card that would collide with the previous one. Visual only — the
   stored char position (used for drag/drop) is untouched. */
function rdFixOverlaps(){
  document.querySelectorAll('.rd-chordrow:not(.cards)').forEach(row=>{
    const cards=[...row.querySelectorAll('.rd-chord')];
    if(cards.length<2)return;
    const items=cards.map(c=>({el:c,left:c.offsetLeft,w:c.offsetWidth})).sort((a,b)=>a.left-b.left);
    let prevRight=-Infinity;const gap=4;
    items.forEach(it=>{
      let left=it.left;
      if(left<prevRight+gap) left=prevRight+gap;
      it.el.style.left=left+'px';
      prevRight=left+(it.w||0);
    });
  });
}