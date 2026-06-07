function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v))}
function escapeHTML(s){return s==null?'':String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function sigBeats(){return parseInt(STATE.song.signature.split('/')[0])}
function flash(m){const e=document.createElement('div');e.className='flash';e.textContent=m;document.body.appendChild(e);setTimeout(()=>e.remove(),1800)}

/* ── Channels ── */
function defaultContent(t){switch(t){case'drums':return{pattern:{}};case'lead':case'bass':return{tab:defaultTab(t)};case'rhythm':return{chords:[],notes:''};default:return{text:''}}}
function defaultTab(t){return t==='bass'?'G|----------------|\nD|----------------|\nA|----------------|\nE|----------------|':'e|----------------|\nB|----------------|\nG|----------------|\nD|----------------|\nA|----------------|\nE|----------------|'}
function addChannel(name,type){const id=uid(),c=CH_COLORS[STATE.song.channels.length%CH_COLORS.length];STATE.song.channels.push({id,name,type,color:c,muted:false});STATE.song.blocks.forEach(b=>{if(!b.content[id])b.content[id]=defaultContent(type)});return id}
function deleteChannel(id){if(STATE.song.channels.length<=1){flash('Need at least 1 channel');return}STATE.song.channels=STATE.song.channels.filter(c=>c.id!==id);STATE.song.blocks.forEach(b=>{delete b.content[id]});if(STATE.ui.activeChannelId===id)STATE.ui.activeChannelId=STATE.song.channels[0].id;renderAll()}
function toggleMute(id){const c=STATE.song.channels.find(x=>x.id===id);if(c)c.muted=!c.muted;renderAll()}
function renameChannel(id,name){const c=STATE.song.channels.find(x=>x.id===id);if(c){c.name=name;renderChannelsList()}}
function blockHasContent(b,ch){const c=b.content[ch.id];if(!c)return false;if(ch.type==='drums')return Object.values(c.pattern||{}).some(a=>a.some(v=>v));if(ch.type==='rhythm')return(c.chords&&c.chords.length)||(c.notes&&c.notes.trim());if(ch.type==='lead'||ch.type==='bass'){if(!c.tab)return false;const txt=normalizeTab(c.tab,tabType(ch));return /[0-9xXhHpPbB]/.test(txt)}return c.text&&c.text.trim()}

/* ── Blocks ── */
function addBlock(s='VERSE',b=4){const bl={id:uid(),section:s,bars:b,enabled:true,comment:'',content:{}};STATE.song.channels.forEach(c=>{bl.content[c.id]=defaultContent(c.type)});STATE.song.blocks.push(bl);return bl.id}
function deleteBlock(id){STATE.song.blocks=STATE.song.blocks.filter(b=>b.id!==id);renderAll()}
function duplicateBlock(id){const i=STATE.song.blocks.findIndex(b=>b.id===id);if(i===-1)return;const c=JSON.parse(JSON.stringify(STATE.song.blocks[i]));c.id=uid();STATE.song.blocks.splice(i+1,0,c);renderAll()}
function toggleBlockEnabled(id){const b=STATE.song.blocks.find(b=>b.id===id);if(b)b.enabled=!b.enabled;renderAll()}
function moveBlock(fid,tid){if(fid===tid)return;const bs=STATE.song.blocks,fi=bs.findIndex(b=>b.id===fid),ti=bs.findIndex(b=>b.id===tid);if(fi===-1||ti===-1)return;const[it]=bs.splice(fi,1);bs.splice(ti,0,it);renderAll()}
function insertBlockAt(i){const bl={id:uid(),section:'VERSE',bars:4,enabled:true,comment:'',content:{}};STATE.song.channels.forEach(c=>{bl.content[c.id]=defaultContent(c.type)});STATE.song.blocks.splice(i,0,bl);renderAll();flash('Block inserted')}
function makeInsertZone(i){const z=document.createElement('div');z.className='block-insert-zone';const b=document.createElement('button');b.className='block-insert-btn';b.textContent='+';b.addEventListener('click',e=>{e.stopPropagation();insertBlockAt(i)});z.appendChild(b);return z}
function setSection(id,v){const b=STATE.song.blocks.find(x=>x.id===id);if(b){b.section=v;renderEditor()}}
function setBars(id,v){
  const b=STATE.song.blocks.find(x=>x.id===id);if(!b)return;
  const oldBars=b.bars;
  b.bars=clamp(parseInt(v)||4,1,32);
  if(b.bars!==oldBars){
    // Rescale every tab channel in this block proportionally to the new bar count.
    STATE.song.channels.forEach(ch=>{
      if(ch.type==='lead'||ch.type==='bass'){
        const type=tabType(ch);
        const grid=parseTabGrid(b.content[ch.id]?.tab,type);
        rescaleGridCols(grid, b.bars*tabColsPerBar());
        if(!b.content[ch.id])b.content[ch.id]={};
        b.content[ch.id].tab={cols:grid.cols.map(c=>({...c}))};
      }
    });
  }
  renderEditor();
}
function setComment(id,v){const b=STATE.song.blocks.find(x=>x.id===id);if(b)b.comment=v}
function setText(ci,bi,v,k='text'){const b=STATE.song.blocks.find(x=>x.id===bi);if(!b)return;if(!b.content[ci])b.content[ci]={};b.content[ci][k]=v}
/* Chord model: each chord is {name, beats}. Older data may store plain
   strings — normalizeChord() upgrades them on read. */
function normalizeChord(c){
  if(typeof c==='string') return {name:c, beats:sigBeats()};
  const o={name:c.name||'', beats:c.beats||sigBeats()};
  if(c.br)o.br=true;            // line-break AFTER this chord (for syncing with lyric lines)
  return o;
}
function getChords(block,ci){
  const arr=(block.content[ci]?.chords)||[];
  return arr.map(normalizeChord);
}
function addChord(ci,bi){const b=STATE.song.blocks.find(x=>x.id===bi);if(!b.content[ci])b.content[ci]={chords:[],notes:''};if(!b.content[ci].chords)b.content[ci].chords=[];b.content[ci].chords=getChords(b,ci);b.content[ci].chords.push({name:'Am',beats:sigBeats()});renderEditor()}
/* Group a flat chord array into lines, breaking after any chord flagged br. */
function chordLines(chords){
  const lines=[[]];
  chords.forEach((c,i)=>{ lines[lines.length-1].push({c,i}); if(c.br && i<chords.length-1) lines.push([]); });
  return lines;
}
function blockLyricLineCount(block){
  const ly=getLyricsChannel();
  const t=block.content[ly.id]?.text||'';
  return t.length? t.split('\n').length : 1;
}
/* Toggle a line break after chord i. */
function toggleChordBreak(ci,bi,i){
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b)return;
  const ch=getChords(b,ci); if(!ch[i])return;
  if(ch[i].br)delete ch[i].br; else ch[i].br=true;
  b.content[ci].chords=ch; renderEditor();
}
function clearChordBreaks(ci,bi){
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b)return;
  const ch=getChords(b,ci); ch.forEach(c=>delete c.br);
  b.content[ci].chords=ch; renderEditor();
}
/* Distribute chords into as many lines as the block's lyrics, setting breaks. */
function syncChordsToLyrics(ci,bi){
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b)return;
  const ch=getChords(b,ci); const N=blockLyricLineCount(b);
  if(!ch.length){flash('No hay acordes');return}
  ch.forEach(c=>delete c.br);
  for(let k=1;k<N;k++){
    const idx=Math.round(k*ch.length/N)-1;
    if(idx>=0 && idx<ch.length-1) ch[idx].br=true;
  }
  b.content[ci].chords=ch; renderEditor();
  flash(`Acordes repartidos en ${N} línea${N>1?'s':''}`);
}

