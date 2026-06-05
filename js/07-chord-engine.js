/* ════════════════════════════════════════════════════════════════
   CHORD LINE ENGINE (shared by block-rhythm editor and pattern editor)
   - Lines can hold N bars (group n bars per line)
   - Add / remove line-paragraphs of N bars, validated against a max
   - Drag a chord to another line (incl. the line below)
   - Resize a chord to occupy >1 bar (e.g. 1.5 bars), validated by max
   A "ref" identifies the target: {type:'block',ci,bi} or {type:'prog',progId}
   ════════════════════════════════════════════════════════════════ */
const round2=x=>Math.round(x*2)/2;
function refTok(ref){return ref.type==='block'?`b|${ref.ci}|${ref.bi}`:`p|${ref.progId}`}
function parseRef(tok){const a=tok.split('|');return a[0]==='b'?{type:'block',ci:a[1],bi:a[2]}:{type:'prog',progId:a[1]}}
function refEq(a,b){return a&&b&&a.type===b.type&&(a.type==='prog'?a.progId===b.progId:(a.ci===b.ci&&a.bi===b.bi))}
function refFromContainer(el){const c=el.closest&&el.closest('.chord-slots');if(!c)return null;if(c.dataset.prog)return{type:'prog',progId:c.dataset.prog};if(c.dataset.ch&&c.dataset.block)return{type:'block',ci:c.dataset.ch,bi:c.dataset.block};return null}
/* Stable accessor: returns the live stored chord array (objects), normalizing strings once. */
function refGet(ref){
  const bpb=sigBeats();
  if(ref.type==='block'){
    const b=STATE.song.blocks.find(x=>x.id===ref.bi);if(!b)return[];
    if(!b.content[ref.ci])b.content[ref.ci]={chords:[],notes:''};
    if(!Array.isArray(b.content[ref.ci].chords))b.content[ref.ci].chords=[];
    let changed=false;const a=b.content[ref.ci].chords.map(c=>typeof c==='string'?(changed=true,{name:c,beats:bpb}):c);
    if(changed)b.content[ref.ci].chords=a;return b.content[ref.ci].chords;
  }
  ensureProgs();const p=STATE.song.progressions.find(x=>x.id===ref.progId);if(!p)return[];
  let changed=false;const a=p.chords.map(c=>typeof c==='string'?(changed=true,{name:c,beats:bpb}):c);if(changed)p.chords=a;return p.chords;
}
function refWrite(ref,arr){
  if(ref.type==='block'){const b=STATE.song.blocks.find(x=>x.id===ref.bi);if(b){if(!b.content[ref.ci])b.content[ref.ci]={chords:[],notes:''};b.content[ref.ci].chords=arr}}
  else{const p=STATE.song.progressions.find(x=>x.id===ref.progId);if(p)p.chords=arr}
}
function refMaxBeats(ref){const bpb=sigBeats();if(ref.type==='block'){const b=STATE.song.blocks.find(x=>x.id===ref.bi);return b?b.bars*bpb:bpb}return 32*bpb}
function refCommit(ref){if(ref.type==='prog')propagateProgBreaks(ref.progId);renderEditor()}

function chordsToLines(arr){const L=[[]];arr.forEach((c,i)=>{L[L.length-1].push(c);if(c.br&&i<arr.length-1)L.push([])});return L}
function linesToChords(lines){const out=[];lines.forEach((ln,li)=>{ln.forEach(c=>{if(c&&typeof c==='object')delete c.br;out.push(c)});if(li<lines.length-1&&out.length){const last=out[out.length-1];if(last&&typeof last==='object')last.br=true}});return out}


/* ── Generic chord ops (called from inline handlers via token) ── */
function gcAddChord(tok){const ref=parseRef(tok);const arr=refGet(ref);arr.push({name:'C',beats:sigBeats()});refWrite(ref,arr);refCommit(ref)}
/* Insert a chord into a specific line (end of that line). No room → blocked. */
function gcAddChordAt(tok,li){
  const ref=parseRef(tok);const bpb=sigBeats();const arr=refGet(ref);
  const total=arr.reduce((s,c)=>s+(c.beats||bpb),0);
  const free=refMaxBeats(ref)-total;
  if(free<0.5){flash(`Sin espacio (máx ${Math.round(refMaxBeats(ref)/bpb)} compases)`);return}
  const lines=chordsToLines(arr);
  const i=Math.max(0,Math.min(lines.length-1,li));
  lines[i].push({name:'C',beats:round2(Math.min(bpb,free))});
  refWrite(ref,linesToChords(lines));refCommit(ref);
}
/* Delete a single chord (card). */
function gcDeleteChord(tok,idx){
  const ref=parseRef(tok);const arr=refGet(ref);
  if(idx<0||idx>=arr.length)return;
  arr.splice(idx,1);refWrite(ref,arr);refCommit(ref);
}
/* Split the row right after chord `idx`: chords to the right drop to a new
   line (sets br on idx). Validates min 1 bar on each resulting line. */
