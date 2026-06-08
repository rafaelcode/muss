function visibleOverviewChannels(){
  const hidden=STATE.ui.hiddenChannels||(STATE.ui.hiddenChannels=[]);
  return STATE.song.channels.filter(c=>!hidden.includes(c.id));
}
function ovMerged(){ if(STATE.ui.ovMerge===undefined)STATE.ui.ovMerge=false; return STATE.ui.ovMerge; }
function setOvMerge(v){ STATE.ui.ovMerge=v; STATE.ui.editingBlockId=null; renderOverview(); }
/* The single rhythm channel whose chords are placed over the lyrics. */
function primaryChordChannel(){
  return visibleOverviewChannels().find(c=>c.type==='rhythm')||null;
}
/* Columns: in merged mode rhythm is folded into lyrics; in separated mode it is its own column. */
function overviewColumnChannels(){
  const vis=visibleOverviewChannels();
  return ovMerged()? vis.filter(c=>c.type!=='rhythm') : vis;
}
function toggleOverviewChannel(id){
  const h=STATE.ui.hiddenChannels||(STATE.ui.hiddenChannels=[]);
  const i=h.indexOf(id); if(i>=0)h.splice(i,1);else h.push(id);
  renderOverview();
}
function ovColTemplate(channels){
  const cols=channels.map(c=>{
    if(c.type==='lyrics'){
      // Compute the pixel width of the longest lyric line across all blocks.
      const ly=STATE.song.channels.find(x=>x.type==='lyrics');
      let maxLen=20,_maxLine='';
      if(ly)STATE.song.blocks.forEach(b=>{(b.content[ly.id]?.text||'').split('\n').forEach(l=>{if(l.length>maxLen){maxLen=l.length;_maxLine=l}})});
      // Measure using a hidden span with the same font as .ov-ln-text (Fraunces 16px italic).
      let px=maxLen*9.5;
      try{const sp=document.createElement('span');sp.style.cssText='position:absolute;visibility:hidden;white-space:nowrap;font-family:Fraunces,serif;font-size:16px;font-weight:300;font-style:italic';sp.textContent=_maxLine||'M'.repeat(maxLen);document.body.appendChild(sp);const _m=sp.offsetWidth;sp.remove();if(_m>10)px=_m}catch(_){}
      return Math.max(200,Math.ceil(px)+32)+'px';
    }
    if(c.type==='lead'||c.type==='bass')return'minmax(160px,1fr)';
    if(c.type==='rhythm')return'minmax(140px,1fr)';
    return'minmax(150px,1fr)';
  });
  return`108px ${cols.join(' ')} 32px`;
}

/* ── Repeat detection ── */
function channelFingerprint(block,ch){
  const c=block.content[ch.id];if(!c)return'';
  if(ch.type==='rhythm'){const cd=getChords(block,ch.id);return cd.length?('R:'+cd.map(x=>x.name+'@'+x.beats).join(',')):''}
  if(ch.type==='lead'||ch.type==='bass'){const t=normalizeTab(c.tab,tabType(ch));return /[0-9xXhHpPbB]/.test(t)?('T:'+t.replace(/\s+/g,'')):''}
  if(ch.type==='drums'){const p=c.pattern||{};const s=Object.keys(p).sort().map(k=>k+':'+(p[k]||[]).map(v=>v?1:0).join('')).join('|');return /1/.test(s)?('D:'+s):''}
  if(ch.type==='lyrics')return'';
  return c.text&&c.text.trim()?('N:'+c.text.trim()):'';
}
function buildRepeatMap(){
  const map={}; STATE.song.channels.forEach(ch=>map[ch.id]={});
  STATE.song.blocks.forEach((b,i)=>STATE.song.channels.forEach(ch=>{
    const fp=channelFingerprint(b,ch);
    if(fp && !(fp in map[ch.id]))map[ch.id][fp]={index:i};
  }));
  return map;
}
function matchingProgression(block,ch){
  if(ch.type!=='rhythm')return null; ensureProgs();
  const fp=getChords(block,ch.id).map(x=>x.name+'|'+x.beats).join(',');
  if(!fp)return null;
  return STATE.song.progressions.find(p=>p.chords.map(c=>(c.name||c)+'|'+(c.beats||sigBeats())).join(',')===fp)||null;
}
function ovBadges(block,ch,blockIndex,repeatMap){
  let b=''; const ic='<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 8a6 6 0 0110-4M14 8a6 6 0 01-10 4M12 1v3h-3M4 15v-3h3"/></svg>';
  if(ch.type==='rhythm'){const prog=matchingProgression(block,ch);if(prog)b+=`<span class="ov-repeat pattern" title="Patrón guardado">${ic}${escapeHTML(prog.name)}</span>`;}
  const first=repeatMap[ch.id]?.[channelFingerprint(block,ch)];
  if(first&&first.index<blockIndex)b+=`<span class="ov-repeat" title="Igual que el bloque ${first.index+1}">${ic}como #${String(first.index+1).padStart(2,'0')}</span>`;
  return b;
}

/* ── Per-line chord placement (line = time-bar) ── */
function distributeChordsToLines(block,ch){
  const total=block.bars*sigBeats();
  const lyrics=getLyricsChannel();
  const text=block.content[lyrics.id]?.text||'';
  let lines=text.length?text.split('\n'):[''];
  const n=lines.length;
  const chords=getChords(block,ch.id);
  const out=lines.map(t=>({text:t,chords:[],beatsPerLine:total/n,barsPerLine:(total/n)/sigBeats()}));

  // If the rhythm chords carry line breaks, map each chord-line to a lyric line.
  const groups=[[]]; chords.forEach((c,i)=>{groups[groups.length-1].push(c);if(c.br&&i<chords.length-1)groups.push([])});
  if(groups.length>1){
    groups.forEach((g,gi)=>{
      const li=Math.min(n-1,gi);
      const lineBeats=g.reduce((s,c)=>s+c.beats,0)||1;
      out[li].beatsPerLine=lineBeats; out[li].barsPerLine=lineBeats/sigBeats();
      let pos=0; g.forEach(c=>{out[li].chords.push({name:c.name,beats:c.beats,offset:Math.max(0,Math.min(.97,pos/lineBeats))});pos+=c.beats});
    });
    return {lines:out,beatsPerLine:total/n,total};
  }

  // Otherwise distribute evenly across the lyric lines by time.
  const bpl=total/n; let pos=0;
  const placed=chords.map(c=>{const s=pos;pos+=c.beats;return{name:c.name,beats:c.beats,start:s}});
  placed.forEach(p=>{let li=Math.min(n-1,Math.max(0,Math.floor((p.start+1e-6)/bpl)));const ls=li*bpl;out[li].chords.push({name:p.name,beats:p.beats,offset:Math.max(0,Math.min(.97,(p.start-ls)/bpl))})});
  return {lines:out,beatsPerLine:bpl,total};
}

