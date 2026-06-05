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
  const out=lines.map(ln=>{const grp=chords.slice(ci,ci+per);ci+=per;return grp.map(c=>`[${c.name}]`).join('')+ln});
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
    // Section header: a lone [NAME] or [NAME x9]; must be a single bracket pair (no inner "][").
    const mSec=line.match(/^\[([^\]\[]+?)\]\s*$/);
    if(mSec && !/\]\s*\[/.test(line)){
      const inner=mSec[1].trim();
      const xm=inner.match(/^(.*?)\s*x\s*(\d+)\s*$/i);
      const name=(xm?xm[1]:inner).trim();
      cur={section:name.toUpperCase(),bars:xm?parseInt(xm[2]):null,lines:[]};
      blocks.push(cur);continue;
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
function rdMoveChord(srcBid,srcLi,ci,dstBid,dstLi,newPos){
  if(srcBid!==dstBid)return;                       // keep moves inside one block
  const b=rdBlockById(srcBid);if(!b)return;
  const lines=rdGetLines(b);
  if(srcLi<0||srcLi>=lines.length||dstLi<0||dstLi>=lines.length)return;
  const src=rdParseLine(lines[srcLi]);
  if(ci<0||ci>=src.chords.length)return;
  const [moved]=src.chords.splice(ci,1);
  lines[srcLi]=rdBuildLine(src.stripped,src.chords);
  const dst=rdParseLine(lines[dstLi]);
  moved.pos=Math.max(0,Math.min(dst.stripped.length,newPos));
  dst.chords.push(moved);
  lines[dstLi]=rdBuildLine(dst.stripped,dst.chords);
  b.chordpro=lines.join('\n');                     // persist position with the lyric
  renderReading();
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

/* ── Lead-sheet preview (chords draggable + lyric editable inline) ── */
function rdLineHTML(line,bid,li){
  const {stripped,chords}=rdParseLine(line);
  const len=stripped.length;
  const chordRow=chords.map((c,ci)=>`<span class="rd-chord" draggable="true" data-bid="${bid}" data-li="${li}" data-ci="${ci}" style="left:${c.pos}ch" title="Arrastrá para ubicar sobre la sílaba"><span class="rd-chord-nm">${escapeHTML(c.name)}</span></span>`).join('');
  const txt=len?escapeHTML(stripped):'&nbsp;';
  return`<div class="rd-line" data-bid="${bid}" data-li="${li}" data-len="${len}"><div class="rd-chordrow">${chordRow}</div><div class="rd-text" contenteditable="true" spellcheck="false" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}" onblur="rdEditLine('${bid}',${li},this.textContent)">${txt}</div></div>`;
}
function renderLeadSheet(){
  const s=STATE.song,spb=secPerBeat();let t=0;
  let html=`<div class="rd-meta"><h3>${escapeHTML(s.artist||'—')} — ${escapeHTML(s.title||'Sin título')}</h3>`+
           `<div class="rd-sub">${s.bpm} bpm · ${escapeHTML(s.signature)} · ${fmtTime(totalDur())} total</div></div>`;
  s.blocks.forEach(b=>{
    const beats=b.bars*sigBeats(),dur=beats*spb,start=t;if(b.enabled)t+=dur;
    const src=blockToChordProLines(b);
    html+=`<div class="rd-block${b.enabled?'':' muted'}">`+
      `<div class="rd-sec"><span class="rd-sec-tag" style="background:${SECTION_COLORS[b.section]||'#888'}">${escapeHTML(b.section)}</span>`+
      `<span class="rd-sec-meta">${b.bars} bars · ${fmtTime(start)}–${fmtTime(start+dur)}</span></div>`+
      src.split('\n').map((ln,li)=>rdLineHTML(ln,b.id,li)).join('')+
    `</div>`;
  });
  return html;
}

/* Drag a chord onto the nearest character of a line (same block).
   While dragging, a floating preview (.rd-drag-preview) snaps over the line
   and to the nearest character so you can see exactly where the chord will
   land. The contenteditable lyric is never modified by the drop. */
let _rdDrag=null;
let _rdPreview=null;
let _rdGlobalBound=false;

function rdRemovePreview(){if(_rdPreview&&_rdPreview.parentNode)_rdPreview.parentNode.removeChild(_rdPreview);_rdPreview=null}

function rdCharIdx(line,clientX){
  const txt=line.querySelector('.rd-text');if(!txt)return 0;
  const rect=txt.getBoundingClientRect();
  const len=parseInt(line.dataset.len)||0;
  const cw=len>0?rect.width/len:8;
  let idx=Math.round((clientX-rect.left)/cw);
  return {idx:Math.max(0,Math.min(len,idx)),rect,cw,len};
}

function rdGlobalDragOver(e){
  if(!_rdDrag||!_rdPreview)return;
  // free-follow by default
  _rdPreview.style.left=e.clientX+'px';
  _rdPreview.style.top=(e.clientY-22)+'px';
  _rdPreview.classList.remove('snapped');
  // if hovering a line of the same block, snap to that line + nearest char
  const line=e.target.closest&&e.target.closest('.rd-line');
  if(line && line.dataset.bid===_rdDrag.bid){
    const txtEl=line.querySelector('.rd-text');
    if(txtEl){
      const r=txtEl.getBoundingClientRect();
      const {idx,cw}=rdCharIdx(line,e.clientX);
      _rdPreview.style.left=(r.left+idx*cw)+'px';
      _rdPreview.style.top=(r.top-20)+'px';
      _rdPreview.classList.add('snapped');
    }
  }
}

function bindReadingDnD(){
  // chord sources
  document.querySelectorAll('.rd-chord').forEach(ch=>{
    ch.addEventListener('dragstart',e=>{
      _rdDrag={bid:ch.dataset.bid,li:parseInt(ch.dataset.li),ci:parseInt(ch.dataset.ci),name:ch.textContent.trim()};
      e.dataTransfer.effectAllowed='move';
      // empty payload + custom mime → browser has no text to insert into contenteditable
      try{e.dataTransfer.setData('application/x-muss-chord','1')}catch(_){}
      try{e.dataTransfer.setData('text/plain','')}catch(_){}
      // hide the ugly native drag image
      try{const ghost=document.createElement('canvas');ghost.width=1;ghost.height=1;e.dataTransfer.setDragImage(ghost,0,0)}catch(_){}
      // build our floating preview
      rdRemovePreview();
      _rdPreview=document.createElement('div');
      _rdPreview.className='rd-drag-preview';
      _rdPreview.textContent=_rdDrag.name;
      _rdPreview.style.left=e.clientX+'px';
      _rdPreview.style.top=(e.clientY-22)+'px';
      document.body.appendChild(_rdPreview);
      ch.classList.add('dragging');
    });
    ch.addEventListener('dragend',()=>{ch.classList.remove('dragging');rdRemovePreview();_rdDrag=null});
  });
  // global dragover (registered once) — moves the preview, snaps to line/char
  if(!_rdGlobalBound){document.addEventListener('dragover',rdGlobalDragOver,true);_rdGlobalBound=true}
  // line drop targets
  document.querySelectorAll('.rd-line').forEach(line=>{
    // dragover on the line AND on its editable text → preventDefault so the drop fires here
    const onOver=e=>{if(_rdDrag&&_rdDrag.bid===line.dataset.bid){e.preventDefault();line.classList.add('rd-drop')}};
    line.addEventListener('dragover',onOver);
    const txt=line.querySelector('.rd-text');
    if(txt){
      txt.addEventListener('dragover',onOver);
      // ALSO swallow drop on the contenteditable so the browser never inserts text
      txt.addEventListener('drop',e=>{if(_rdDrag&&_rdDrag.bid===line.dataset.bid){e.preventDefault()}});   // prevent native text-insert, let .rd-line handle the move
    }
    line.addEventListener('dragleave',()=>line.classList.remove('rd-drop'));
    line.addEventListener('drop',e=>{
      e.preventDefault();e.stopPropagation();             // block default text insertion
      line.classList.remove('rd-drop');
      if(!_rdDrag||_rdDrag.bid!==line.dataset.bid){rdRemovePreview();_rdDrag=null;return}
      const {idx}=rdCharIdx(line,e.clientX);
      const ref={...{_:1}};
      const src=_rdDrag;
      rdRemovePreview();_rdDrag=null;
      rdMoveChord(src.bid,src.li,src.ci,line.dataset.bid,parseInt(line.dataset.li),idx);
    });
  });
}

function renderReading(){
  $('#editorHead').innerHTML=
    `<div class="editor-title"><span class="editor-title-tag" style="background:var(--accent-bg);color:var(--accent)">Lectura</span><h2>${escapeHTML(STATE.song.title)||'Untitled'}</h2></div>`+
    `<div style="display:flex;gap:8px;align-items:center"><span style="font-size:10px;color:var(--ink-faint)">${STATE.song.bpm} bpm · ${escapeHTML(STATE.song.signature)} · ${fmtTime(totalDur())}</span></div>`;
  const cv=$('#canvas');cv.className='canvas';cv.style.cssText='';
  cv.innerHTML=
    `<div class="rd-wrap">
      <div class="rd-sheet">${renderLeadSheet()}</div>
      <div class="rd-editor">
        <div class="rd-ed-head"><span><b>Editor</b> — arrastrá los <code>[acordes]</code> sobre la sílaba · clic en la letra para editar (los tiempos no cambian)</span>
          <div class="rd-ed-actions">
            <button onclick="regenChordPro()" title="Reconstruir desde los canales">↻ Regenerar</button>
            <button class="primary" onclick="saveChordProFromEditor()">Guardar</button>
          </div>
        </div>
        <textarea id="rdSource" spellcheck="false">${escapeHTML(songToChordPro())}</textarea>
        <div class="rd-ed-hint">Formato: <code>[SECCIÓN x8]</code> inicia un bloque de 8 compases · <code>[D]</code> coloca un acorde en ese punto del texto · línea en blanco separa bloques.</div>
      </div>
    </div>`;
  requestAnimationFrame(bindReadingDnD);
}