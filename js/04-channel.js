function renderContent(ch,block){const data=block.content[ch.id]||defaultContent(ch.type);switch(ch.type){
case'lyrics':return`<textarea class="lyric-area" placeholder="Write lyrics here…" oninput="setText('${ch.id}','${block.id}',this.value)">${escapeHTML(data.text||'')}</textarea>`;
case'rhythm':return renderChordEditor(ch,block,data);
case'lead':case'bass':{const cid=`tab_${ch.id}_${block.id}`;const tt=tabType(ch);const ns=tt==='bass'?4:6;return`<div class="tab-toolbar"><button class="tab-tool-btn" onclick="saveRiff('${ch.id}','${block.id}','${tt}')" title="Save this tab as a reusable riff">★ Save as riff</button><span class="tab-strings-badge">${ns} strings · ${block.bars} bar${block.bars>1?'s':''} · ${tabColsPerBar()} steps/bar</span></div>${renderTabEditor(ch.id,block.id,tt,cid)}<div class="tab-hint">Click a cell, type fret numbers · ← → move · | marks each bar · Paste auto-fits to ${ns} strings</div>`}
case'drums':return renderDrumGrid(ch,block,data);
default:return`<textarea class="notes-area" placeholder="Notes…" oninput="setText('${ch.id}','${block.id}',this.value)">${escapeHTML(data.text||'')}</textarea>`}}

/* Chord editor: chords laid out across the block's bars, each chord
   sized proportionally to its beat-length. Bar dividers shown. Plus a
   pattern bar to save the current progression as a reusable alias and
   to apply saved patterns. */
/* Beat ruler: ticks dividing the block's total beats equally, bar marks numbered. */
function chordRulerHTML(block){
  const bpb=sigBeats();const totalBeats=block.bars*bpb;
  // Flex row of equal-width bars (like Ableton). Each bar shows its number + beat subticks.
  let bars='';
  for(let b=0;b<block.bars;b++){
    let beats='';
    for(let k=0;k<bpb;k++) beats+=`<div class="cr-beat${k===0?' first':''}"></div>`;
    bars+=`<div class="cr-bar"><span class="cr-num">${b+1}</span><div class="cr-beats">${beats}</div></div>`;
  }
  return `<div class="chord-ruler" title="${block.bars} compases · ${totalBeats} beats">${bars}</div>`;
}

function renderChordEditor(ch,block,data){
  ensureProgs();
  const ref={type:'block',ci:ch.id,bi:block.id};
  const chords=getChords(block,ch.id);
  const totalBeats=block.bars*sigBeats();
  const usedBeats=chords.reduce((s,c)=>s+c.beats,0);

  // Pattern bar (save / apply reusable progressions)
  const applied=(data.appliedPatterns||[]).filter(id=>STATE.song.progressions.find(p=>p.id===id));
  const available=STATE.song.progressions.filter(p=>!applied.includes(p.id));
  let patternBar=`<div class="chord-patterns"><button class="cp-save" onclick="saveProgression('${ch.id}','${block.id}')" title="Save these chords as a reusable pattern">★ Save as pattern</button><button class="cp-catalog" onclick="ccOpenPicker('${block.id}','${ch.id}')" title="Pick from chord catalog">📖 Catálogo</button>`;
  if(applied.length){applied.forEach(pid=>{const p=STATE.song.progressions.find(x=>x.id===pid);if(!p)return;patternBar+=`<span class="cp-chip"><span class="cp-chip-name" onclick="applyProgression('${ch.id}','${block.id}','${pid}')" title="Re-apply">${escapeHTML(p.name)}</span><span class="cp-chip-edit" onclick="renameProgression('${pid}')" title="Rename pattern">✎</span><span class="cp-chip-del" onclick="removePatternFromBlock('${ch.id}','${block.id}','${pid}')" title="Remove from block">×</span></span>`})}
  if(applied.length<2&&available.length){patternBar+=`<select class="cp-select" onchange="if(this.value){applyProgression('${ch.id}','${block.id}',this.value);this.value=''}"><option value="">+ Apply pattern…</option>`;available.forEach(p=>{const preview=p.chords.map(normalizeChord).map(c=>c.name).join(' ');patternBar+=`<option value="${p.id}" title="${escapeHTML(preview)}">${escapeHTML(p.name)}</option>`});patternBar+=`</select>`}
  else if(applied.length>=2){patternBar+=`<span class="cp-label" style="color:var(--ink-faint);font-size:9px">max 2 patterns</span>`}
  patternBar+=`</div>`;

  const lyCount=blockLyricLineCount(block);


  const stack=renderChordLineStack(ref,chords,totalBeats);
  // Beat ruler (divides block time equally) + playhead cursor over the chord row.
  const cur=STATE.ui.isPlaying&&STATE.song.blocks[STATE.ui.currentBlockIndex]&&STATE.song.blocks[STATE.ui.currentBlockIndex].id===block.id;
  const phLeft=cur?(STATE.ui.blockProgress*100):0;
  const chordArea=`<div class="chord-area">${chordRulerHTML(block)}${stack}<div class="chord-playhead${cur?' active':''}" data-block="${block.id}" style="left:${phLeft}%"></div></div>`;
  const fillClass=usedBeats===totalBeats?'ok':(usedBeats>totalBeats?'over':'under');
  const fill=`<div class="chord-fill ${fillClass}" data-fill="${ch.id}|${block.id}">${usedBeats} / ${totalBeats} beats filled${usedBeats>totalBeats?' (over!)':usedBeats<totalBeats?' ('+(totalBeats-usedBeats)+' free)':''}</div>`;
  return patternBar+chordArea+fill+`<textarea class="notes-area" placeholder="Strumming pattern, dynamics, notes…" oninput="setText('${ch.id}','${block.id}',this.value,'notes')">${escapeHTML(data.notes||'')}</textarea>`;
}