function renderOverview(){
  ovMerged(); // ensure default
  const columns=overviewColumnChannels();
  const repeatMap=buildRepeatMap();

  const visChips=STATE.song.channels.map(c=>{
    const off=(STATE.ui.hiddenChannels||[]).includes(c.id);
    return`<span class="ov-vis-chip${off?' off':''}" style="--ch-color:${c.color}" onclick="toggleOverviewChannel('${c.id}')" title="Mostrar/ocultar"><span class="sw"></span>${escapeHTML(c.name)}</span>`;
  }).join('');
  const merge=ovMerged();
  $('#editorHead').innerHTML=
    `<div class="editor-title"><span class="editor-title-tag">Overview</span><h2>${escapeHTML(STATE.song.title)||'Untitled'}</h2></div>`+
    `<div class="ov-toolbar">`+
      `<div class="pick-group ov-mode"><button class="${merge?'active':''}" onclick="setOvMerge(true)" title="Acordes encima de la letra">Fusionado</button><button class="${merge?'':'active'}" onclick="setOvMerge(false)" title="Rítmica y letra en columnas">Separado</button></div>`+
      `<div class="ov-vis">${visChips}</div>`+
      `<span style="font-size:10px;color:var(--ink-faint)" id="ovStats"></span>`+
      `<button class="add-block-btn" data-action="add-block">+ Add Block</button>`+
    `</div>`;

  const cv=$('#canvas');cv.className='canvas';cv.style.cssText='';cv.innerHTML='';
  const hint=document.createElement('div');hint.className='ov-hint';
  hint.innerHTML = merge
    ? `<i style="font-style:normal;opacity:.7">✎</i> Cada línea se interpreta como una <b>barra de tiempos</b>: los acordes se colocan encima en el beat donde tocan. Clic en una línea para editarla. Cambia a <b>Separado</b> para ver rítmica y letra en columnas.`
    : `<i style="font-style:normal;opacity:.7">✎</i> Rítmica y letra en <b>columnas separadas</b>. Cambia a <b>Fusionado</b> para poner los acordes encima de cada línea.`;
  cv.appendChild(hint);

  if(!STATE.song.blocks.length)addBlock('VERSE',4);

  const tpl=ovColTemplate(columns);
  const wrap=document.createElement('div');wrap.className='ov-grid-wrap';

  const head=document.createElement('div');head.className='ov-channel-head';head.style.gridTemplateColumns=tpl;
  let hh=`<div class="ov-ch-cell"><span class="ov-ch-gutter">Bloque</span></div>`;
  columns.forEach(ch=>{
    const info=CH_TYPE_INFO[ch.type]||CH_TYPE_INFO.notes;
    const extra=(merge&&ch.type==='lyrics'&&primaryChordChannel())?' + acordes':'';
    hh+=`<div class="ov-ch-cell" style="--ch-color:${ch.color}"><span class="ov-ch-swatch"></span><span><span class="ov-ch-title">${escapeHTML(ch.name)}</span> <span class="ov-ch-sub">${info.label}${extra}</span></span></div>`;
  });
  hh+=`<div class="ov-ch-cell"></div>`;head.innerHTML=hh;wrap.appendChild(head);

  wrap.appendChild(makeInsertZone(0));
  STATE.song.blocks.forEach((block,i)=>{
    wrap.appendChild(buildOverviewRow(block,i,columns,tpl,repeatMap));
    wrap.appendChild(makeInsertZone(i+1));
  });
  cv.appendChild(wrap);

  bindDragAndDrop();updateOverviewStats();
  requestAnimationFrame(()=>{$$('.ov-lyric-edit').forEach(autoGrow)});
}

function buildOverviewRow(block,i,columns,tpl,repeatMap){
  const cur=STATE.ui.isPlaying&&i===STATE.ui.currentBlockIndex;
  const pp=cur?(STATE.ui.blockProgress*100):0;
  const d=document.createElement('div');
  d.className='ov-row'+(block.enabled?'':' disabled')+(cur?' current':'');
  d.dataset.blockId=block.id;d.draggable=true;d.style.gridTemplateColumns=tpl;

  let html=`<div class="ov-gutter block-handle" draggable="false">
    <div class="ov-gutter-top"><span class="ov-gutter-num">${String(i+1).padStart(2,'0')}</span><span class="ov-gutter-beats">${block.bars*sigBeats()}b</span></div>
    ${renderSectionTag(block)}
    <div class="ov-gutter-bars"><label>Bars</label><input class="bars-input" type="number" min="1" max="32" value="${block.bars}" onchange="setBars('${block.id}',this.value)"></div>
  </div>`;
  columns.forEach(ch=>{html+=`<div class="ov-cell${ch.muted?' muted':''}">${renderOverviewCell(ch,block,i,repeatMap)}</div>`});
  html+=`<div class="ov-acts">
    <button class="${block.enabled?'toggle-on':''}" onclick="toggleBlockEnabled('${block.id}')" title="Activar/silenciar">${block.enabled?'●':'○'}</button>
    <button onclick="duplicateBlock('${block.id}')" title="Duplicar">⧉</button>
    <button class="del" onclick="deleteBlockKeepText('${block.id}')" title="Eliminar">×</button>
  </div>
  <div class="block-progress" style="width:${pp}%"></div>`;
  d.innerHTML=html;return d;
}

function renderOverviewCell(ch,block,blockIndex,repeatMap){
  if(ch.type==='lyrics') return renderLyricsCell(ch,block,blockIndex,repeatMap);

  const fp=channelFingerprint(block,ch);
  if(!fp)return`<div class="ov-cell-empty">·</div>`;
  const badges=ovBadges(block,ch,blockIndex,repeatMap);
  let body='';
  if(ch.type==='rhythm'){ body=ovChordLane(block,ch); }          // separated mode column
  else if(ch.type==='lead'||ch.type==='bass'){ body=`<div class="ov-tab">${escapeHTML(normalizeTab(block.content[ch.id].tab,tabType(ch)))}</div>`; }
  else if(ch.type==='drums'){ body=ovDrumMini(block,ch); }
  else { body=`<div class="ov-notes">${escapeHTML(block.content[ch.id].text||'')}</div>`; }
  return badges+body;
}