function updateChord(ci,bi,i,v){const b=STATE.song.blocks.find(x=>x.id===bi);b.content[ci].chords=getChords(b,ci);v=v.trim();if(!v){b.content[ci].chords.splice(i,1);renderEditor()}else{b.content[ci].chords[i].name=v}}

/* ── Chord progressions (reusable patterns with alias) ── */
function ensureProgs(){if(!STATE.song.progressions)STATE.song.progressions=[]}
function saveProgression(ci,bi){
  ensureProgs();
  const b=STATE.song.blocks.find(x=>x.id===bi);
  const chords=getChords(b,ci);
  if(!chords.length){flash('No chords to save');return}
  // Duplicate check: same chord names AND same beats in same order
  const fingerprint=chords.map(c=>c.name+'|'+c.beats).join(',');
  const dup=STATE.song.progressions.find(p=>{
    const fp=p.chords.map(c=>(c.name||c)+'|'+(c.beats||sigBeats())).join(',');
    return fp===fingerprint;
  });
  if(dup){flash('Pattern already exists as "'+dup.name+'"');return}
  const name=prompt('Name this chord pattern (alias):','Pattern '+(STATE.song.progressions.length+1));
  if(name===null)return;
  STATE.song.progressions.push({id:uid(),name:name.trim()||('Pattern '+(STATE.song.progressions.length+1)),chords:JSON.parse(JSON.stringify(chords))});
  flash('Pattern saved');
  renderEditor();
}
function applyProgression(ci,bi,progId){
  ensureProgs();
  const prog=STATE.song.progressions.find(p=>p.id===progId);
  if(!prog)return;
  const b=STATE.song.blocks.find(x=>x.id===bi);
  if(!b.content[ci])b.content[ci]={chords:[],notes:''};
  // Track applied patterns on the block (max 2)
  if(!b.content[ci].appliedPatterns)b.content[ci].appliedPatterns=[];
  if(!b.content[ci].appliedPatterns.includes(progId)){
    if(b.content[ci].appliedPatterns.length>=2){flash('Max 2 patterns per block');return}
    b.content[ci].appliedPatterns.push(progId);
  }
  b.content[ci].chords=JSON.parse(JSON.stringify(prog.chords));
  flash('Applied "'+prog.name+'"');
  renderEditor();
}
function removePatternFromBlock(ci,bi,progId){
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b||!b.content[ci])return;
  if(!b.content[ci].appliedPatterns)b.content[ci].appliedPatterns=[];
  b.content[ci].appliedPatterns=b.content[ci].appliedPatterns.filter(id=>id!==progId);
  renderEditor();
}
function deleteProgression(progId){
  ensureProgs();
  STATE.song.progressions=STATE.song.progressions.filter(p=>p.id!==progId);
  // Also remove from any block that had it applied
  STATE.song.blocks.forEach(b=>Object.values(b.content).forEach(c=>{
    if(c.appliedPatterns)c.appliedPatterns=c.appliedPatterns.filter(id=>id!==progId);
  }));
  renderEditor();
}
function renameProgression(progId){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);
  if(!p)return;
  const n=prompt('Rename pattern:',p.name);
  if(n!==null){p.name=n.trim()||p.name;renderEditor()}
}

/* ── Chord drag-to-resize (replaces +/- buttons) ── */
function bindChordDrag(ci,bi){document.querySelectorAll(`.chord-slots[data-ch="${ci}"][data-block="${bi}"]`).forEach(bindChordResizeGeneric)}
function rhythmTabsHTML(ch){
  const tabs=[['blocks','Blocks'],['patterns','Patterns'],['chords','Chords']];
  return`<div class="rhythm-tabs">${tabs.map(([k,lbl])=>`<button class="rhythm-tab${STATE.ui.rhythmTab===k?' active':''}" onclick="setRhythmTab('${k}')">${lbl}</button>`).join('')}</div>`;
}
function setRhythmTab(tab){STATE.ui.rhythmTab=tab;renderEditor()}

/* ── Pattern catalog ── */
/* Normalize a pattern's chords, preserving line breaks (br). */
function progChords(prog){
  return (prog.chords||[]).map(c=> typeof c==='string'
    ? {name:c,beats:sigBeats()}
    : {name:c.name||'',beats:c.beats||sigBeats(),...(c.br?{br:true}:{})});
}
function progChordLines(chords){
  const lines=[[]];
  chords.forEach((c,i)=>{lines[lines.length-1].push({c,i});if(c.br&&i<chords.length-1)lines.push([])});
  return lines;
}
/* When a pattern's line structure changes, mirror the breaks onto any block
   that has this pattern applied (so Overview/Lectura reflect it). */