function gcSplitAt(tok,idx){
  const ref=parseRef(tok);const bpb=sigBeats();const ch=refGet(ref);
  if(idx<0||idx>=ch.length-1)return;       // can't split after the last chord
  if(ch[idx].br)return;                     // already a break here
  let s=0;for(let k=idx-1;k>=0;k--){if(ch[k].br){s=k+1;break}}
  const lb=ch.slice(s,idx+1).reduce((a,c)=>a+(c.beats||bpb),0);
  let e=ch.length-1;for(let k=idx+1;k<ch.length;k++){if(ch[k].br){e=k;break}}
  const nb=ch.slice(idx+1,e+1).reduce((a,c)=>a+(c.beats||bpb),0);
  if(lb<bpb || nb<bpb){flash('Cada línea debe tener al menos 1 compás');return}
  ch[idx].br=true;refWrite(ref,ch);refCommit(ref);
}
function gcUpdateName(tok,idx,text){const ref=parseRef(tok);const arr=refGet(ref);text=text.trim();if(!text){arr.splice(idx,1);refWrite(ref,arr);refCommit(ref);return}if(arr[idx])arr[idx].name=text;refWrite(ref,arr)}
function gcToggleBreak(tok,i){
  const ref=parseRef(tok);const bpb=sigBeats();const ch=refGet(ref);if(!ch[i])return;
  if(ch[i].br){delete ch[i].br;}
  else{
    let s=0;for(let k=i-1;k>=0;k--){if(ch[k].br){s=k+1;break}}
    const lb=ch.slice(s,i+1).reduce((a,c)=>a+(c.beats||bpb),0);
    let e=ch.length-1;for(let k=i+1;k<ch.length;k++){if(ch[k].br){e=k;break}}
    const nb=ch.slice(i+1,e+1).reduce((a,c)=>a+(c.beats||bpb),0);
    if(lb<bpb || (i<ch.length-1 && nb<bpb)){flash('Cada línea debe tener al menos 1 compás');return}
    ch[i].br=true;
  }
  refWrite(ref,ch);refCommit(ref);
}
function gcClear(tok){const ref=parseRef(tok);const a=refGet(ref);a.forEach(c=>delete c.br);refWrite(ref,a);refCommit(ref)}
function gcAutoBars(tok){
  const ref=parseRef(tok);const bpb=sigBeats();const a=refGet(ref);let acc=0;
  a.forEach(c=>delete c.br);
  a.forEach((c,i)=>{acc+=(c.beats||bpb);if(acc>=bpb-1e-6 && i<a.length-1){c.br=true;acc=0}});
  refWrite(ref,a);refCommit(ref);flash('Líneas de 1 compás');
}
/* Add a paragraph (line) of N bars — validated against the max. */
function gcAddLine(tok,n){
  const ref=parseRef(tok);const bpb=sigBeats();n=Math.max(1,parseInt(n)||1);
  const arr=refGet(ref);const total=arr.reduce((s,c)=>s+(c.beats||bpb),0);const add=n*bpb;
  if(total+add>refMaxBeats(ref)+1e-6){flash(`Máximo ${Math.round(refMaxBeats(ref)/bpb)} compases`);return}
  if(arr.length)arr[arr.length-1].br=true;
  arr.push({name:'C',beats:add});            // one chord spanning N bars (resize/split later)
  refWrite(ref,arr);refCommit(ref);
}
function gcRemoveLine(tok,li){
  const ref=parseRef(tok);const arr=refGet(ref);const lines=chordsToLines(arr);
  if(li<0||li>=lines.length)return;lines.splice(li,1);
  refWrite(ref,linesToChords(lines));refCommit(ref);
}
/* Move a chord (by global index) to another line + position (drag-and-drop). */
function moveChordAcross(ref,fromIdx,toLine,toPos){
  const arr=refGet(ref);const lines=chordsToLines(arr);
  let si=-1,sj=-1,idx=0;
  for(let i=0;i<lines.length&&si<0;i++)for(let j=0;j<lines[i].length;j++){if(idx===fromIdx){si=i;sj=j;break}idx++}
  if(si<0)return;
  const [m]=lines[si].splice(sj,1);
  if(lines[si].length===0){lines.splice(si,1);if(toLine>si)toLine--;}
  if(!lines.length)lines.push([]);
  const tl=Math.max(0,Math.min(lines.length-1,toLine));
  const pos=Math.max(0,Math.min(lines[tl].length,toPos));
  lines[tl].splice(pos,0,m);
  refWrite(ref,linesToChords(lines));refCommit(ref);
}