/* The lyrics cell: editable textarea, OR (merged + not editing) per-line chord display. */
function renderLyricsCell(ch,block,blockIndex,repeatMap){
  const lt=block.content[ch.id]?.text||'';
  const editing=STATE.ui.editingBlockId===block.id;
  const chordCh=primaryChordChannel();

  if(!ovMerged() || editing){
    const lanes=(ovMerged()&&editing&&chordCh)? '' : ''; // (chords hidden while typing)
    return`${lanes}<textarea class="ov-lyric-edit" data-block-id="${block.id}" placeholder="Letra del bloque… (línea en blanco = nuevo bloque)"
      oninput="onOverviewLyricInput(event,'${block.id}','${ch.id}')"
      onkeydown="onOverviewLyricKey(event,'${block.id}','${ch.id}')"
      onpaste="onOverviewLyricPaste(event,'${block.id}','${ch.id}')"
      ${ovMerged()?`onblur="onLyricBlur(event)"`:''}>${escapeHTML(lt)}</textarea>`;
  }

  // Merged display: chords above each line.
  const badges=chordCh?ovBadges(block,chordCh,blockIndex,repeatMap):'';
  let body='';
  if(chordCh){
    const {lines}=distributeChordsToLines(block,chordCh);
    body=lines.map(ln=>ovLineHTML(ln)).join('');
  }else{
    // no chords → still editable lines
    const arr=lt.length?lt.split('\n'):[''];
    body=arr.map(t=>ovLineHTML({text:t,chords:[],beatsPerLine:0,barsPerLine:0})).join('');
  }
  return`<div class="ov-lyrics-disp" onclick="startEditLyrics('${block.id}')" title="Clic para editar">${badges?`<div class="ov-lc-badges">${badges}</div>`:''}${body}</div>`;
}

/* One lyric line with its chords positioned by beat over a time-bar. */
function ovLineHTML(ln){
  const bpl=ln.beatsPerLine||0;
  const hasChords=ln.chords&&ln.chords.length;
  let chordRow='';
  if(hasChords||bpl){
    let ticks='';
    if(bpl){
      const beats=Math.round(bpl); const sb=sigBeats();
      for(let k=0;k<beats;k++){const left=(k/bpl)*100;ticks+=`<span class="ov-ln-tick${k%sb===0?' bar':''}" style="left:${left}%"></span>`}
    }
    const chords=(ln.chords||[]).map(c=>`<span class="ov-ln-chord" style="left:${(c.offset*100).toFixed(2)}%">${escapeHTML(c.name)}<span class="bt">${c.beats}b</span></span>`).join('');
    chordRow=`<div class="ov-ln-chords">${ticks}${chords}</div>`;
  }
  const txt=ln.text&&ln.text.trim()?escapeHTML(ln.text):'<span class="empty">Letra…</span>';
  return`<div class="ov-ln">${chordRow}<div class="ov-ln-text">${txt}</div></div>`;
}

/* Click a line to edit the whole block's lyrics in place. */
function startEditLyrics(id){
  STATE.ui.editingBlockId=id; renderOverview();
  requestAnimationFrame(()=>{const t=document.querySelector(`textarea[data-block-id="${id}"]`);if(t){t.focus();t.setSelectionRange(t.value.length,t.value.length);autoGrow(t)}});
}
/* Stop editing only when focus truly left the lyric editors (not during split/merge re-render). */
function onLyricBlur(e){
  setTimeout(()=>{
    const ae=document.activeElement;
    if(ae&&ae.classList&&ae.classList.contains('ov-lyric-edit'))return;
    if(STATE.ui.editingBlockId!==null){STATE.ui.editingBlockId=null;renderOverview()}
  },60);
}

/* Proportional chord lane (used by the separated-mode rhythm column). */
function ovChordLane(block,ch){
  const chords=getChords(block,ch.id);
  if(!chords.length)return`<div class="ov-cell-empty">·</div>`;
  const lane=chords.map(c=>`<div class="ov-chord-cell" style="flex-grow:${c.beats};flex-shrink:1;flex-basis:0"><span class="nm">${escapeHTML(c.name)}</span><span class="bt">${c.beats}b</span></div>`).join('');
  let ticks='<div class="ov-bar-ticks">';for(let b=0;b<block.bars;b++)ticks+='<div class="ov-bar-tick"></div>';ticks+='</div>';
  return`<div class="ov-chord-lane">${lane}</div>${ticks}`;
}
function ovDrumMini(block,ch){
  const p=block.content[ch.id]?.pattern||{};const rows=['HH','SN','KK','TM','CY'];
  const total=block.bars*sigBeats()*4,step=Math.max(1,Math.floor(total/24));
  let h='<div class="ov-drum" style="--ch-color:'+ch.color+'">';
  rows.forEach(r=>{const a=p[r]||[];h+=`<div class="ov-drum-row"><span class="ov-drum-lab">${r}</span><div class="ov-drum-dots">`;for(let i=0;i<total;i+=step)h+=`<div class="ov-drum-dot${a[i]?' on':''}"></div>`;h+='</div></div>'});
  return h+'</div>';
}

/* Auto-grow the textarea and persist text as you type. */
function onOverviewLyricInput(e,blockId,lyricsChId){
  const ta=e.target;
  setText(lyricsChId,blockId,ta.value);
  autoGrow(ta);
  updateOverviewStats();
}

function autoGrow(ta){
  ta.style.height='auto';
  ta.style.height=Math.max(48,ta.scrollHeight)+'px';
}

