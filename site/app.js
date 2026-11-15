'use strict';
const $=id=>document.getElementById(id);
const SOURCE_LABEL={tide:'Marine Institute tides',wind:'Wind forecast',waves:'Marine wave forecast',seaTemp:'Sea surface temperature (forecast)',warnings:'Met Éireann warnings',alerts:'EPA bathing alerts',buoy:'M2 buoy (offshore)'};
const states={good:['LIKELY GOOD','✓'],caution:['MIXED CONDITIONS','!'],avoid:['NOT RECOMMENDED','×'],unknown:['NOT ENOUGH DATA','?']};
const fmt=(iso)=>new Intl.DateTimeFormat('en-IE',{timeZone:'Europe/Dublin',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const fmtClock=(iso)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
function here(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}}
const nextDate=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const dayLabel=date=>new Intl.DateTimeFormat('en-IE',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Dublin'}).format(new Date(date+'T12:00:00Z'));
let current={date:'',time:''},seq=0,ctl=null,loaded=null,snapshot=null;
let followBestTime = true;
let lastRequestAt = 0;
function choose(date, time) {
  const local = here();
  followBestTime = !time;
  current = {date, time: time || (date === local.date ? local.time : '14:00')};
  $('date').value = date;
  $('time').value = current.time;
  for (const [id, selected] of Object.entries({
    today: date === local.date, tomorrow: date === nextDate(local.date, 1),
    other: date !== local.date && date !== nextDate(local.date, 1)
  })) {
    $(id).classList.toggle('selected', selected);
    $(id).setAttribute('aria-pressed', String(selected));
  }
  const url = new URL(location.href);
  url.searchParams.set('date', date);
  if (time) url.searchParams.set('time', time);
  else url.searchParams.delete('time');
  history.replaceState(null, '', url);
  load();
}
function renderDaily(outlook) {
  const today = here().date;
  const when = current.date === today ? 'today' : current.date === nextDate(today, 1) ? 'tomorrow' : '· ' + dayLabel(current.date);
  $('daily').className = 'daily ' + outlook.status;
  set('daily-day', 'Best swim window ' + when);
  set('daily-grade', outlook.start ? (outlook.status === 'good' ? 'Favourable' : 'Mixed conditions') : '');
  set('daily-period', outlook.start ? outlook.start + '–' + outlook.end : outlook.title);
  set('daily-reason', outlook.reason);
}
function showStatus(id,s){const el=$(id);el.className='factor-icon '+s;el.textContent=s==='good'?'✓':s==='caution'?'!':s==='avoid'?'×':'?';}
function set(id,s){$(id).textContent=s}
function render(data){renderDaily(data.outlook);loaded=data;const status=data.status||'unknown';$('answer').className='answer '+status;
 set('state',states[status][0]);set('chosen','At '+data.time+' · '+dayLabel(data.date));set('headline',data.headline);set('explain',data.explanation);
 const t=data.tide,w=data.waves,wind=data.wind;
 set('tide-main',t?.valid?(t.inside?'In window':'Outside window'):'Unavailable');showStatus('tide-symbol',t?.valid?(t.inside?'good':'avoid'):'unknown');
 set('wave-main',w?.heightM==null?'Unavailable':w.heightM.toFixed(2)+' m');showStatus('wave-symbol',w?.status||'unknown');
 set('wind-main',wind?.speedKn==null?'Unavailable':wind.speedKn.toFixed(0)+' kn');showStatus('wind-symbol',wind?.status||'unknown');
 if(t?.valid){const start=fmtClock(t.window.start),end=fmtClock(t.window.end),high=fmtClock(t.high.at);
   set('window-main',start+'–'+end+' · High '+high);
   set('window-sub','High water '+t.high.height.toFixed(2)+' m ('+t.datum+'); your ±'+t.window.hours.toFixed(1)+' h guideline');
   set('high-detail',high+' · '+t.high.height.toFixed(2)+' m ('+t.datum+')');
   set('rise-detail',t.aboveLow==null?(t.range==null?'Not available':t.range.toFixed(2)+' m total rise (low → high)'):
     t.aboveLow.toFixed(2)+' m above adjacent low');
 } else{set('window-main','Tide data unavailable');set('window-sub','A reliable tide height is needed to plan the swim.');set('high-detail','—');set('rise-detail','—')}
 set('wave-detail',w?.heightM==null?'Not available':w.heightM.toFixed(2)+' m · '+w.short);
 set('wind-detail',wind?.speedKn==null?'Not available':wind.speedKn.toFixed(0)+' kn'+(wind.gustKn!=null?' · gust '+wind.gustKn.toFixed(0):''));
 const temp=data.temperature||{};
 const degrees=v=>typeof v==='number'&&Number.isFinite(v)?Math.round(v)+'°C':'—';
 set('sea-temp',degrees(temp.waterC));set('air-temp',degrees(temp.airC));set('feels-temp',degrees(temp.feelsC));
 set('feels-label',(temp.feelsLabel||'Feels like').toUpperCase());
 set('sea-temp-source',temp.seaKind==='offshore observation'?'Offshore buoy (not Seapoint)':temp.seaKind==='forecast'?'Nearby sea forecast':'Not available');
 set('feels-source',temp.windChillC!=null?'Wind chill index':'Apparent temperature');
 set('temperature-note',temp.note||'Temperature estimates unavailable. Check local conditions.');
 const tempBox=$('temperature-brief');tempBox.className='temperature-brief '+(temp.coldWater?'cold-water':'');
 set('sea-detail',temp.waterC==null?'Not available':Number(temp.waterC).toFixed(1)+'°C · '+(temp.waterSource||'Forecast'));
 set('chill-detail',temp.airC==null?'Not available':Number(temp.airC).toFixed(1)+'°C air'+(temp.feelsC!=null?' · '+Number(temp.feelsC).toFixed(1)+'°C '+(temp.feelsLabel||'feels like').toLowerCase():''));
 const bits=[];
 if(data.warnings?.active?.length)bits.push('Met Éireann: '+data.warnings.active[0].headline);
 if(data.water?.active?.length)bits.push('EPA bathing alert at Seapoint. Follow the official notice.');
 if(data.warnings&&!data.warnings.verified)bits.push('Marine warnings could not be verified.');
 if(data.water&&!data.water.verified)bits.push('Bathing alerts could not be verified.');
 if(!bits.length)bits.push('This is a forecast. Check the entry steps, ferry wash and local notices before swimming.');
 set('notice',bits.join(' '));
 const target=$('hours');target.replaceChildren();
 for(const slot of data.slots||[]){const b=document.createElement('button');b.type='button';b.className='hour '+slot.status+(slot.time===data.time?' selected':'');
  b.setAttribute('aria-label','Check '+slot.time+': '+slot.status);b.innerHTML='<span class="hour-clock"></span><i class="hour-dot" aria-hidden="true"></i>';
  b.querySelector('.hour-clock').textContent=slot.time;b.onclick=()=>choose(current.date,slot.time);target.append(b);}
 set('hour-day','Tap an hour to check');
 const active=target.querySelector('.hour.selected');if(active)target.scrollLeft=Math.max(0,active.offsetLeft-target.offsetLeft-target.clientWidth/2+active.clientWidth/2);
 const sources=$('sources');sources.replaceChildren();
 for(const [id,meta] of Object.entries(data.sources||{})){
   const row=document.createElement('div');row.className='source-row';
   const a=document.createElement('a');a.href=meta.url||'#';a.target='_blank';a.rel='noopener';a.textContent=SOURCE_LABEL[id]||id;
   const label=document.createElement('small');const good=meta.status==='ok',warn=meta.status==='stale'||meta.status==='published-copy';label.className=good?'good':warn?'warn':'bad';label.textContent=({ok:'Connected',stale:'Stale',unavailable:'Unavailable','published-copy':'Published table'})[meta.status]||meta.status;
   if(meta.error)label.title=meta.error;row.append(a,label);sources.append(row);
 }
 if(data.buoy?.fresh && Number.isFinite(data.buoy.waveM)){const row=document.createElement('div');row.className='source-row';row.innerHTML='<span>Offshore buoy measurement</span><small class="good"></small>';row.lastChild.textContent=data.buoy.waveM.toFixed(1)+' m · '+fmt(data.buoy.at);sources.append(row)}
 set('stamp',data.checkedAt?'Snapshot published '+fmt(data.checkedAt)+' (Dublin time). Forecasts are models, not Seapoint steps measurements.':'Awaiting first scheduled GitHub Actions update.');
}
function loading(){if(!loaded){set('headline','Checking conditions…');set('explain','Looking up tides, waves and wind.');$('answer').className='answer unknown';set('state','CHECKING');set('chosen',dayLabel(current.date)+' · '+current.time)}}
function fromSnapshot(s){
 const c=window.SeapointCore;
 const base={date:current.date,time:current.time,
   points:s.tidePoints||[],events:s.events||[],wind:s.wind||null,waves:s.waves||null,
   seaTemp:s.seaTemp||null,buoyTemp:s.buoyTemp||null,warningFeed:s.warningFeed||null,
   alertsFeed:s.alertsFeed||null,now:Date.now(),sources:{tides:{fallback:!!s.notes?.tides?.fallback}}};
 const elapsed = base.now - Date.parse(s.generatedAt || '');
 const maxAge = (s.validForMinutes || 90) * 60000;
 const fresh = Number.isFinite(elapsed) && elapsed <= maxAge && elapsed >= -20 * 60000;
 const outlook = fresh ? c.dailyOutlook(base) : {
   status:'unknown', title:'Forecast update overdue',
   reason:'A fresh forecast is needed to pick a swim window.', hours:[]
 };
 if (followBestTime && outlook.pick) {
   current.time = base.time = outlook.pick;
   $('time').value = current.time;
 }
 const output=c.assess(base);
 output.outlook=outlook;
 output.slots=outlook.hours;
 output.sources=s.sources||{};
 output.buoy=s.buoyTemp||null;
 output.checkedAt=s.generatedAt||null;
 if(!fresh){
   output.status='unknown';
   output.headline='Forecast update overdue';
   output.explanation='The last scheduled update is missing or too old. Do not rely on the previous reading.';
   output.caveats.push('Snapshot is stale: GitHub Actions may have been delayed, missed or disabled.');
 }
 return output;
}
async function load(force=false){
 if(snapshot&&!force){render(fromSnapshot(snapshot));return;}
 lastRequestAt = Date.now();
 if(ctl)ctl.abort();ctl=new AbortController();const n=++seq;loading();
 try{
  // Same-origin static JSON from GitHub Pages. No browser cross-origin API calls.
  const r=await fetch('./data/conditions.json?cache_bust='+Math.floor(Date.now()/60000),{signal:ctl.signal,cache:'no-store'});
  if(!r.ok)throw Error('Snapshot HTTP '+r.status);
  const value=await r.json();
  if(value.schemaVersion!==1)throw Error('Unsupported snapshot version');
  if(n!==seq)return;
  snapshot=value;
  render(fromSnapshot(value));
 }catch(e){if(n!==seq||e.name==='AbortError')return;
  snapshot=null;
  renderDaily({status:'unknown',title:'Forecast unavailable',reason:'A current forecast is needed to pick a swim window.'});
  loaded=null;$('answer').className='answer unknown';set('state','NOT UPDATED');set('chosen',dayLabel(current.date)+' · '+current.time);
  set('headline','Cannot check yet');set('explain','No current published forecast is available. No conditions have been invented.');
  set('notice','The scheduled GitHub Actions snapshot could not be loaded. '+e.message);
  set('window-main','Tide data unavailable');set('window-sub','A successful scheduled refresh is required.');
  for(const id of ['sea-temp','air-temp','feels-temp'])set(id,'—');
  set('sea-temp-source','Unavailable');set('feels-source','Unavailable');set('temperature-note','No forecast data.');
  set('stamp','No published snapshot yet.');
  $('hours').innerHTML='<div class="hours-placeholder">No current hourly outlook</div>';
 }}
$('today').onclick=()=>choose(here().date);
$('tomorrow').onclick=()=>choose(nextDate(here().date,1));
$('other').onclick=()=>{$('date').showPicker?.();$('date').focus()};
$('date').onchange=()=>choose($('date').value||here().date);
$('time').onchange=()=>choose(current.date||here().date,$('time').value||'14:00');
$('refresh').onclick=()=>load(true);
const p=new URLSearchParams(location.search),local=here(),validDate=/^20\d{2}-\d{2}-\d{2}$/.test(p.get('date')||''),validTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(p.get('time')||'');
const date=validDate?p.get('date'):(Number(local.time.slice(0,2))>=18?nextDate(local.date,1):local.date);
choose(date,validTime ? p.get('time') : undefined);

// Keep the remaining window and snapshot age accurate when a tab stays open.
function updateVisibleForecast() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastRequestAt >= 15 * 60000) load(true);
  else if (snapshot) render(fromSnapshot(snapshot));
}
document.addEventListener('visibilitychange', updateVisibleForecast);
setInterval(updateVisibleForecast, 60000);