/* Add a new line (paragraph) of 1 bar right AFTER line `li`.
   Stored as metadata only (a break on the last chord of that line). */
function gcAddLineAfter(tok,li){
  const ref=parseRef(tok);const bpb=sigBeats();
  const arr=refGet(ref);const total=arr.reduce((s,c)=>s+(c.beats||bpb),0);
  const lines=chordsToLines(arr);
  const i=Math.max(0,Math.min(lines.length-1,li));
  // 1) If there is room, add a fresh 1-bar row (placeholder chord) after line i.
  if(total+bpb<=refMaxBeats(ref)+1e-6){
    lines.splice(i+1,0,[{name:'C',beats:bpb}]);
    refWrite(ref,linesToChords(lines));refCommit(ref);return;
  }
  // 2) No room: split the current row in two (no beats added) if both halves are >= 1 bar.
  if(lines[i].length>=2){
    const half=Math.ceil(lines[i].length/2);
    const a=lines[i].slice(0,half).reduce((s,c)=>s+(c.beats||bpb),0);
    const b=lines[i].slice(half).reduce((s,c)=>s+(c.beats||bpb),0);
    if(a>=bpb && b>=bpb){
      const tail=lines[i].splice(half);
      lines.splice(i+1,0,tail);
      refWrite(ref,linesToChords(lines));refCommit(ref);return;
    }
  }
  flash(`Máximo ${Math.round(refMaxBeats(ref)/bpb)} compases`);
}

/* ── Shared line-stack renderer (proportional cards; lines/bars = metadata) ──
   Insertion happens through dynamic GAPS: a gap between two cards splits the
   line at that point (gcSplitAt); the gap at the end of a row adds a chord
   (gcAddChordAt). No fixed +/+fila buttons. */
function renderChordLineStack(ref,chords){
  const bpb=sigBeats();const tok=refTok(ref);
  const lines=chordsToLines(chords);
  // Longest row (by beats) defines full width; every row scales to the same beat→px ratio.
  const maxBeats=Math.max(bpb,...lines.map(ln=>ln.reduce((s,c)=>s+(c.beats||bpb),0)));
  const dataAttrs=ref.type==='prog'?`data-prog="${ref.progId}"`:`data-ch="${ref.ci}" data-block="${ref.bi}"`;
  let stack='<div class="chord-line-stack">';let g=0;
  lines.forEach((ln,li)=>{
    const lineBeats=ln.reduce((s,c)=>s+(c.beats||bpb),0)||bpb;
    const barCount=Math.max(1,Math.round(lineBeats/bpb));
    const pct=(lineBeats/maxBeats*100).toFixed(2);
    stack+=`<div class="chord-line" title="Línea ${li+1} · ${lineBeats}b · ${barCount} compás(es)">`;
    stack+=`<div class="chord-slots" ${dataAttrs} data-line="${li}" data-linebeats="${lineBeats}" style="width:${pct}%">`;
    ln.forEach((c,pos)=>{
      const i=g++;
      stack+=`<div class="chord-slot" data-idx="${i}" data-line="${li}" data-linepos="${pos}" draggable="false" title="${c.beats}b" style="flex-grow:${c.beats};flex-shrink:1;flex-basis:0">
        <button class="chord-grip" title="Arrastrar para mover de línea / reordenar">⠿</button>
        <button class="chord-card-del" onclick="gcDeleteChord('${tok}',${i})" title="Eliminar acorde">×</button>
        <div class="chord-name" contenteditable onblur="gcUpdateName('${tok}',${i},this.textContent)" onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}">${escapeHTML(c.name)}</div>
        <span class="chord-beats">${c.beats}b</span>
        <div class="chord-resize" data-idx="${i}" title="Redimensionar (cambia los beats)"></div>
      </div>`;
      // dynamic gap AFTER each card (except the last) → split the line here
      if(pos<ln.length-1){
        stack+=`<button class="chord-gap" onclick="gcSplitAt('${tok}',${i})" title="Bajar lo de la derecha a una fila nueva"><span class="chord-gap-bar"></span></button>`;
      }
    });
    stack+=`</div>`;
    // end-of-row gap → add a chord into this row (blocked if no room) + delete-row
    stack+=`<div class="chord-line-actions"><button class="chord-gap end" onclick="gcAddChordAt('${tok}',${li})" title="Agregar acorde en esta fila"><span class="chord-gap-bar"></span><span class="chord-gap-plus">+</span></button>${lines.length>1?`<button class="cl-line-del" onclick="gcRemoveLine('${tok}',${li})" title="Eliminar esta fila">×</button>`:''}</div>`;
    stack+=`</div>`;
  });
  stack+='</div>';
  return stack;
}