/* Key handling: blank line splits, backspace-at-start merges. */
function onOverviewLyricKey(e,blockId,lyricsChId){
  const ta=e.target;
  const idx=STATE.song.blocks.findIndex(b=>b.id===blockId);

  // ENTER: if it would create a blank line (previous char is newline or empty),
  // split the block at the cursor instead.
  if(e.key==='Enter'){
    const pos=ta.selectionStart;
    const before=ta.value.slice(0,pos);
    const after=ta.value.slice(pos);
    // Blank line = cursor right after an existing newline, or at end after newline
    const endsWithNewline=/\n\s*$/.test(before);
    if(endsWithNewline){
      e.preventDefault();
      // Text for current block = before (trimmed of trailing newlines)
      const keep=before.replace(/\n\s*$/,'');
      const moved=after.replace(/^\s*\n/,'');
      setText(lyricsChId,blockId,keep);
      // Create a new block right after, carrying the rest of the text
      const newId=insertBlockAfter(idx,STATE.song.blocks[idx].section);
      setText(lyricsChId,newId,moved);
      if(ovMerged())STATE.ui.editingBlockId=newId;
      renderOverview();
      // focus the new block at start
      requestAnimationFrame(()=>{
        const nt=document.querySelector(`textarea[data-block-id="${newId}"]`);
        if(nt){nt.focus();nt.setSelectionRange(0,0);autoGrow(nt)}
      });
      return;
    }
  }

  // BACKSPACE at very start of a block → merge into previous block
  if(e.key==='Backspace' && ta.selectionStart===0 && ta.selectionEnd===0){
    if(idx>0){
      e.preventDefault();
      const prev=STATE.song.blocks[idx-1];
      const prevText=prev.content[lyricsChId]?.text||'';
      const curText=ta.value;
      const mergedPos=prevText.length;
      const merged=prevText+(prevText&&curText?'\n':'')+curText;
      setText(lyricsChId,prev.id,merged);
      // remove current block
      STATE.song.blocks.splice(idx,1);
      if(ovMerged())STATE.ui.editingBlockId=prev.id;
      renderOverview();
      requestAnimationFrame(()=>{
        const pt=document.querySelector(`textarea[data-block-id="${prev.id}"]`);
        if(pt){pt.focus();pt.setSelectionRange(mergedPos,mergedPos);autoGrow(pt)}
      });
      return;
    }
  }
}

/* Paste multi-section text → split into blocks at blank lines. */
function onOverviewLyricPaste(e,blockId,lyricsChId){
  const text=(e.clipboardData||window.clipboardData).getData('text');
  if(!text||!/\n\s*\n/.test(text)) return; // single section → default paste
  e.preventDefault();
  const ta=e.target;
  const idx=STATE.song.blocks.findIndex(b=>b.id===blockId);
  const before=ta.value.slice(0,ta.selectionStart);
  const after=ta.value.slice(ta.selectionEnd);

  // Sections from the pasted content
  const sections=parseLyricsSections(text);
  // First section merges into current block's existing text-before
  const firstText=(before+sections[0]).trim();
  setText(lyricsChId,blockId,firstText);
  STATE.song.blocks[idx].section=guessSec(sections[0]);

  let insertAt=idx;
  let lastId=blockId;
  for(let s=1;s<sections.length;s++){
    const newId=insertBlockAfter(insertAt,guessSec(sections[s]));
    let txt=sections[s];
    if(s===sections.length-1) txt=txt+(after?'\n'+after:'');
    setText(lyricsChId,newId,txt.trim());
    insertAt++;lastId=newId;
  }
  if(ovMerged())STATE.ui.editingBlockId=lastId;
  renderOverview();
  requestAnimationFrame(()=>{
    const lt=document.querySelector(`textarea[data-block-id="${lastId}"]`);
    if(lt){lt.focus();autoGrow(lt)}
  });
  flash(sections.length+' blocks from paste');
}

/* Insert a fresh block right after index `afterIdx`, return its id. */
function insertBlockAfter(afterIdx,section='VERSE'){
  const bl={id:uid(),section:section||'VERSE',bars:4,enabled:true,comment:'',content:{}};
  STATE.song.channels.forEach(c=>{bl.content[c.id]=defaultContent(c.type)});
  STATE.song.blocks.splice(afterIdx+1,0,bl);
  return bl.id;
}

/* Delete a block but, if it has lyrics, merge them up so nothing is lost silently. */
function deleteBlockKeepText(blockId){
  const idx=STATE.song.blocks.findIndex(b=>b.id===blockId);
  if(idx===-1)return;
  const lyricsCh=getLyricsChannel();
  const txt=(STATE.song.blocks[idx].content[lyricsCh.id]?.text||'').trim();
  if(txt && !confirm('Delete this block and its lyrics?')) return;
  STATE.song.blocks.splice(idx,1);
  if(!STATE.song.blocks.length) addBlock('VERSE',4);
  renderOverview();
}

function updateOverviewStats(){
  const el=document.getElementById('ovStats');
  if(!el)return;
  const n=STATE.song.blocks.length;
  const totalBeats=STATE.song.blocks.reduce((s,b)=>s+(b.enabled?b.bars*sigBeats():0),0);
  el.textContent=`${n} block${n===1?'':'s'} · ${totalBeats} beats`;
}