function propagateProgBreaks(progId){
  const p=STATE.song.progressions.find(x=>x.id===progId);if(!p)return;
  STATE.song.blocks.forEach(b=>Object.values(b.content).forEach(c=>{
    if(c.appliedPatterns&&c.appliedPatterns.includes(progId)&&Array.isArray(c.chords)&&c.chords.length===p.chords.length){
      c.chords.forEach((cc,k)=>{ if(typeof cc==='string')return; if(p.chords[k]&&p.chords[k].br)cc.br=true; else delete cc.br; });
    }
  }));
}
/* Toggle a line break after chord i — enforcing a minimum of 1 bar per line. */
function toggleProgBreak(progId,i){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);if(!p||!p.chords[i])return;
  const bpb=sigBeats();
  const ch=p.chords;
  if(ch[i].br){delete ch[i].br;}
  else{
    let startIdx=0;for(let k=i-1;k>=0;k--){if(ch[k].br){startIdx=k+1;break}}
    const lineBeats=ch.slice(startIdx,i+1).reduce((s,c)=>s+(c.beats||bpb),0);
    let endIdx=ch.length-1;for(let k=i+1;k<ch.length;k++){if(ch[k].br){endIdx=k;break}}
    const nextBeats=ch.slice(i+1,endIdx+1).reduce((s,c)=>s+(c.beats||bpb),0);
    if(lineBeats<bpb || (i<ch.length-1 && nextBeats<bpb)){flash('Cada línea debe tener al menos 1 compás');return}
    ch[i].br=true;
  }
  propagateProgBreaks(progId);renderEditor();
}
/* Auto-group: break into lines of (at least) one bar each. */
function autoBarLines(progId){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);if(!p)return;
  const bpb=sigBeats();let acc=0;
  p.chords.forEach(c=>{if(typeof c!=='string')delete c.br});
  p.chords.forEach((c,i)=>{const bt=(c.beats||bpb);acc+=bt;if(acc>=bpb-1e-6 && i<p.chords.length-1){if(typeof c!=='string')c.br=true;acc=0}});
  propagateProgBreaks(progId);renderEditor();
  flash('Líneas de 1 compás');
}
function clearProgBreaks(progId){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);if(!p)return;
  p.chords.forEach(c=>{if(typeof c!=='string')delete c.br});
  propagateProgBreaks(progId);renderEditor();
}
/* Reorder chords within a pattern (drag-and-drop). br travels with the chord. */
function moveProgChord(progId,from,to){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);if(!p||from===to||from==null||to==null)return;
  const arr=p.chords;if(from<0||from>=arr.length)return;
  const [m]=arr.splice(from,1);
  let t=to>from?to-1:to;t=Math.max(0,Math.min(arr.length,t));
  arr.splice(t,0,m);
  propagateProgBreaks(progId);renderEditor();
}

