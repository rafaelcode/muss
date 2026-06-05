/* ── State ── */
const STATE={song:{title:'',artist:'',link:'',bpm:120,signature:'4/4',blocks:[],channels:[],progressions:[],library:{riffs:[]}},ui:{activeChannelId:null,view:'overview',rhythmTab:'blocks',tabTab:'blocks',isPlaying:false,currentBlockIndex:0,currentBeat:0,autoScroll:true,metronomeTimer:null,countIn:1,isCountingIn:false,countInBeatsLeft:0,blockProgress:0}};
const CH_COLORS=['#4f6ef7','#2a9d8f','#e05c3a','#c46bb0','#7c69f5','#c08040','#4aab6d','#d4521e'];
const CH_TYPE_INFO={lyrics:{letter:'L',label:'Lyrics'},lead:{letter:'G',label:'Lead Gtr'},rhythm:{letter:'R',label:'Rhythm'},bass:{letter:'B',label:'Bass'},drums:{letter:'D',label:'Drums'},keys:{letter:'K',label:'Keys'},notes:{letter:'N',label:'Notes'}};
const SECTION_OPTIONS=['INTRO','VERSE','PRE-CHORUS','CHORUS','BRIDGE','SOLO','INSTRUMENTAL','BREAKDOWN','OUTRO'];
const SECTION_COLORS={INTRO:'#7c69f5',VERSE:'#2a9d8f','PRE-CHORUS':'#4fa8b8',CHORUS:'#e05c3a',BRIDGE:'#c46bb0',SOLO:'#d4521e',INSTRUMENTAL:'#4aab6d',BREAKDOWN:'#c08040',OUTRO:'#7c69f5'};
const uid=()=>'id_'+Math.random().toString(36).slice(2,9);
const $=s=>document.querySelector(s);
const $$=s=>document.querySelectorAll(s);