/* ── Render: Timeline ── */
const TL_BW=220;
function renderTimeline(){
  $('#editorHead').innerHTML='<div class="editor-title"><span class="editor-title-tag" style="background:var(--accent-bg);color:var(--green)">Timeline</span><h2>Horizontal View</h2></div><button class="add-block-btn" data-action="add-block">+ Add Block</button>';
  const cv=$('#canvas');cv.className='canvas';cv.style.cssText='padding:0;overflow:hidden';
  if(!STATE.song.blocks.length){cv.innerHTML='<div class="empty-state" style="padding:60px"><h4>No blocks</h4></div>';return}
  const bs=STATE.song.blocks,chs=STATE.song.channels.filter(c=>!c.muted);
  let ruler='<div class="tl-ruler"><div class="tl-label-col">Channels</div><div class="tl-ruler-inner" id="tlRulerInner">';
  bs.forEach((b,i)=>{const cur=STATE.ui.isPlaying&&i===STATE.ui.currentBlockIndex;const sc=SECTION_COLORS[b.section]||'#888';ruler+=`<div class="tl-ruler-col${cur?' current':''}${b.enabled?'':' disabled'}" style="width:${TL_BW}px"><div class="tl-r-num">${String(i+1).padStart(2,'0')}</div><div class="tl-r-sec" style="background:${sc}">${b.section}</div></div>`});
  ruler+='</div></div>';
  let body='<div class="tl-body" id="tlBody"><div class="tl-playhead" id="tlPlayhead" style="left:0;display:none"></div>';
  chs.forEach(ch=>{body+=`<div class="tl-row"><div class="tl-row-label"><div class="tl-dot" style="background:${ch.color}"></div><div class="tl-chname">${escapeHTML(ch.name)}</div></div><div class="tl-cells">`;bs.forEach((b,i)=>{const cur=STATE.ui.isPlaying&&i===STATE.ui.currentBlockIndex;body+=`<div class="tl-cell${cur?' current':''}${b.enabled?'':' disabled'}" style="width:${TL_BW}px;--ch-color:${ch.color}">${renderTLCell(ch,b)}</div>`});body+='</div></div>'});
  body+='</div>';
  cv.innerHTML='<div class="tl-wrap">'+ruler+body+'</div>';
  const bd=$('#tlBody'),ri=$('#tlRulerInner');
  if(bd&&ri)bd.addEventListener('scroll',()=>{ri.style.transform=`translateX(-${bd.scrollLeft}px)`;updateTLPlayhead()});
  updateTLPlayhead();
}
function renderTLCell(ch,block){const data=block.content[ch.id]||defaultContent(ch.type);switch(ch.type){
case'lyrics':{const t=data.text||'';return t?`<div class="tl-cell-lyric">${escapeHTML(t)}</div>`:'<div class="tl-cell-lyric empty">···</div>'}
case'rhythm':{const c=(data.chords||[]).map(normalizeChord),n=data.notes||'';let r='';if(c.length)r+=`<div class="tl-cell-chords">${c.map(x=>`<span class="tl-cell-chord">${escapeHTML(x.name)}</span>`).join('')}</div>`;if(n.trim())r+=`<div class="tl-cell-notes" style="margin-top:3px">${escapeHTML(n.substring(0,100))}</div>`;return r||'<div class="tl-cell-lyric empty">···</div>'}
case'lead':case'bass':{const tt=tabType(ch);const isEmpty=!data.tab||(typeof data.tab==='string'&&(data.tab===''||data.tab===defaultTab(ch.type)));const txt=data.tab?normalizeTab(data.tab,tt):'';const hasNotes=txt&&/[0-9xXhHpPbB]/.test(txt);return hasNotes?`<div class="tl-cell-tab">${escapeHTML(txt)}</div>`:'<div class="tl-cell-lyric empty">···</div>'}
case'drums':{const p=data.pattern||{},rows=['HH','SN','KK','TM','CY'],total=block.bars*sigBeats()*4,step=Math.max(1,Math.floor(total/28));let r='<div class="tl-cell-drum">';rows.forEach(x=>{const a=p[x]||[];r+='<div class="tl-drum-row">';for(let i=0;i<total;i+=step)r+=`<div class="tl-drum-dot${a[i]?' on':''}"></div>`;r+='</div>'});return r+'</div>'}
default:{const t=data.text||'';return t.trim()?`<div class="tl-cell-notes">${escapeHTML(t.substring(0,130))}</div>`:'<div class="tl-cell-lyric empty">···</div>'}}}
function updateTLPlayhead(){const ph=$('#tlPlayhead');if(!ph)return;if(!STATE.ui.isPlaying){ph.style.display='none';return}const bd=$('#tlBody');if(!bd)return;ph.style.display='block';ph.style.left=(136+STATE.ui.currentBlockIndex*TL_BW+STATE.ui.blockProgress*TL_BW-bd.scrollLeft)+'px'}

/* ── Audio / Metronome ── */
let audioCtx=null;
function ensureAudio(){if(!audioCtx)try{audioCtx=new(window.AudioContext||window.webkitAudioContext)()}catch(e){return false}if(audioCtx.state==='suspended')audioCtx.resume().catch(()=>{});return true}
function clickSound(a){if(!audioCtx||audioCtx.state!=='running')return;try{const t=audioCtx.currentTime,o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type='square';o.frequency.setValueAtTime(a?1500:900,t);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(a?.35:.22,t+.002);g.gain.exponentialRampToValueAtTime(.0001,t+.06);o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+.07)}catch(e){}}
function renderBeatLeds(){const n=sigBeats(),r=$('#beatLeds');r.innerHTML='';for(let i=0;i<n;i++){const l=document.createElement('div');l.className='led'+(i===0?' downbeat':'');r.appendChild(l)}}
function lightBeat(b){$$('#beatLeds .led').forEach((l,i)=>l.classList.toggle('on',i===b))}
function togglePlay(){STATE.ui.isPlaying?pausePlayback():startPlayback()}
function startPlayback(){ensureAudio();STATE.ui.isPlaying=true;STATE.ui.blockProgress=0;$('#playBtn').classList.add('active');$('#playIcon').innerHTML='<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';if(STATE.ui.countIn>0){STATE.ui.isCountingIn=true;STATE.ui.countInBeatsLeft=STATE.ui.countIn*sigBeats();startCountIn()}else{STATE.ui.isCountingIn=false;startMetronome()}}
function startCountIn(){const iv=60000/STATE.song.bpm,bpb=sigBeats(),tot=STATE.ui.countInBeatsLeft;function tick(){if(STATE.ui.countInBeatsLeft<=0){clearInterval(STATE.ui.metronomeTimer);STATE.ui.isCountingIn=false;startMetronome();return}const b=(tot-STATE.ui.countInBeatsLeft)%bpb;clickSound(b===0);lightBeat(b);STATE.ui.countInBeatsLeft--}tick();STATE.ui.metronomeTimer=setInterval(tick,iv)}
function pausePlayback(){STATE.ui.isPlaying=false;STATE.ui.isCountingIn=false;STATE.ui.blockProgress=0;$('#playBtn').classList.remove('active');$('#playIcon').innerHTML='<path d="M8 5v14l11-7z"/>';if(STATE.ui.metronomeTimer)clearInterval(STATE.ui.metronomeTimer);STATE.ui.metronomeTimer=null;$$('#beatLeds .led').forEach(l=>l.classList.remove('on'));$$('.chord-slot.chord-active').forEach(s=>s.classList.remove('chord-active'));renderEditor()}
function stopPlayback(){pausePlayback();STATE.ui.currentBlockIndex=0;STATE.ui.currentBeat=0;STATE.ui.blockProgress=0;renderEditor()}
function restartMetronome(){if(STATE.ui.metronomeTimer)clearInterval(STATE.ui.metronomeTimer);startMetronome()}
function startMetronome(){const iv=60000/STATE.song.bpm,bpb=sigBeats();function tick(){const block=STATE.song.blocks[STATE.ui.currentBlockIndex];if(!block){stopPlayback();return}if(!block.enabled){STATE.ui.currentBlockIndex++;STATE.ui.currentBeat=0;STATE.ui.blockProgress=0;if(STATE.ui.currentBlockIndex>=STATE.song.blocks.length){stopPlayback();return}renderEditor();scrollToCurrentBlock();return}const tot=block.bars*bpb;clickSound(STATE.ui.currentBeat===0);lightBeat(STATE.ui.currentBeat%bpb);const tp=(STATE.ui.currentBeat+1)/tot;if(STATE.ui.currentBeat===0){STATE.ui.blockProgress=0;renderEditor();scrollToCurrentBlock();requestAnimationFrame(()=>requestAnimationFrame(()=>{STATE.ui.blockProgress=tp;updateProgressBar()}))}else{STATE.ui.blockProgress=tp;updateProgressBar()}updateTLPlayhead();STATE.ui.currentBeat++;if(STATE.ui.currentBeat>=tot){STATE.ui.currentBeat=0;STATE.ui.blockProgress=0;STATE.ui.currentBlockIndex++;if(STATE.ui.currentBlockIndex>=STATE.song.blocks.length)stopPlayback()}}tick();STATE.ui.metronomeTimer=setInterval(tick,iv)}
function updateProgressBar(){
  const block=STATE.song.blocks[STATE.ui.currentBlockIndex];if(!block)return;
  const el=document.querySelector(`[data-block-id="${block.id}"] .block-progress`);
  if(el){const bs=(60/STATE.song.bpm).toFixed(3);el.style.transition=`width ${bs}s linear`;el.style.width=(STATE.ui.blockProgress*100)+'%'}
  // Chord playhead cursor (block view): move across the chord row, hide in other blocks
  const bs2=(60/STATE.song.bpm).toFixed(3);
  document.querySelectorAll('.chord-playhead').forEach(ph=>{
    if(ph.dataset.block===block.id){ph.classList.add('active');ph.style.transition=`left ${bs2}s linear`;ph.style.left=(STATE.ui.blockProgress*100)+'%'}
    else{ph.classList.remove('active');ph.style.transition='none';ph.style.left='0%'}
  });
  const beatPos=STATE.ui.blockProgress*block.bars*sigBeats();
  STATE.song.channels.forEach(ch=>{
    if(ch.type!=='rhythm')return;
    const cont=document.querySelector(`.chord-slots[data-block="${block.id}"][data-ch="${ch.id}"]`);
    if(!cont)return;
    const chords=getChords(block,ch.id);if(!chords.length)return;
    let acc=0,active=chords.length-1;
    for(let i=0;i<chords.length;i++){acc+=chords[i].beats;if(beatPos<acc){active=i;break}}
    cont.querySelectorAll('.chord-slot').forEach((s,k)=>s.classList.toggle('chord-active',k===active));
  });
}
function scrollToCurrentBlock(){if(!STATE.ui.autoScroll)return;const block=STATE.song.blocks[STATE.ui.currentBlockIndex];if(!block)return;if(STATE.ui.view==='timeline'){const bd=$('#tlBody');if(bd){const off=STATE.ui.currentBlockIndex*TL_BW,vw=bd.clientWidth-136;if(off<bd.scrollLeft||off>bd.scrollLeft+vw-TL_BW)bd.scrollTo({left:Math.max(0,off-vw/3),behavior:'smooth'})}return}const el=document.querySelector(`[data-block-id="${block.id}"]`);if(el)el.scrollIntoView({behavior:'smooth',block:'center'})}
function adjustBpm(d){STATE.song.bpm=clamp(STATE.song.bpm+d,20,300);$('#bpmInput').value=STATE.song.bpm;if(STATE.ui.isPlaying)restartMetronome();renderEditor()}
function toggleAutoScroll(){STATE.ui.autoScroll=!STATE.ui.autoScroll;$('#autoScroll').classList.toggle('on',STATE.ui.autoScroll)}