function renderPatternCatalog(ch,cv){
  ensureProgs();cv.innerHTML='';
  const t=document.createElement('div');t.innerHTML=rhythmTabsHTML(ch);cv.appendChild(t.firstElementChild);
  const wrap=document.createElement('div');wrap.className='pattern-catalog';
  if(!STATE.song.progressions.length){
    wrap.innerHTML='<div class="pattern-catalog-empty">No patterns saved yet.<br>Go to <b>Blocks</b> and click <b>★ Save as pattern</b> on any chord progression.</div>';
    cv.appendChild(wrap);return;
  }
  const grid=document.createElement('div');grid.className='pattern-grid';const bpb=sigBeats();
  STATE.song.progressions.forEach((prog,_pi)=>{
    const ref={type:'prog',progId:prog.id};
    const chords=progChords(prog);
    const totalBeats=chords.reduce((s,c)=>s+c.beats,0);
    const numBars=Math.max(1,Math.round(totalBeats/bpb));
    const lines=chordsToLines(chords);
    const stack=renderChordLineStack(ref,chords);
    const card=document.createElement('div');card.className='pattern-card';card.dataset.progIdx=_pi;
    card.innerHTML=`
      <div class="pattern-card-head"><button class="pattern-card-grip" title="Arrastrar para reordenar">⠿</button>
        <input class="pattern-card-name" value="${escapeHTML(prog.name)}" spellcheck="false" onblur="renameProgById('${prog.id}',this.value)" onkeydown="if(event.key==='Enter')this.blur()" title="Click to rename">
        <span style="font-size:9px;color:var(--ink-faint);font-family:'JetBrains Mono',monospace;white-space:nowrap">${chords.length} chord${chords.length!==1?'s':''} · ${totalBeats} beats · ${numBars} bar${numBars!==1?'s':''} · ${lines.length} línea${lines.length!==1?'s':''}</span>
        <button class="pattern-card-del" onclick="deleteProgression('${prog.id}')" title="Delete">×</button>
      </div>
      <div class="pattern-card-body">       
        ${stack}        
        <div class="pattern-card-actions">
          <button class="pattern-apply-btn" onclick="applyPatternToBlock('${ch.id}','${prog.id}')">Apply to block…</button>
          <button class="pattern-dup-btn" onclick="duplicatePattern('${prog.id}')">⧉ Duplicate &amp; edit</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
  wrap.appendChild(grid);cv.appendChild(wrap);
  requestAnimationFrame(()=>{document.querySelectorAll('.chord-slots[data-prog]').forEach(bindChordResizeGeneric);bindChordDnDAll();bindPatternCardDnD()});
}
/* Reorder patterns via drag-and-drop on the pattern cards. */
function moveProgression(from,to){
  if(from===to||from<0||to<0)return;
  const arr=STATE.song.progressions;
  if(from>=arr.length||to>=arr.length)return;
  const [m]=arr.splice(from,1);
  arr.splice(to,0,m);
  renderEditor();
}
let _patDrag=null;
function bindPatternCardDnD(){
  document.querySelectorAll('.pattern-card').forEach(card=>{
    const grip=card.querySelector('.pattern-card-grip');if(!grip)return;
    grip.addEventListener('mousedown',()=>card.setAttribute('draggable','true'));
    card.addEventListener('dragstart',e=>{_patDrag=parseInt(card.dataset.progIdx);e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain','')}catch(_){}card.classList.add('dragging')});
    card.addEventListener('dragend',()=>{card.classList.remove('dragging');card.setAttribute('draggable','false');_patDrag=null});
    card.addEventListener('dragover',e=>{if(_patDrag!=null){e.preventDefault();card.classList.add('drag-over')}});
    card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
    card.addEventListener('drop',e=>{e.preventDefault();card.classList.remove('drag-over');if(_patDrag!=null){const to=parseInt(card.dataset.progIdx);moveProgression(_patDrag,to);_patDrag=null}});
  });
}

function renameProgById(progId,name){ensureProgs();const p=STATE.song.progressions.find(x=>x.id===progId);if(p&&name.trim())p.name=name.trim()}

/* Edit chord name in pattern catalog */
function updateProgChord(progId,idx,name){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);
  if(!p)return;
  name=name.trim();
  if(!name){p.chords.splice(idx,1);}
  else{if(!p.chords[idx])return;p.chords[idx].name=name;}
  // Update meta label
  const slotsEl=document.getElementById('pslots_'+progId);
  const fillEl=document.getElementById('pfill_'+progId);
  if(!name&&slotsEl){
    // Re-render the card by refreshing the pattern catalog view
    renderEditor();return;
  }
  if(fillEl){
    const total=p.chords.reduce((s,c)=>s+(c.beats||sigBeats()),0);
    fillEl.textContent=total+' beats total';
    const metaEl=slotsEl?.closest('.pattern-card-body')?.querySelector('.pattern-meta');
    if(metaEl)metaEl.textContent=p.chords.length+' chord'+(p.chords.length!==1?'s':'')+' · '+total+' beats';
  }
}

/* Add a chord to a pattern directly from the catalog */
function addProgChord(progId){
  ensureProgs();
  const p=STATE.song.progressions.find(x=>x.id===progId);
  if(!p)return;
  p.chords.push({name:'Am',beats:sigBeats()});
  renderEditor();
}

/* Duplicate a pattern and save as new — requires at least one change (checked on save) */
function duplicatePattern(progId){
  ensureProgs();
  const src=STATE.song.progressions.find(x=>x.id===progId);
  if(!src)return;
  const name=prompt('Name for the new pattern (must differ from original):',src.name+' (copy)');
  if(name===null)return;
  const trimmed=name.trim()||src.name+' (copy)';
  // Clone chords deep
  const cloned=JSON.parse(JSON.stringify(src.chords));
  // Fingerprint check: cloned is identical to source by definition — warn the user
  // they need to edit it after saving. Duplication always creates a new entry.
  // If the NAME already exists, reject.
  if(STATE.song.progressions.some(p=>p.name===trimmed)){
    flash('A pattern named "'+trimmed+'" already exists');return;
  }
  STATE.song.progressions.push({id:uid(),name:trimmed,chords:cloned});
  flash('Duplicated as "'+trimmed+'" — edit the chords or timings to differentiate');
  renderEditor();
}

/* Drag-to-resize for pattern chord slots — mirrors bindChordDrag but for progressions */
/* Drag-to-resize across each line's container (beats stay within the line). */
function bindPatternChordDrag(progId){document.querySelectorAll(`.chord-slots[data-prog="${progId}"]`).forEach(bindChordResizeGeneric)}

function applyPatternToBlock(ci,progId){
  ensureProgs();
  if(!STATE.song.blocks.length){flash('No blocks to apply to');return}
  document.getElementById('_patternPicker')?.remove();
  const box=document.createElement('div');box.id='_patternPicker';
  box.style.cssText='position:fixed;bottom:60px;right:20px;background:var(--bg-0);border:1px solid var(--line-mid);border-radius:10px;padding:12px;z-index:3000;box-shadow:0 8px 32px rgba(0,0,0,.15);min-width:200px;font-family:Inter,sans-serif;font-size:12px';
  box.innerHTML=`<div style="font-weight:600;margin-bottom:8px;color:var(--ink)">Apply to block:</div>${STATE.song.blocks.map((b,i)=>`<div onclick="doApplyPattern('${ci}','${b.id}','${progId}')" style="padding:6px 8px;border-radius:6px;cursor:pointer;color:var(--ink-dim)" onmouseover="this.style.background='var(--accent-bg)'" onmouseout="this.style.background=''">${String(i+1).padStart(2,'0')} · ${b.section}</div>`).join('')}<div onclick="document.getElementById('_patternPicker')?.remove()" style="margin-top:8px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--ink-faint);font-size:11px;border-top:1px solid var(--line)">Cancel</div>`;
  document.body.appendChild(box);
  setTimeout(()=>document.addEventListener('click',function h(e){if(!box.contains(e.target)){box.remove();document.removeEventListener('click',h)}},{once:true}),50);
}
function doApplyPattern(ci,bi,progId){document.getElementById('_patternPicker')?.remove();applyProgression(ci,bi,progId);STATE.ui.rhythmTab='blocks';renderEditor()}

/* ── Chord catalog (unique chords used across the song) ── */
function renderChordCatalog(ch,cv){
  cv.innerHTML='';
  const t=document.createElement('div');t.innerHTML=rhythmTabsHTML(ch);cv.appendChild(t.firstElementChild);
  const seen={};
  STATE.song.blocks.forEach(b=>getChords(b,ch.id).forEach(c=>{const k=c.name||'?';if(!seen[k])seen[k]={name:k,count:0,blocks:[]};seen[k].count++;seen[k].blocks.push(b.section)}));
  const wrap=document.createElement('div');wrap.className='chord-catalog';
  const list=Object.values(seen);
  if(!list.length){wrap.innerHTML='<div class="pattern-catalog-empty">No chords in this channel yet.<br>Add chords in the <b>Blocks</b> view.</div>';cv.appendChild(wrap);return}
  const grid=document.createElement('div');grid.className='chord-dict-grid';
  list.sort((a,b)=>b.count-a.count).forEach(e=>{
    const card=document.createElement('div');card.className='chord-dict-card';
    card.title=`Used in: ${[...new Set(e.blocks)].join(', ')}`;
    card.innerHTML=`<span class="chord-dict-name">${escapeHTML(e.name)}</span><span class="chord-dict-count">×${e.count}</span>`;
    grid.appendChild(card);
  });
  wrap.appendChild(grid);cv.appendChild(wrap);
}

/* ── Riff Library ── */
function ensureRiffs(){if(!STATE.song.library)STATE.song.library={riffs:[]};if(!STATE.song.library.riffs)STATE.song.library.riffs=[]}

function tabChannelTabsHTML(ch){
  return`<div class="tab-channel-tabs"><button class="tab-channel-tab${STATE.ui.tabTab==='blocks'?' active':''}" onclick="setTabTab('blocks')">Blocks</button><button class="tab-channel-tab${STATE.ui.tabTab==='riffs'?' active':''}" onclick="setTabTab('riffs')">Riff Library</button></div>`;
}
function setTabTab(tab){STATE.ui.tabTab=tab;renderEditor()}

/* Save current block's tab as a named riff in the library */
function saveRiff(ci,bi,type){
  ensureRiffs();
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b||!b.content[ci])return;
  const grid=parseTabGrid(b.content[ci].tab,type);
  if(!grid.cols.some(col=>Object.values(col).some(v=>v!=='-'))){flash('Tab is empty');return}
  const name=prompt('Name this riff:','Riff '+(STATE.song.library.riffs.length+1));
  if(name===null)return;
  const trimmed=name.trim()||('Riff '+(STATE.song.library.riffs.length+1));
  STATE.song.library.riffs.push({id:uid(),name:trimmed,type,cols:JSON.parse(JSON.stringify(grid.cols))});
  flash('Riff "'+trimmed+'" saved');renderEditor();
}

/* Apply a library riff to a block's tab grid */
function applyRiff(ci,bi,riffId){
  ensureRiffs();
  const riff=STATE.song.library.riffs.find(r=>r.id===riffId);if(!riff)return;
  const b=STATE.song.blocks.find(x=>x.id===bi);if(!b)return;
  if(!b.content[ci])b.content[ci]={};
  b.content[ci].tab={cols:JSON.parse(JSON.stringify(riff.cols))};
  flash('Applied "'+riff.name+'"');renderEditor();
}

function deleteRiff(riffId){
  ensureRiffs();
  STATE.song.library.riffs=STATE.song.library.riffs.filter(r=>r.id!==riffId);
  renderEditor();
}
function renameRiff(riffId){
  ensureRiffs();
  const r=STATE.song.library.riffs.find(x=>x.id===riffId);if(!r)return;
  const n=prompt('Rename riff:',r.name);
  if(n!==null){r.name=n.trim()||r.name;renderEditor()}
}
function duplicateRiff(riffId){
  ensureRiffs();
  const src=STATE.song.library.riffs.find(x=>x.id===riffId);if(!src)return;
  const name=prompt('Name for the duplicated riff:',src.name+' (copy)');
  if(name===null)return;
  const trimmed=name.trim()||src.name+' (copy)';
  if(STATE.song.library.riffs.some(r=>r.name===trimmed)){flash('A riff named "'+trimmed+'" already exists');return}
  STATE.song.library.riffs.push({id:uid(),name:trimmed,type:src.type,cols:JSON.parse(JSON.stringify(src.cols))});
  flash('Duplicated as "'+trimmed+'"');renderEditor();
}

/* Render the riff catalog view for a lead/bass channel */
function renderRiffCatalog(ch,cv){
  ensureRiffs();cv.innerHTML='';
  const tt=tabType(ch);
  const tabsDiv=document.createElement('div');tabsDiv.innerHTML=tabChannelTabsHTML(ch);cv.appendChild(tabsDiv.firstElementChild);
  const wrap=document.createElement('div');wrap.className='riff-catalog';
  // Filter riffs matching this channel's type
  const riffs=STATE.song.library.riffs.filter(r=>r.type===tt);
  if(!riffs.length){
    wrap.innerHTML=`<div class="riff-catalog-empty">No riffs saved yet.<br>Go to <b>Blocks</b>, edit a tab, then click <b>★ Save as riff</b>.</div>`;
    cv.appendChild(wrap);return;
  }
  const grid=document.createElement('div');grid.className='riff-grid';
  riffs.forEach(riff=>{
    const labels=tabStringSet(tt);
    const cols=riff.cols||[];
    // Build text preview
    const preview=labels.map(l=>l+'|'+cols.map(c=>c[l]||'-').join('')+'|').join('\n');
    const nBars=Math.max(1,Math.round(cols.length/(sigBeats()*4)));
    const card=document.createElement('div');card.className='riff-card';
    card.innerHTML=`
      <div class="riff-card-head">
        <input class="riff-card-name" value="${escapeHTML(riff.name)}" spellcheck="false"
          onblur="renameRiffById('${riff.id}',this.value)"
          onkeydown="if(event.key==='Enter')this.blur()" title="Click to rename">
        <span class="riff-card-type">${tt}</span>
        <button class="riff-card-del" onclick="deleteRiff('${riff.id}')" title="Delete">×</button>
      </div>
      <div class="riff-card-body">
        <div class="riff-card-meta">${labels.length} strings · ${cols.length} cols · ${nBars} bar${nBars!==1?'s':''}</div>
        <div class="riff-card-preview">${escapeHTML(preview)}</div>
        <div class="riff-card-actions">
          <button class="riff-apply-btn" onclick="applyRiffToBlock('${ch.id}','${riff.id}','${tt}')">Apply to block…</button>
          <button class="riff-dup-btn" onclick="duplicateRiff('${riff.id}')">⧉ Duplicate</button>
        </div>
      </div>`;
    grid.appendChild(card);
  });
  wrap.appendChild(grid);cv.appendChild(wrap);
}

function renameRiffById(riffId,name){ensureRiffs();const r=STATE.song.library.riffs.find(x=>x.id===riffId);if(r&&name.trim())r.name=name.trim()}

/* Picker: choose which block to apply the riff to */
function applyRiffToBlock(ci,riffId,type){
  ensureRiffs();
  // Filter blocks that have a tab channel matching ci
  const ch=STATE.song.channels.find(c=>c.id===ci);if(!ch)return;
  if(!STATE.song.blocks.length){flash('No blocks to apply to');return}
  document.getElementById('_riffPicker')?.remove();
  const box=document.createElement('div');box.id='_riffPicker';
  box.style.cssText='position:fixed;bottom:60px;right:20px;background:var(--bg-0);border:1px solid var(--line-mid);border-radius:10px;padding:12px;z-index:3000;box-shadow:0 8px 32px rgba(0,0,0,.15);min-width:200px;font-family:Inter,sans-serif;font-size:12px';
  box.innerHTML=`<div style="font-weight:600;margin-bottom:8px;color:var(--ink)">Apply to block:</div>${STATE.song.blocks.map((b,i)=>`<div onclick="applyRiff('${ci}','${b.id}','${riffId}');document.getElementById('_riffPicker')?.remove()" style="padding:6px 8px;border-radius:6px;cursor:pointer;color:var(--ink-dim)" onmouseover="this.style.background='var(--accent-bg)'" onmouseout="this.style.background=''">${String(i+1).padStart(2,'0')} · ${b.section}</div>`).join('')}<div onclick="document.getElementById('_riffPicker')?.remove()" style="margin-top:8px;padding:5px 8px;border-radius:6px;cursor:pointer;color:var(--ink-faint);font-size:11px;border-top:1px solid var(--line)">Cancel</div>`;
  document.body.appendChild(box);
  setTimeout(()=>document.addEventListener('click',function h(e){if(!box.contains(e.target)){box.remove();document.removeEventListener('click',h)}},{once:true}),50);
}

function bindDrumCells(ch){if(ch.type!=='drums')return;$$('.drum-cell').forEach(c=>{c.addEventListener('click',()=>{const b=STATE.song.blocks.find(x=>x.id===c.dataset.block);b.content[ch.id].pattern[c.dataset.row][parseInt(c.dataset.i)]^=true;c.classList.toggle('active')})})}

/* ── Drag & Drop ── */
let dragSrc=null;
function bindDragAndDrop(){$$('.block,.overview-block,.ov-row').forEach(el=>{
  const handle=el.querySelector('.block-handle');
  // Only allow drag to start from the handle, so text selection in
  // textareas/inputs isn't hijacked by the drag.
  if(handle){
    handle.addEventListener('mousedown',()=>{el.dataset.dragok='1'});
  }
  el.addEventListener('dragstart',e=>{
    if(el.dataset.dragok!=='1'){e.preventDefault();return}
    dragSrc=el.dataset.blockId;el.classList.add('dragging');e.dataTransfer.effectAllowed='move';
  });
  el.addEventListener('dragend',()=>{el.classList.remove('dragging');el.dataset.dragok='';$$('.drag-over').forEach(x=>x.classList.remove('drag-over'))});
  el.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='move';el.classList.add('drag-over')});
  el.addEventListener('dragleave',()=>el.classList.remove('drag-over'));
  el.addEventListener('drop',e=>{e.preventDefault();moveBlock(dragSrc,el.dataset.blockId)});
})}

/* ── Lyrics master ── */
function parseLyricsSections(t){return t&&t.trim()?t.replace(/\r\n/g,'\n').split(/\n\s*\n+/).map(s=>s.trim()).filter(Boolean):[]}
function updateLyricsStats(t){const s=parseLyricsSections(t);const e=document.getElementById('lmStats');if(e)e.textContent=`${s.length} section${s.length===1?'':'s'} · ${STATE.song.blocks.length} blocks`}
function guessSec(t){const f=t.split('\n')[0].trim().toUpperCase().replace(/[\[\]():]/g,'').replace(/\d+/g,'').trim();const m={INTRO:'INTRO',VERSE:'VERSE','PRE-CHORUS':'PRE-CHORUS',PRECHORUS:'PRE-CHORUS',CHORUS:'CHORUS',HOOK:'CHORUS',BRIDGE:'BRIDGE',SOLO:'SOLO',INSTRUMENTAL:'INSTRUMENTAL',BREAKDOWN:'BREAKDOWN',OUTRO:'OUTRO',ENDING:'OUTRO'};for(const k in m)if(f===k||f.startsWith(k+' '))return m[k];return'VERSE'}
function distributeLyrics(ci,mode){const ta=document.getElementById('lyricsMaster');if(!ta)return;const secs=parseLyricsSections(ta.value);if(!secs.length){flash('No sections');return}if(mode==='append'){secs.forEach(t=>{const id=addBlock(guessSec(t),4);STATE.song.blocks.find(x=>x.id===id).content[ci]={text:t}});flash(secs.length+' added')}else{secs.forEach((t,i)=>{let b=STATE.song.blocks[i];if(!b){const id=addBlock(guessSec(t),4);b=STATE.song.blocks.find(x=>x.id===id)}b.content[ci]={...(b.content[ci]||{}),text:t}});flash('Distributed')}renderAll()}

/* ── Structured Tab Editor ──────────────────────────────
   Tab is stored as a column grid so the 6/4-string frame can NEVER
   break (no deleting prefixes, no losing newlines). Each column holds
   one character per string. The "e|" prefix and trailing "|" are a
   fixed visual frame, not editable text. Font auto-scales so the whole
   riff fits the slot width — no scrollbars. */
const TAB_STRINGS={guitar:['e','B','G','D','A','E'],bass:['G','D','A','E']};
function tabStringSet(type){return type==='bass'?TAB_STRINGS.bass:TAB_STRINGS.guitar}
function tabType(ch){return ch.type==='bass'?'bass':'guitar'}
/* Tab time resolution: how many character-columns make up one bar.
   beatsPerBar × subdivision (16th notes). 4/4 → 4×4 = 16 cols/bar. */
const TAB_SUBDIV=4;
function tabColsPerBar(){return sigBeats()*TAB_SUBDIV}
function tabTotalCols(block){return Math.max(tabColsPerBar(),block.bars*tabColsPerBar())}

/* Parse stored tab into a column grid: {labels, cols:[ {e:'-',B:'-',...}, ... ]} */
function parseTabGrid(stored,type){
  const labels=tabStringSet(type);
  // stored may be: legacy text "e|---|\n...", or {cols:[...]}, or empty
  if(stored && typeof stored==='object' && Array.isArray(stored.cols)){
    // sanitise: ensure every column has every label
    const cols=stored.cols.map(col=>{
      const c={}; labels.forEach(l=>{ c[l]=(col&&typeof col[l]==='string'&&col[l].length)?col[l][0]:'-'; });
      return c;
    });
    return {labels, cols: cols.length?cols:freshCols(labels,16)};
  }
  // legacy/pasted text → normalise then convert to columns
  const text=typeof stored==='string'?stored:'';
  const norm=normalizeTabText(text,type);
  const bodyByLabel={};
  norm.split('\n').forEach(line=>{
    const m=line.match(/^([A-Ga-g][#b]?)\|(.*)\|$/);
    if(m) bodyByLabel[m[1]]=m[2];
  });
  const width=Math.max(16,...labels.map(l=>(bodyByLabel[l]||'').length));
  const cols=[];
  for(let x=0;x<width;x++){
    const c={}; labels.forEach(l=>{ const b=bodyByLabel[l]||''; c[l]=b[x]||'-'; });
    cols.push(c);
  }
  return {labels, cols};
}
function freshCols(labels,width){
  const cols=[];
  for(let x=0;x<width;x++){const c={};labels.forEach(l=>c[l]='-');cols.push(c)}
  return cols;
}

/* Serialise a column grid back to canonical text for export/preview. */
function gridToText(grid){
  return grid.labels.map(l=>l+'|'+grid.cols.map(c=>c[l]||'-').join('')+'|').join('\n');
}

/* Normalise free text into exact N strings (used for paste & legacy). */
function normalizeTabText(text,type){
  const labels=tabStringSet(type), n=labels.length;
  const raw=(text||'').replace(/\r\n/g,'\n').split('\n');
  const lines=[];
  raw.forEach(l=>{const m=l.match(/^\s*([A-Ga-g][#b]?)\s*\|(.*)$/);if(m)lines.push({label:m[1],body:m[2].replace(/\|+\s*$/,'')})});
  let maxLen=16; lines.forEach(o=>{if(o.body.length>maxLen)maxLen=o.body.length});
  let bodies;
  if(lines.length===n){bodies=lines.map(o=>o.body);}
  else{
    const byLabel={},used={}; lines.forEach(o=>{if(byLabel[o.label]==null)byLabel[o.label]=o.body});
    bodies=labels.map(lab=>{
      if(byLabel[lab]!=null)return byLabel[lab];
      const hit=lines.find(o=>o.label.toLowerCase()===lab.toLowerCase()&&!used[o.label]);
      if(hit){used[hit.label]=1;return hit.body} return null;
    });
  }
  return labels.map((lab,i)=>{let b=bodies[i];b=(b==null)?'-'.repeat(maxLen):b.padEnd(maxLen,'-');return lab+'|'+b+'|'}).join('\n');
}
/* Back-compat alias used elsewhere (timeline preview, blockHasContent). */
function normalizeTab(text,type){
  if(text&&typeof text==='object'&&Array.isArray(text.cols)) return gridToText({labels:tabStringSet(type),cols:text.cols});
  return normalizeTabText(text,type);
}

/* ── Live editing state (which cell the cursor is on) ── */
const TAB_CURSOR={}; // tid -> {col}

function getTabGridFromBlock(ci,bi,type){
  const b=STATE.song.blocks.find(x=>x.id===bi);
  if(!b)return null;
  if(!b.content[ci])b.content[ci]={};
  const grid=parseTabGrid(b.content[ci].tab,type);
  // Conform column count to the block's bars: pad/trim with dashes so the
  // tab always spans exactly `bars` measures (no loss of what's written).
  conformGridCols(grid,tabTotalCols(b));
  return grid;
}
/* Pad or trim grid.cols to exactly `target` columns, filling new ones with '-'. */
function conformGridCols(grid,target){
  if(grid.cols.length<target){
    while(grid.cols.length<target){const c={};grid.labels.forEach(l=>c[l]='-');grid.cols.push(c)}
  }else if(grid.cols.length>target){
    grid.cols.length=target;
  }
  return grid;
}
/* Rescale a grid proportionally to a new column count (when bars change).
   Each old column's notes map to their proportional new index. */
function rescaleGridCols(grid,newTotal){
  const old=grid.cols, oldN=old.length;
  if(oldN===0){conformGridCols(grid,newTotal);return grid}
  if(newTotal===oldN)return grid;
  const fresh=[];
  for(let x=0;x<newTotal;x++){const c={};grid.labels.forEach(l=>c[l]='-');fresh.push(c)}
  for(let x=0;x<oldN;x++){
    const ni=Math.round(x*(newTotal-1)/(oldN-1||1));
    grid.labels.forEach(l=>{
      const ch=old[x][l];
      if(ch&&ch!=='-'&&fresh[ni][l]==='-') fresh[ni][l]=ch;
    });
  }
  grid.cols=fresh;
  return grid;
}
function saveTabGrid(ci,bi,grid){
  const b=STATE.song.blocks.find(x=>x.id===bi);
  if(!b)return;
  if(!b.content[ci])b.content[ci]={};
  b.content[ci].tab={cols:grid.cols.map(c=>({...c}))};
}

/* Render the structured editor into a container. Auto-sizes font to fit. */
function renderTabEditor(ci,bi,type,containerId){
  const grid=getTabGridFromBlock(ci,bi,type);
  const cur=(TAB_CURSOR[containerId]&&TAB_CURSOR[containerId].col!=null)?TAB_CURSOR[containerId].col:grid.cols.length-1;
  const labels=grid.labels;
  const cpb=tabColsPerBar(); // columns per measure
  const bars=Math.max(1,Math.round(grid.cols.length/cpb));
  let rows='';
  labels.forEach(lab=>{
    let cells='';
    grid.cols.forEach((c,x)=>{
      // bar separator BEFORE this column when it starts a new measure (not the first)
      if(x>0 && x%cpb===0) cells+=`<span class="tbar tdiv">|</span>`;
      cells+=`<span class="tcell${x===cur?' tcur':''}" data-col="${x}" data-lab="${lab}">${escapeHTML(c[lab]||'-')}</span>`;
    });
    rows+=`<div class="trow"><span class="tlbl">${lab}</span><span class="tbar">|</span><span class="tbody">${cells}</span><span class="tbar">|</span></div>`;
  });
  return `<div class="tabgrid" id="${containerId}" tabindex="0"
    data-ci="${ci}" data-bi="${bi}" data-type="${type}" data-cols="${grid.cols.length}" data-bars="${bars}">${rows}</div>`;
}

/* Insert a blank column at the cursor (or append if none) on ALL strings. */
function tabInsertColumn(containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const ci=el.dataset.ci,bi=el.dataset.bi,type=el.dataset.type;
  const grid=getTabGridFromBlock(ci,bi,type);
  const cur=(TAB_CURSOR[containerId]&&TAB_CURSOR[containerId].col!=null)?TAB_CURSOR[containerId].col:grid.cols.length-1;
  const at=clamp(cur+1,0,grid.cols.length);
  const blank={}; grid.labels.forEach(l=>blank[l]='-');
  grid.cols.splice(at,0,blank);
  saveTabGrid(ci,bi,grid);
  TAB_CURSOR[containerId]={col:at};
  refreshTabEditor(containerId);
}

/* Remove the column at the cursor on ALL strings (keeps ≥1 column). */
function tabRemoveColumn(containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const ci=el.dataset.ci,bi=el.dataset.bi,type=el.dataset.type;
  const grid=getTabGridFromBlock(ci,bi,type);
  if(grid.cols.length<=1)return;
  const cur=(TAB_CURSOR[containerId]&&TAB_CURSOR[containerId].col!=null)?TAB_CURSOR[containerId].col:grid.cols.length-1;
  grid.cols.splice(cur,1);
  saveTabGrid(ci,bi,grid);
  TAB_CURSOR[containerId]={col:clamp(cur-1,0,grid.cols.length-1)};
  refreshTabEditor(containerId);
}

function refreshTabEditor(containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const ci=el.dataset.ci,bi=el.dataset.bi,type=el.dataset.type;
  const html=renderTabEditor(ci,bi,type,containerId);
  const tmp=document.createElement('div'); tmp.innerHTML=html;
  el.replaceWith(tmp.firstElementChild);
  bindTabEditor(containerId);
  fitTabFont(containerId);
}

/* Auto-scale font so all columns fit the width — no horizontal scroll. */
function fitTabFont(containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const cols=parseInt(el.dataset.cols)||16;
  const bars=parseInt(el.dataset.bars)||1;
  // total chars on a row: label(1) + bar(1) + cols + separators(bars-1) + trailing bar(1)
  const totalChars=cols+(bars-1)+3;
  const w=el.clientWidth-4;
  let fs=w/(totalChars*0.6); // monospace char ≈ 0.6em wide
  fs=clamp(fs,5,13);
  el.style.fontSize=fs+'px';
}

/* Keyboard + click handling for the structured grid. */
function bindTabEditor(containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const ci=el.dataset.ci,bi=el.dataset.bi,type=el.dataset.type;

  // click a cell → place cursor there
  el.querySelectorAll('.tcell').forEach(cell=>{
    cell.addEventListener('mousedown',e=>{
      e.preventDefault();
      TAB_CURSOR[containerId]={col:parseInt(cell.dataset.col)};
      el.focus();
      markCursor(el,parseInt(cell.dataset.col));
    });
  });

  el.addEventListener('keydown',e=>{
    const grid=getTabGridFromBlock(ci,bi,type);
    let cur=(TAB_CURSOR[containerId]&&TAB_CURSOR[containerId].col!=null)?TAB_CURSOR[containerId].col:grid.cols.length-1;
    const labels=grid.labels;
    if(e.key==='ArrowLeft'){e.preventDefault();cur=clamp(cur-1,0,grid.cols.length-1);TAB_CURSOR[containerId]={col:cur};markCursor(el,cur);return;}
    if(e.key==='ArrowRight'){e.preventDefault();cur=clamp(cur+1,0,grid.cols.length-1);TAB_CURSOR[containerId]={col:cur};markCursor(el,cur);return;}
    // typing a fret number / technique char: write into the cell on the active string.
    if(/^[0-9xXhHpPbB/\\~().*]$/.test(e.key)){
      e.preventDefault();
      const lab=el.dataset.activeLab||labels[labels.length-1];
      if(grid.cols[cur]){grid.cols[cur][lab]=e.key;saveTabGrid(ci,bi,grid)}
      // advance cursor but never past the last column (columns are fixed by bars)
      TAB_CURSOR[containerId]={col:clamp(cur+1,0,grid.cols.length-1)};
      refreshTabEditor(containerId);
      return;
    }
    if(e.key==='Backspace'){
      e.preventDefault();
      const lab=el.dataset.activeLab||labels[labels.length-1];
      if(grid.cols[cur]) grid.cols[cur][lab]='-';
      saveTabGrid(ci,bi,grid);
      // step back so repeated backspace clears leftward
      TAB_CURSOR[containerId]={col:clamp(cur-1,0,grid.cols.length-1)};
      refreshTabEditor(containerId);
      return;
    }
  });

  // track which string-row is active (for typing) by remembering last clicked label
  el.querySelectorAll('.tcell').forEach(cell=>{
    cell.addEventListener('mousedown',()=>{ el.dataset.activeLab=cell.dataset.lab; });
  });
  el.addEventListener('paste',e=>tabPaste(e,containerId));
}

function markCursor(el,col){
  el.querySelectorAll('.tcell.tcur').forEach(c=>c.classList.remove('tcur'));
  el.querySelectorAll(`.tcell[data-col="${col}"]`).forEach(c=>c.classList.add('tcur'));
}

/* Paste: normalise into the grid, never breaking structure. */
function tabPaste(e,containerId){
  const el=document.getElementById(containerId); if(!el)return;
  const ci=el.dataset.ci,bi=el.dataset.bi,type=el.dataset.type;
  const text=(e.clipboardData||window.clipboardData).getData('text');
  if(!text)return;
  e.preventDefault();
  const norm=normalizeTabText(text,type);
  const b=STATE.song.blocks.find(x=>x.id===bi);
  if(!b.content[ci])b.content[ci]={};
  b.content[ci].tab=norm; // store as text; parseTabGrid converts on next render
  const grid=parseTabGrid(norm,type); saveTabGrid(ci,bi,grid);
  refreshTabEditor(containerId);
}

/* ── Render: Section tag ── */
function renderSectionTag(block){const cls=(block.section||'').toLowerCase().replace(/[^a-z]/g,'');return`<select class="section-tag ${cls}" onchange="setSection('${block.id}',this.value)">${SECTION_OPTIONS.map(s=>`<option value="${s}"${s===block.section?' selected':''}>${s}</option>`).join('')}</select>`}

/* ── Render: Top bar ── */