function renderDrumGrid(ch,block,data){const rows=['HH','SN','KK','TM','CY'],bpb=sigBeats(),sub=4,total=block.bars*bpb*sub,p=data.pattern||(data.pattern={});let h='<div class="drum-grid">';rows.forEach(r=>{if(!p[r])p[r]=new Array(total).fill(false);while(p[r].length<total)p[r].push(false);h+=`<div class="drum-row"><div class="drum-label">${r}</div><div class="drum-cells" style="grid-template-columns:repeat(${total},1fr)">`;for(let i=0;i<total;i++)h+=`<div class="drum-cell${p[r][i]?' active':''}${i%sub===0?' beat-marker':''}" data-row="${r}" data-i="${i}" data-ch="${ch.id}" data-block="${block.id}"></div>`;h+='</div></div>'});return h+'</div>'}

/* ── Render: Channel view ── */
function renderChannelView(){
  const ch=STATE.song.channels.find(c=>c.id===STATE.ui.activeChannelId);
  if(!ch)return;
  const info=CH_TYPE_INFO[ch.type];
  $('#editorHead').innerHTML=`<div class="editor-title" style="--ch-color:${ch.color}"><span class="editor-title-tag">${info.label}</span><input type="text" value="${escapeHTML(ch.name)}" onchange="renameChannel('${ch.id}',this.value)"></div><button class="add-block-btn" data-action="add-block">+ Add Block</button>`;
  const cv=$('#canvas');cv.className='canvas';cv.style.cssText='';
  // Rhythm channels: route to catalog sub-views
  if(ch.type==='rhythm'){
    if(!STATE.ui.rhythmTab) STATE.ui.rhythmTab='blocks';
    if(STATE.ui.rhythmTab==='patterns') return renderPatternCatalog(ch,cv);
    if(STATE.ui.rhythmTab==='chords') return renderChordCatalog(ch,cv);
  }
  // Lead/bass channels: route to riff catalog
  if(ch.type==='lead'||ch.type==='bass'){
    if(!STATE.ui.tabTab) STATE.ui.tabTab='blocks';
    if(STATE.ui.tabTab==='riffs') return renderRiffCatalog(ch,cv);
  }
  if(!STATE.song.blocks.length){cv.innerHTML='<div class="empty-state"><h4>No blocks yet</h4><p>Click + Add Block to start.</p></div>';return}
  cv.innerHTML='';
  // Lyrics master panel when this is lyrics channel
  if(ch.type==='lyrics'){
    const mp=document.createElement('div');mp.className='lyrics-master';
    mp.innerHTML=`<div class="lm-head"><div class="lm-title">Full Lyrics Paste</div><div class="lm-hint">Separate sections with a blank line. Each section maps to a block.</div></div><textarea id="lyricsMaster" class="lm-textarea" placeholder="Paste your full lyrics here…"></textarea><div class="lm-actions"><div class="lm-stats" id="lmStats">0 sections</div><button class="lm-btn" onclick="distributeLyrics('${ch.id}','append')">→ Add as new blocks</button><button class="lm-btn primary" onclick="distributeLyrics('${ch.id}','replace')">↻ Distribute to blocks</button></div>`;
    cv.appendChild(mp);
    const ta=mp.querySelector('#lyricsMaster');
    ta.value=STATE.song.blocks.map(b=>(b.content[ch.id]?.text||'').trim()).filter(Boolean).join('\n\n');
    updateLyricsStats(ta.value);ta.addEventListener('input',()=>updateLyricsStats(ta.value));
  }
  // Rhythm channel: sub-tab bar (Blocks | Patterns | Chords)
  if(ch.type==='rhythm'){const t=document.createElement('div');t.innerHTML=rhythmTabsHTML(ch);cv.appendChild(t.firstElementChild)}
  // Lead/bass channel: sub-tab bar (Blocks | Riff Library)
  if(ch.type==='lead'||ch.type==='bass'){const t=document.createElement('div');t.innerHTML=tabChannelTabsHTML(ch);cv.appendChild(t.firstElementChild)}
  cv.appendChild(makeInsertZone(0));
  STATE.song.blocks.forEach((block,idx)=>{
    const cur=STATE.ui.isPlaying&&idx===STATE.ui.currentBlockIndex;
    const d=document.createElement('div');
    d.className='block'+(block.enabled?'':' disabled')+(cur?' current':'');
    d.style.setProperty('--ch-color',ch.color);d.dataset.blockId=block.id;d.draggable=true;
    d.innerHTML=`<div class="block-handle">
    <div class="block-num">${String(idx+1).padStart(2,'0')}</div>
    <div class="block-bars">${block.bars}b</div>
    </div>
    <div class="block-body">
    <div class="block-meta">${renderSectionTag(block)}
    <span style="font-size:9px;color:var(--ink-faint)">Bars</span>
    <input class="bars-input" type="number" min="1" max="32" value="${block.bars}" onchange="setBars('${block.id}',this.value)">
    <span style="font-size:9px;color:var(--ink-faint);margin-left:auto">${block.bars*sigBeats()} beats</span>
    </div>
    <div class="block-content">${renderContent(ch,block)}
    </div></div><div class="block-actions"><button class="${block.enabled?'toggle-on':''}" onclick="toggleBlockEnabled('${block.id}')" title="Toggle">${block.enabled?'●':'○'}</button><button onclick="duplicateBlock('${block.id}')" title="Duplicate">⧉</button><button class="del" onclick="if(confirm('Delete?'))deleteBlock('${block.id}')" title="Delete">×</button></div>`;
    cv.appendChild(d);cv.appendChild(makeInsertZone(idx+1));
  });
  bindDragAndDrop();bindDrumCells(ch);
  if(ch.type==='rhythm') requestAnimationFrame(()=>{STATE.song.blocks.forEach(bl=>bindChordDrag(ch.id,bl.id));bindChordDnDAll();});
  if(ch.type==='lead'||ch.type==='bass'){
    requestAnimationFrame(()=>{
      $$('.tabgrid').forEach(g=>{bindTabEditor(g.id);fitTabFont(g.id)});
    });
  }
}