/* ── Modal ── */
function openChannelModal(){$('#newChName').value='';$('#newChType').value='lyrics';$('#channelModal').classList.add('show');setTimeout(()=>$('#newChName').focus(),50)}
function closeChannelModal(){$('#channelModal').classList.remove('show')}
function confirmAddChannel(){const t=$('#newChType').value;let n=$('#newChName').value.trim();if(!n)n=CH_TYPE_INFO[t].label;const id=addChannel(n,t);STATE.ui.activeChannelId=id;STATE.ui.view='channel';$$('.view-tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='channel'));closeChannelModal();renderAll();flash('Channel added')}

/* ── Export / Import ── */
function exportJSON(){const p={format:'muss-v1',exported_at:new Date().toISOString(),song:STATE.song};const bl=new Blob([JSON.stringify(p,null,2)],{type:'application/json'});const u=URL.createObjectURL(bl),a=document.createElement('a');a.href=u;a.download=((STATE.song.title||'untitled').replace(/[^a-z0-9]+/gi,'_').toLowerCase())+'.muss.json';a.click();URL.revokeObjectURL(u);flash('Exported')}
function importJSON(){$('#importFile').click()}
function handleImport(e){const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>{try{const d=JSON.parse(ev.target.result);if(!d.song)throw new Error('Invalid file');STATE.song=d.song;STATE.song.channels=STATE.song.channels||[];STATE.song.blocks=STATE.song.blocks||[];STATE.song.progressions=STATE.song.progressions||[];if(!STATE.song.library)STATE.song.library={riffs:[]};if(!STATE.song.library.riffs)STATE.song.library.riffs=[];STATE.ui.activeChannelId=STATE.song.channels[0]?.id||null;STATE.ui.currentBlockIndex=0;renderAll();renderBeatLeds();flash('Imported')}catch(err){alert('Error: '+err.message)}};r.readAsText(f);e.target.value=''}

/* ── Bindings ── */
function bindAll(){
  $('#songTitle').addEventListener('input',e=>STATE.song.title=e.target.value);
  $('#songArtist').addEventListener('input',e=>STATE.song.artist=e.target.value);
  $('#songLink').addEventListener('input',e=>STATE.song.link=e.target.value);
  $('#bpmInput').addEventListener('input',e=>{STATE.song.bpm=clamp(parseInt(e.target.value)||120,20,300);if(STATE.ui.isPlaying)restartMetronome();renderEditor()});
  $$('#sigPick button').forEach(b=>b.addEventListener('click',()=>{STATE.song.signature=b.dataset.sig;renderTopBar();renderBeatLeds();renderEditor()}));
  $$('#countInPick button').forEach(b=>b.addEventListener('click',()=>{STATE.ui.countIn=parseInt(b.dataset.ci);$$('#countInPick button').forEach(x=>x.classList.toggle('active',x.dataset.ci===b.dataset.ci))}));
  $('#playBtn').addEventListener('click',togglePlay);
  $('#stopBtn').addEventListener('click',stopPlayback);
  $('#rewindBtn').addEventListener('click',()=>{STATE.ui.currentBlockIndex=0;STATE.ui.currentBeat=0;STATE.ui.blockProgress=0;renderEditor();scrollToCurrentBlock()});
  document.querySelectorAll('.dial-stepper button').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.action==='bpm-up')adjustBpm(1);if(b.dataset.action==='bpm-down')adjustBpm(-1)}));
  $('#autoScroll').addEventListener('click',toggleAutoScroll);
  document.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.isContentEditable)return;if(e.code==='Space'){e.preventDefault();togglePlay()}});
  $$('.view-tab').forEach(t=>t.addEventListener('click',()=>{$$('.view-tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');STATE.ui.view=t.dataset.view;renderEditor()}));
  // Sidebar delegation
  document.querySelector('.add-ch-btn').addEventListener('click',openChannelModal);
  $('#channelsList').addEventListener('click',e=>{const item=e.target.closest('.channel-item');if(!item)return;const id=item.dataset.channelId;if(e.target.closest('[data-action="mute"]')){toggleMute(id);return}if(e.target.closest('[data-action="delete"]')){const ch=STATE.song.channels.find(c=>c.id===id);if(ch&&confirm('Delete "'+ch.name+'"?'))deleteChannel(id);return}STATE.ui.activeChannelId=id;STATE.ui.view='channel';STATE.ui.rhythmTab='blocks';STATE.ui.tabTab='blocks';$$('.view-tab').forEach(t=>t.classList.toggle('active',t.dataset.view==='channel'));renderAll()});
  // Editor head "add block"
  $('#editorHead').addEventListener('click',e=>{if(e.target.closest('[data-action="add-block"]')){addBlock('VERSE',4);renderEditor()}});
  // Top actions
  document.querySelector('.top-actions').addEventListener('click',e=>{const btn=e.target.closest('[data-action]');if(!btn)return;if(btn.dataset.action==='import')importJSON();if(btn.dataset.action==='export')exportJSON()});
  $('#importFile').addEventListener('change',handleImport);
  // Modal
  const mask=$('#channelModal');
  mask.addEventListener('click',e=>{if(e.target===mask)closeChannelModal();const a=e.target.closest('[data-action]')?.dataset.action;if(a==='close-channel-modal')closeChannelModal();if(a==='confirm-channel')confirmAddChannel()});
  // Refit tab fonts when the window resizes so they always fill the slot
  let rT;window.addEventListener('resize',()=>{clearTimeout(rT);rT=setTimeout(()=>{$$('.tabgrid').forEach(g=>fitTabFont(g.id))},120)});
}

