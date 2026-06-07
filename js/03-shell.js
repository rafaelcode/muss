function renderAll(){renderTopBar();renderChannelsList();renderEditor();initSidebarResizer()}
function renderTopBar(){if($('#songTitle').value!==STATE.song.title)$('#songTitle').value=STATE.song.title;if($('#songArtist').value!==STATE.song.artist)$('#songArtist').value=STATE.song.artist;if($('#songLink').value!==STATE.song.link)$('#songLink').value=STATE.song.link;const _g=STATE.song.genre||'';if($('#songGenre')&&$('#songGenre').value!==_g)$('#songGenre').value=_g;if(parseInt($('#bpmInput').value)!==STATE.song.bpm)$('#bpmInput').value=STATE.song.bpm;$$('#sigPick button').forEach(b=>b.classList.toggle('active',b.dataset.sig===STATE.song.signature))}

/* ── Render: Channels list ── */
function renderChannelsList(){const l=$('#channelsList');l.innerHTML='';STATE.song.channels.forEach(ch=>{const info=CH_TYPE_INFO[ch.type]||CH_TYPE_INFO.notes;const d=document.createElement('div');d.className='channel-item'+(ch.id===STATE.ui.activeChannelId?' active':'');d.style.setProperty('--ch-color',ch.color);d.dataset.channelId=ch.id;d.innerHTML=`<div class="channel-icon">${info.letter}</div><div class="channel-meta"><div class="channel-name">${escapeHTML(ch.name)}</div><div class="channel-type">${info.label}</div></div><button class="channel-mute ${ch.muted?'muted':''}" data-action="mute">${ch.muted?'M':'·'}</button><button class="channel-del" data-action="delete">×</button>`;l.appendChild(d)})}

/* ── Render: Editor dispatch ── */
function renderEditor(){
  if(STATE.ui.view==='channel')return renderChannelView();
  if(STATE.ui.view==='timeline')return renderTimeline();
  if(STATE.ui.view==='reading')return renderReading();
  if(STATE.ui.view==='summary')return renderSummary();
  return renderOverview()}

/* ── Render: Content by type ── */


/* ── Sidebar resizer (drag the divider between channels and editor) ── */
let _sidebarResizerBound=false;
function initSidebarResizer(){
  // restore persisted width on every call (cheap), bind once
  try{const w=parseInt(localStorage.getItem('muss_sidebar_w'));if(w>=160&&w<=480)document.documentElement.style.setProperty('--sidebar-w',w+'px')}catch(_){}
  if(_sidebarResizerBound)return;
  const main=document.querySelector('.main');if(!main)return;
  const sidebar=main.querySelector('.sidebar');const editor=main.querySelector('.editor');
  if(!sidebar||!editor)return;
  // insert the resizer between sidebar and editor (only once)
  let rz=main.querySelector('.sidebar-resizer');
  if(!rz){rz=document.createElement('div');rz.className='sidebar-resizer';rz.title='Arrastrá para redimensionar';main.insertBefore(rz,editor)}
  rz.addEventListener('mousedown',md=>{
    md.preventDefault();
    rz.classList.add('dragging');
    document.body.style.cursor='col-resize';document.body.style.userSelect='none';
    function mv(e){
      const w=Math.max(160,Math.min(480,e.clientX));
      document.documentElement.style.setProperty('--sidebar-w',w+'px');
    }
    function up(){
      document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);
      rz.classList.remove('dragging');
      document.body.style.cursor='';document.body.style.userSelect='';
      const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w'));
      if(w)try{localStorage.setItem('muss_sidebar_w',String(w))}catch(_){}
    }
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
  _sidebarResizerBound=true;
}