/* ── Render: Overview ── */
function getLyricsChannel(){
  let ch=STATE.song.channels.find(c=>c.type==='lyrics');
  if(!ch){const id=addChannel('Vocals','lyrics');ch=STATE.song.channels.find(c=>c.id===id)}
  return ch;
}

/* Dynamic, fused Overview: each block is an editable lyric line/section.
   - Blank line (double Enter) inside a block splits it into two blocks.
   - Backspace at the very start of an empty/short block merges into the previous one.
   - Pasting multi-section text auto-splits into blocks.
   Detail (chords, tabs, drums) lives in each channel's own view. */
/* ── Render: Overview (columnar — one column per channel) ──
   Each block is a row; every visible channel gets its own column
   so lyrics, chords, tabs and drums line up side by side.
   Repeated channel content (identical chords/tabs, or a saved
   pattern) is collapsed into a "repeat" badge instead of redrawing,
   while still respecting each block's bar/beat length.            */
/* ── Render: Overview (columnar, chords ABOVE lyrics) ──────
   Layout: each block is a row. The Vocals column shows the chord
   progression as a time-proportional lane ABOVE the lyric lines
   (lead-sheet style), so chords sit over the letra and span the
   same horizontal width as the paragraph. Rhythm channels are
   therefore merged into the lyrics column instead of taking their
   own column. Other instruments (lead/bass tab, drums…) keep a
   column each. Repeated chords/tabs collapse into a ↻ badge.   */
/* ── Render: Overview (per-line chords + merge/separate) ───
   Two modes (toggle in the toolbar):
   • FUSIONADO  → chords sit ABOVE each lyric line, positioned by the
                  beat where they fall (each line read as a time-bar).
   • SEPARADO   → rhythm (chords) and lyrics get their own columns.
   Chords/tabs repeated across blocks collapse into a ↻ badge.      */