/* ── Init ── */
function init(){
  // One-time workbench bindings (handlers attach to elements that always exist).
  bindAll();
  renderBeatLeds();

  // Library boot: load saved songs, seed on first run, wire the dashboard.
  libLoad();
  if(!LIB.records.length){ librarySeed(); libSave(); }
  libBind();
  $('#wbBack').addEventListener('click', libBack);
  libRender();
  showScreen('library');   // always start on the dashboard
}
/* ═══════════════════════════════════════════════════════════
   RESUMEN — flat-card dashboard of the song
   Aggregates everything we know so far: structure, channels,
   chords, notes, patterns, riffs, lyrics, key estimate.
   ═══════════════════════════════════════════════════════════ */
function renderSummary(){
  const s=STATE.song;

  // ── Header ──
  $('#editorHead').innerHTML=`<div class="editor-title"><span class="editor-title-tag">Resumen</span>
    <span style="font-family:'Fraunces',serif;font-size:18px;font-style:italic;color:var(--ink-dim)">${escapeHTML(s.title||'Sin título')}</span></div>`;

  // ── Aggregates ──
  const totalBars=s.blocks.reduce((a,b)=>a+(b.bars||0),0);
  const totalBeats=totalBars*sigBeats();
  const durSec=totalBeats*60/(s.bpm||120);
  const dur=`${Math.floor(durSec/60)}:${String(Math.floor(durSec%60)).padStart(2,'0')}`;

  // Section counts + ordered structure timeline
  const secCount={};
  s.blocks.forEach(b=>{if(b.section)secCount[b.section]=(secCount[b.section]||0)+1});

  // Channels grouped by type
  const chByType={};
  s.channels.forEach(ch=>{(chByType[ch.type]=chByType[ch.type]||[]).push(ch)});

  // Chord frequency (from rhythm channels + chordpro)
  const chordCount={};
  const rhythms=s.channels.filter(c=>c.type==='rhythm');
  s.blocks.forEach(b=>{
    rhythms.forEach(rh=>{
      const cs=getChords(b,rh.id);
      cs.forEach(c=>{const n=(c.name||'').trim();if(n)chordCount[n]=(chordCount[n]||0)+1});
    });
    if(b.chordpro){
      const re=/\[([^\]]+)\]/g;let m;
      while((m=re.exec(b.chordpro))){const n=m[1].trim();if(n&&!chordCount[n])chordCount[n]=0}
    }
  });
  const chordsList=Object.entries(chordCount).sort((a,b)=>b[1]-a[1]);

  // Root notes (chromatic circle)
  const notesUsed=new Set();
  chordsList.forEach(([n])=>{const m=n.match(/^([A-G])([#b])?/);if(m){let nt=m[1]+(m[2]||'');if(m[2]==='b'){const map={Db:'C#',Eb:'D#',Gb:'F#',Ab:'G#',Bb:'A#'};nt=map[nt]||nt}notesUsed.add(nt)}});

  // Key estimate: most common chord root (with minor suffix)
  let keyEstimate='—';
  if(chordsList.length){
    const top=chordsList[0][0];
    const m=top.match(/^([A-G][#b]?)(m(?!aj))?/);
    if(m)keyEstimate=m[1]+(m[2]?' menor':' mayor');
  }

  // Lyrics aggregated
  const lyCh=s.channels.find(c=>c.type==='lyrics');
  const lyricsText=lyCh?s.blocks.map(b=>(b.content[lyCh.id]?.text||'').trim()).filter(Boolean).join('\n\n'):'';
  const lyricsLines=lyricsText.split('\n').filter(l=>l.trim()).length;
  const lyricsWords=lyricsText.split(/\s+/).filter(Boolean).length;

  // Library
  const patternsCount=(s.progressions||[]).length;
  const riffsCount=(s.library?.riffs||[]).length;

  // Per-channel pattern usage (rhythm → progressions applied)
  const chPatterns={};
  rhythms.forEach(rh=>{
    const applied=new Set();
    s.blocks.forEach(b=>{const ap=b.content[rh.id]?.appliedPatterns||[];ap.forEach(id=>applied.add(id))});
    chPatterns[rh.id]=applied.size;
  });

  // ── Render ──
  const cv=$('#canvas');cv.className='canvas summary-canvas';cv.style.cssText='';
  const CHROMATIC=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  cv.innerHTML=`
    <!-- Header / dashboard stats -->
    <div class="sm-card sm-header">
      <div class="sm-h-title">
        <div class="sm-h-name">${escapeHTML(s.title||'Sin título')}</div>
        <div class="sm-h-artist">${escapeHTML(s.artist||'Sin artista')}</div>
      </div>
      <div class="sm-h-meta">
        <div class="sm-stat"><div class="sm-stat-v">${s.bpm||'—'}</div><div class="sm-stat-l">BPM</div></div>
        <div class="sm-stat"><div class="sm-stat-v">${s.signature||'—'}</div><div class="sm-stat-l">Compás</div></div>
        <div class="sm-stat"><div class="sm-stat-v">${dur}</div><div class="sm-stat-l">Duración</div></div>
        <div class="sm-stat"><div class="sm-stat-v">${totalBars}</div><div class="sm-stat-l">Bars</div></div>
        <div class="sm-stat"><div class="sm-stat-v">${keyEstimate}</div><div class="sm-stat-l">Tonalidad</div></div>
        <div class="sm-stat"><div class="sm-stat-v">${s.blocks.length}</div><div class="sm-stat-l">Bloques</div></div>
      </div>
    </div>

    <!-- 2-column grid: lyrics (left) + analysis cards (right) -->
    <div class="sm-grid">
      <div class="sm-card sm-lyrics">
        <div class="sm-card-head"><span class="sm-card-title">Letra completa</span>
          <span class="sm-card-sub">${lyricsLines} líneas · ${lyricsWords} palabras</span></div>
        <div class="sm-card-body">
          <pre class="sm-lyrics-text">${lyricsText?escapeHTML(lyricsText):'<em style="color:var(--ink-faint)">Sin letra cargada</em>'}</pre>
        </div>
      </div>

      <div class="sm-col-right">

        <!-- Structure timeline -->
        <div class="sm-card">
          <div class="sm-card-head"><span class="sm-card-title">Estructura</span>
            <span class="sm-card-sub">${s.blocks.length} bloques · ${totalBars} bars</span></div>
          <div class="sm-card-body">
            <div class="sm-struct">${s.blocks.map((b,i)=>{
              const col=SECTION_COLORS[b.section]||'#999';
              return `<div class="sm-struct-block" style="background:${col};flex-grow:${b.bars||1}" title="#${i+1} ${b.section||''} · ${b.bars}b">
                <span class="sm-struct-name">${escapeHTML(b.section||'—')}</span>
                <span class="sm-struct-bars">${b.bars}b</span></div>`;
            }).join('')}</div>
            <div class="sm-section-counts">${Object.entries(secCount).map(([sec,n])=>{
              const col=SECTION_COLORS[sec]||'#999';
              return `<span class="sm-pill" style="background:${col}22;color:${col};border-color:${col}55">${sec} <b>×${n}</b></span>`;
            }).join('')}</div>
          </div>
        </div>

        <!-- Chords used -->
        <div class="sm-card">
          <div class="sm-card-head"><span class="sm-card-title">Acordes</span>
            <span class="sm-card-sub">${chordsList.length} únicos · ${Object.values(chordCount).reduce((a,b)=>a+b,0)} totales</span></div>
          <div class="sm-card-body">
            ${chordsList.length?`<div class="sm-chords">${chordsList.map(([n,c])=>`<span class="sm-chord-pill">${escapeHTML(n)}${c>0?`<small>×${c}</small>`:''}</span>`).join('')}</div>`:`<div class="sm-empty">Sin acordes registrados</div>`}
          </div>
        </div>

        <!-- Note circle -->
        <div class="sm-card">
          <div class="sm-card-head"><span class="sm-card-title">Círculo de notas</span>
            <span class="sm-card-sub">${notesUsed.size}/12 notas</span></div>
          <div class="sm-card-body">
            <div class="sm-notes-circle">${CHROMATIC.map(n=>`<span class="sm-note${notesUsed.has(n)?' on':''}">${n}</span>`).join('')}</div>
          </div>
        </div>

        <!-- Channels -->
        <div class="sm-card">
          <div class="sm-card-head"><span class="sm-card-title">Canales</span>
            <span class="sm-card-sub">${s.channels.length} total</span></div>
          <div class="sm-card-body">
            ${s.channels.length?`<div class="sm-channels">${s.channels.map(ch=>{
              const info=CH_TYPE_INFO[ch.type]||{letter:'?',label:ch.type};
              const extra=ch.type==='rhythm'?` · ${chPatterns[ch.id]||0} patrones`:
                          (ch.type==='lead'||ch.type==='bass')?` · ${riffsCount} riffs`:'';
              return `<div class="sm-channel">
                <div class="sm-ch-icon" style="background:${ch.color}">${info.letter}</div>
                <div class="sm-ch-info">
                  <div class="sm-ch-name">${escapeHTML(ch.name)}</div>
                  <div class="sm-ch-type">${info.label}${extra}</div>
                </div>
              </div>`;
            }).join('')}</div>`:`<div class="sm-empty">Sin canales</div>`}
          </div>
        </div>

        <!-- Library / stats -->
        <div class="sm-card">
          <div class="sm-card-head"><span class="sm-card-title">Biblioteca</span></div>
          <div class="sm-card-body">
            <div class="sm-lib-row"><span class="sm-lib-label">Patrones de acordes</span><span class="sm-lib-val">${patternsCount}</span></div>
            <div class="sm-lib-row"><span class="sm-lib-label">Riffs guardados</span><span class="sm-lib-val">${riffsCount}</span></div>
            <div class="sm-lib-row"><span class="sm-lib-label">Beats totales</span><span class="sm-lib-val">${totalBeats}</span></div>
            ${s.link?`<div class="sm-lib-row"><span class="sm-lib-label">Referencia</span><a class="sm-lib-link" href="${escapeHTML(s.link)}" target="_blank" rel="noopener">Abrir ↗</a></div>`:''}
          </div>
        </div>

      </div>
    </div>
  `;
}