/* Resize handles (any line container), allowing growth beyond one bar up to max. */
function bindChordResizeGeneric(container){
  const ref=refFromContainer(container);if(!ref)return;
  const lineBeats=parseFloat(container.dataset.linebeats)||sigBeats();
  container.querySelectorAll('.chord-resize').forEach(handle=>{
    handle.addEventListener('mousedown',md=>{
      md.preventDefault();md.stopPropagation();
      const idx=parseInt(handle.dataset.idx);
      const startX=md.clientX;
      const base=refGet(ref).map(c=>({...c}));
      const hasNeighbor=!!container.querySelector(`.chord-slot[data-idx="${idx+1}"]`);
      const pxPerBeat=container.getBoundingClientRect().width/lineBeats;
      handle.classList.add('dragging');document.body.style.cursor='col-resize';
      function move(mv){
        const delta=(mv.clientX-startX)/pxPerBeat;
        const live=refGet(ref);
        if(hasNeighbor){
          const maxThis=base[idx].beats+base[idx+1].beats-0.5;
          const nb=clamp(round2(base[idx].beats+delta),0.5,Math.max(0.5,maxThis));
          live[idx].beats=nb;
          live[idx+1].beats=clamp(round2(base[idx+1].beats-(nb-base[idx].beats)),0.5,maxThis);
        }else{
          const others=base.reduce((s,c,k)=>s+(k===idx?0:c.beats),0);
          const free=refMaxBeats(ref)-others;
          live[idx].beats=clamp(round2(base[idx].beats+delta),0.5,Math.max(0.5,free));
        }
        container.querySelectorAll('.chord-slot').forEach(slot=>{const k=parseInt(slot.dataset.idx);if(live[k]){slot.style.flexGrow=live[k].beats;const l=slot.querySelector('.chord-beats');if(l)l.textContent=live[k].beats+'b'}});
  
      }
      function up(){handle.classList.remove('dragging');document.body.style.cursor='';document.removeEventListener('mousemove',move);document.removeEventListener('mouseup',up);refCommit(ref)}
      document.addEventListener('mousemove',move);document.addEventListener('mouseup',up);
    });
  });
}

/* Cross-line drag-and-drop (grip-initiated). Binds every chord slot + line container. */
let _dnd=null;
function bindChordDnDAll(){
  document.querySelectorAll('.chord-slots .chord-slot').forEach(slot=>{
    const grip=slot.querySelector('.chord-grip');if(!grip)return;
    grip.addEventListener('mousedown',()=>slot.setAttribute('draggable','true'));
    grip.addEventListener('touchstart',()=>slot.setAttribute('draggable','true'),{passive:true});
    slot.addEventListener('dragstart',e=>{const ref=refFromContainer(slot);_dnd={ref,fromIdx:parseInt(slot.dataset.idx)};e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','')}catch(_){}slot.classList.add('dragging')});
    slot.addEventListener('dragend',()=>{slot.classList.remove('dragging');slot.setAttribute('draggable','false')});
    slot.addEventListener('dragover',e=>{const ref=refFromContainer(slot);if(_dnd&&refEq(_dnd.ref,ref)){e.preventDefault();slot.classList.add('drag-over')}});
    slot.addEventListener('dragleave',()=>slot.classList.remove('drag-over'));
    slot.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();slot.classList.remove('drag-over');const ref=refFromContainer(slot);if(_dnd&&refEq(_dnd.ref,ref)){moveChordAcross(ref,_dnd.fromIdx,parseInt(slot.dataset.line),parseInt(slot.dataset.linepos))}_dnd=null});
  });
  document.querySelectorAll('.chord-slots').forEach(cont=>{
    cont.addEventListener('dragover',e=>{const ref=refFromContainer(cont);if(_dnd&&refEq(_dnd.ref,ref))e.preventDefault()});
    cont.addEventListener('drop',e=>{if(e.target.closest('.chord-slot'))return;e.preventDefault();const ref=refFromContainer(cont);if(_dnd&&refEq(_dnd.ref,ref)){const line=parseInt(cont.dataset.line);const count=cont.querySelectorAll('.chord-slot').length;moveChordAcross(ref,_dnd.fromIdx,line,count)}_dnd=null});
  });
}