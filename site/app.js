'use strict';
const $=id=>document.getElementById(id);
const SOURCE_LABEL={tide:'Marine Institute · Seapoint beach tide model',wind:'ECMWF weather forecast',waves:'Marine wave forecast',seaTemp:'Sea surface temperature (forecast)',warnings:'Met Éireann warnings',alerts:'EPA bathing alerts',buoy:'M2 buoy (offshore)'};
const grades = {good:'Favourable', caution:'Caution', avoid:'Avoid', unknown:'Unknown'};
let minimumTide=window.SeapointCore.defaultMinimumTide;
try {
  const saved=localStorage.getItem('minimumTide');
  if (saved && Number.isFinite(Number(saved)) && Number(saved)>=0) minimumTide=Number(saved);
} catch {}
const speed=window.SeapointCore.formatWindSpeed;
const fmt=(iso)=>new Intl.DateTimeFormat('en-IE',{timeZone:'Europe/Dublin',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));
const fmtClock=(iso)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
function here(){const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`}}
const nextDate=(date,days)=>new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);
const dayLabel=date=>new Intl.DateTimeFormat('en-IE',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Dublin'}).format(new Date(date+'T12:00:00Z'));
let current={date:'',time:''},seq=0,loaded=null,snapshot=null;
let followBestTime = true;
let chooseDayFromForecast = false;
let lastRequestAt = 0;
let tableRequest=null, refreshRequest=null;
const dateTides=new Map();
function loadTables() {
  if (!tableRequest) tableRequest=fetch('./data/tide-tables.json',{cache:'no-cache'})
    .then(r=>{if (!r.ok) throw Error('Saved tide table unavailable');return r.json();})
    .catch(e=>{tableRequest=null;throw e;});
  return tableRequest;
}
async function tidesForSelection(s,date) {
  const core=window.SeapointCore, marine=window.SeapointForecast;
  const start=core.localToUtc(date,'00:00'), stop=core.localToUtc(nextDate(date,1),'00:00');
  const existing=s.events||[];
  if (existing.length && existing[0].t<=start && existing.at(-1).t>=stop &&
      core.highTidesForDay(existing,date).length) return s;
  let tide=dateTides.get(date);
  if (!tide) {
    let saved=[];
    try { saved=marine.savedEvents(await loadTables(), start-86400000, stop+86400000); } catch {}
    if (core.highTidesForDay(saved,date).length) {
      tide={value:{events:saved,points:[],fallback:true},meta:{...s.sources.tide,status:'published-copy'}};
    } else {
      tide=await marine.getTides(start-86400000,stop+86400000);
    }
    if (core.highTidesForDay(tide.value.events,date).length) dateTides.set(date,tide);
  }
  return {...s,events:tide.value.events,tidePoints:tide.value.points,
    sources:{...s.sources,tide:tide.meta}, notes:{...s.notes,tides:{...s.notes.tides,fallback:tide.value.fallback}}};
}
async function latestForecast() {
  const marine=window.SeapointForecast;
  let published;
  try {
    const response=await fetch('./data/conditions.json?cache_bust='+Math.floor(Date.now()/60000),
      {cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (response.ok) published=await response.json();
    if (!marine.compatible(published) || published?.notes?.tides?.stationID!==window.SeapointCore.SEAPOINT_STATION) published=null;
  } catch { /* The official feeds are the independent recovery path. */ }
  if (marine.isFresh(published) && marine.sourceFresh(published,'wind')) {
    if (!published.wind) {
      set('daily-reason','Checking the local wind forecast directly.');
      const wind=await marine.fetchWind();
      published.wind=wind.value;
      published.sources.wind=wind.meta;
    }
    return published;
  }
  set('daily-reason','Checking the latest readings directly with the forecast providers.');
  const live=await marine.buildSnapshot({loadTables,beachNotices:true});
  live.retrievedDirectly=true;
  return marine.retainPrevious(live,published||snapshot);
}
function choose(date, time, defaultDay = false) {
  chooseDayFromForecast = defaultDay;
  const local = here();
  const changedDate = current.date ? current.date !== date :
    !defaultDay && !$('daily-day').textContent.endsWith(dayLabel(date));
  followBestTime = !time;
  current = {date, time: time || (date === local.date ? local.time : '14:00')};
  const daylight=window.SeapointCore.sunTimesForDay(snapshot?.wind?.daily,date);
  if (changedDate) {
    renderDaily({status:'unknown',title:'Checking this date…',reason:'Looking up the high tides and forecast for this date.'},daylight);
    set('daily-highs','Checking…');
    renderFactors(null,null,null,'Checking…');
    set('window-main','Checking high tide…');
    set('window-sub','');
    loaded=null;
    $('water-selected').hidden=true;
    loading();
  } else renderSunTimes(daylight);
  if (changedDate) $('tide-figure').hidden=true;
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
function renderSunTimes(daylight) {
  set('sunrise', daylight.rise || 'Unavailable');
  set('sunset', daylight.set || 'Unavailable');
}
function renderDaily(outlook, daylight = window.SeapointCore.sunTimesForDay(null, current.date), highs = []) {
  const today = here().date;
  const when = current.date === today ? 'today' : current.date === nextDate(today, 1) ? 'tomorrow' : '· ' + dayLabel(current.date);
  $('daily').className = 'daily ' + outlook.status;
  renderHourlyWeather();
  set('daily-day','Swim recommendation '+when);
  const periods=outlook.periods||[];
  const good=periods.filter(p=>p.status==='good'),caution=periods.filter(p=>p.status==='caution');
  const range=p=>p.start===p.end?p.start:p.start+'–'+p.end;
  const main=document.getElementById('daily-period');
  main.replaceChildren();
  if(good.length){
    for(const p of good){
      const line=document.createElement('span');line.className='swim-range';line.textContent=range(p);main.append(line);
    }
  } else main.textContent=periods.length?'No favourable times':outlook.title;
  set('daily-grade',good.length?'Favourable':'');
  const note=$('daily-caution');note.hidden=!caution.length;
  note.textContent=caution.length?'Caution · '+caution.map(range).join(', '):'';
  set('daily-reason',outlook.reason);
  set('daily-rain-note',outlook.rainNote||'');
  $('daily-rain-note').hidden=!outlook.rainNote;
  $('window-why').hidden=!periods.length;
  const reasons=$('period-reasons');reasons.replaceChildren();
  for(const p of periods){
    const item=document.createElement('p');
    const heading=document.createElement('strong');heading.textContent=range(p)+' · '+grades[p.status];
    item.append(heading);
    const detail=p.status==='caution'?p.reason:p.startReason+' '+p.endReason;
    item.append(document.createElement('br'),document.createTextNode(detail));
    reasons.append(item);
  }
  renderSunTimes(daylight);
  set('daily-highs', highs.map(e => fmtClock(e.t)).join(' and ') || 'Unavailable');
}
function set(id,s){$(id).textContent=s}
function renderFactors(tide, waves, wind, missing = 'Unavailable') {
 set('tide-main', tide?.valid ? (tide.inside ? 'Meets your minimum' : 'Below your minimum') : missing);
 set('tide-value', tide?.valid ? tide.selectedLevel.toFixed(2)+' m · minimum '+tide.minimumTide+' m' : '');
 set('wave-main', waves?.short || missing);
 set('wave-value', Number.isFinite(waves?.heightM) ? waves.heightM.toFixed(2) + ' m' : '');
 set('wind-main', wind?.short || missing);
 const speeds = [];
 if (Number.isFinite(wind?.speedKn)) speeds.push(speed(wind.speedKn) + ' m/s');
 if (Number.isFinite(wind?.gustKn)) speeds.push('gusts ' + speed(wind.gustKn) + ' m/s');
 set('wind-value', speeds.join(', '));
}
function renderWater(data){
 const now=Date.now(), core=window.SeapointCore;
 const weather=data?.fresh?snapshot.wind:null, notices=data?.fresh?snapshot.alertsFeed:null;
 function reading(at, alerts, rain, label){
   const details=[];
   if(alerts.active.length)details.push('Official bathing notice: '+alerts.active.map(a=>a.title).join(' · ')+'. Follow the notice at the steps.');
   else if(!alerts.verified)details.push('Official notices could not be checked.');
   if(rain.status==='warning'){
     const future=rain.end>now;
     details.push((future?'Forecast rain':'Estimated local rain')+' of '+Number(rain.amount.toFixed(1))+' mm in '+(rain.hours===1?'one hour':rain.hours+' hours')+' ending '+fmt(rain.end)+'. Avoid swimming '+(future?'if this rain falls, ':'')+'until '+fmt(rain.until)+' (48 hours after the rain).');
     if(rain.projectedUntil)details.push('Further forecast rain could extend this to '+fmt(rain.projectedUntil)+'.');
   }else if(rain.status==='unknown')details.push('Rain data are incomplete. The 48-hour check is unavailable.');
   else details.push('No heavy rain flagged in the 48-hour check.');
   if(alerts.verified&&!alerts.active.length)details.push('No active Seapoint bathing notice in the checked feed.');
   const el=$(label);el.classList.toggle('flagged',rain.status==='warning'||alerts.active.length>0);
   const strong=document.createElement('strong');
   strong.textContent=(label==='water-now'?'Now':'Selected time')+' · '+fmt(at);
   el.replaceChildren(strong,document.createElement('br'),document.createTextNode(details.join(' ')));
 }
 const currentRisk=core.rainRiskAt(weather,now),currentAlerts=core.normaliseAlerts(notices,now);
 reading(now,currentAlerts,currentRisk,'water-now');
 const selected=$('water-selected');selected.hidden=true;
 if(data){
   const differs=data.rainRisk.status!==currentRisk.status||data.rainRisk.end!==currentRisk.end||data.rainRisk.projectedUntil!==currentRisk.projectedUntil||
     data.water.verified!==currentAlerts.verified||data.water.active.map(a=>a.title).join()!==currentAlerts.active.map(a=>a.title).join();
   if(differs){
     selected.hidden=false;
     if(data.rainRisk.status==='warning'&&data.rainRisk.end===currentRisk.end&&data.rainRisk.projectedUntil&&
        data.water.verified===currentAlerts.verified&&!data.water.active.length&&!currentAlerts.active.length){
       selected.classList.add('flagged');
       selected.textContent='For '+fmt(data.at)+', further forecast rain could extend the precaution to '+fmt(data.rainRisk.projectedUntil)+'.';
     }else reading(Date.parse(data.at),data.water,data.rainRisk,'water-selected');
   }
 }
}
function render(data){renderDaily(data.outlook, data.daylight, data.highs);loaded=data;const status=data.status||'unknown';$('answer').className='answer '+status;
 set('state', status === 'unknown' ? 'FORECAST UNCERTAIN' : grades[status].toUpperCase());
 set('weather-when',data.weatherAt?fmt(data.weatherAt)+' · hourly forecast':dayLabel(data.date)+' · '+data.time);
 $('weather-when').dateTime=data.weatherAt||data.at;
 set('chosen','At '+data.time+' · '+dayLabel(data.date));
 set('headline',data.headline);
 set('explain',data.explanation);
 const t=data.tide,w=data.waves,wind=data.wind;
 renderFactors(t, w, wind);
 renderTideChart(data);
 renderWater(data);
 const tideClock = at => {
   const local = window.SeapointCore.dublinParts(Math.round(at/60000)*60000);
   return local.date === data.date ? local.time : dayLabel(local.date) + ' ' + local.time;
 };
 function duration(ms) {
   const mins=Math.round(ms/60000);
   return Math.floor(mins/60)+' h '+(mins%60)+' min';
 }
 if(t?.valid){const high=tideClock(t.high.at);
   if(t.window){
     const {start,end}=t.window;
     set('window-main',start!=null && end!=null ? tideClock(start)+'–'+tideClock(end) : start!=null?'From '+tideClock(start):end!=null?'Until '+tideClock(end):'Above your minimum throughout the available tide forecast');
     const offsets=[];
     if(start!=null) offsets.push(duration(t.high.at-start)+' before');
     if(end!=null) offsets.push(duration(end-t.high.at)+' after');
     set('window-sub','High tide at '+high+'. '+(offsets.length?'At '+minimumTide+' m, you have '+offsets.join(' and ')+' high tide.':''));
   } else {
     set('window-main','Below your '+minimumTide+' m minimum');
     set('window-sub','High tide reaches about '+t.high.height.toFixed(2)+' m at '+high+'.');
   }
   set('high-detail',high+' · '+t.high.height.toFixed(2)+' m ('+t.datum+')');
   set('rise-detail',t.aboveLow==null?(t.range==null?'Not available':t.range.toFixed(2)+' m total rise (low → high)'):
     t.aboveLow.toFixed(2)+' m above adjacent low');
 } else{set('window-main','Tide data unavailable');set('window-sub','A reliable tide height is needed to plan the swim.');set('high-detail','—');set('rise-detail','—')}
 set('wave-detail',w?.heightM==null?'Not available':w.heightM.toFixed(2)+' m · '+w.short);
 set('wind-detail',wind?.speedKn==null?'Not available':speed(wind.speedKn)+' m/s'+(wind.gustKn!=null?' · gusts '+speed(wind.gustKn)+' m/s':''));
 const temp=data.temperature||{};
 const localWind=speed(wind?.speedKn),gust=speed(wind?.gustKn);
 set('local-speed',localWind==null?'—':localWind+' m/s');
 set('local-gust',gust==null?'Gust forecast unavailable':'Gusts '+gust+' m/s · 3 h max');
 const direction=wind?.direction;
 set('local-direction',Number.isFinite(direction)?'From '+['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(direction/22.5)%16]:'Direction unavailable');
 const condition=data.condition||window.SeapointWeather.condition(null);
 $('local-condition').innerHTML=window.SeapointWeather.icon(condition)+'<span>'+condition.label+'</span>';
 set('local-probability',Number.isFinite(data.probability)?data.probability+'% chance of rain¹':'Chance of rain unavailable');
 const rain=data.rain;
 set('local-rain',rain?.amount==null?'—':Number(rain.amount.toFixed(2))+' mm');
 set('rain-hour',rain?.amount==null?'Rain forecast unavailable':rain.start+'–'+rain.end+' · hourly rain');

 const degrees=v=>typeof v==='number'&&Number.isFinite(v)?Math.round(v)+'°C':'—';
 set('sea-temp',degrees(temp.waterC));set('air-temp',degrees(temp.airC));set('feels-temp',degrees(temp.feelsC));
 set('feels-label',(temp.feelsLabel||'Feels like').toUpperCase());
 set('sea-temp-source',temp.seaKind==='offshore observation'?'Offshore buoy (not Seapoint)':temp.seaKind==='forecast'?'Nearby sea forecast':'Not available');
 set('feels-source',Number.isFinite(temp.feelsC)?'Apparent temperature':'Unavailable');
 set('temperature-note',temp.note||'Temperature estimates unavailable. Check local conditions.');
 const tempBox=$('temperature-brief');tempBox.className='temperature-brief '+(temp.coldWater?'cold-water':'');
 set('sea-detail',temp.waterC==null?'Not available':Number(temp.waterC).toFixed(1)+'°C · '+(temp.waterSource||'Forecast'));
 set('chill-detail',temp.airC==null?'Not available':Number(temp.airC).toFixed(1)+'°C air'+(temp.feelsC!=null?' · '+Number(temp.feelsC).toFixed(1)+'°C '+(temp.feelsLabel||'feels like').toLowerCase():''));
 const bits=[];
 if(data.fresh) {
   for (const warning of data.warnings.active) bits.push((window.SeapointCore.isSmallCraft(warning)?'Wider coastal waters · ':'Met Éireann · ') + warning.headline + '.');
 }
 $('warning-guide').hidden = !data.fresh || !data.warnings.active.some(window.SeapointCore.isSmallCraft);
 if(data.water?.active?.length)bits.push('EPA bathing alert at Seapoint. Follow the official notice.');
 if(data.warnings&&!data.warnings.verified)bits.push('Marine warnings could not be verified.');
 if(data.water&&!data.water.verified)bits.push('Bathing alerts could not be verified.');
 if(!bits.length)bits.push('Check for ferry wash and read any bathing notices at the steps.');
 set('notice',bits.join(' '));
 const target=$('hours');target.replaceChildren();
 for(const slot of data.slots||[]){const b=document.createElement('button');b.type='button';b.className='hour '+slot.status+(slot.time===data.time?' selected':'');
  b.setAttribute('aria-label','Check '+slot.time+', '+grades[slot.status]);b.innerHTML='<span class="hour-clock"></span><span class="hour-grade"></span>';
  b.querySelector('.hour-grade').textContent=grades[slot.status];
  b.querySelector('.hour-clock').textContent=slot.time;b.onclick=()=>choose(current.date,slot.time);target.append(b);}
 set('hour-day','Tap an hour to check');
 const active=target.querySelector('.hour.selected');if(active)target.scrollLeft=Math.max(0,active.offsetLeft-target.offsetLeft-target.clientWidth/2+active.clientWidth/2);
 const sources=$('sources');sources.replaceChildren();
 for(const [id,meta] of Object.entries(data.sources||{})){
   const row=document.createElement('div');row.className='source-row';
   const a=document.createElement('a');a.href=meta.url||'#';a.target='_blank';a.rel='noopener';a.textContent=SOURCE_LABEL[id]||id;
   const label=document.createElement('small');const good=meta.status==='ok',warn=meta.status==='stale'||meta.status==='retained'||meta.status==='published-copy';label.className=good?'good':warn?'warn':'bad';label.textContent=({ok:'Connected',stale:'Stale',retained:'Saved · refresh failed',unavailable:'Unavailable','published-copy':'Saved beach predictions'})[meta.status]||meta.status;
   if(meta.error)label.title=meta.error;row.append(a,label);sources.append(row);
 }
 const weather=snapshot?.wind;
 const grid=weather?.gridDistanceKm;
 set('weather-provenance',weather?'Weather retrieved '+fmt(weather.retrievedAt)+'.'+(Number.isFinite(grid)?' Returned grid: '+weather.latitude.toFixed(5)+', '+weather.longitude.toFixed(5)+' (about '+grid.toFixed(1)+' km from the steps).':'')+' Model issue time unavailable.':'ECMWF weather unavailable.');
 if(data.buoy?.fresh && Number.isFinite(data.buoy.waveM)){const row=document.createElement('div');row.className='source-row';row.innerHTML='<span>Offshore buoy measurement</span><small class="good"></small>';row.lastChild.textContent=data.buoy.waveM.toFixed(1)+' m · '+fmt(data.buoy.at);sources.append(row)}
 set('weather-age',snapshot?.wind?'Weather retrieved '+fmt(snapshot.wind.retrievedAt)+(snapshot.sources?.wind?.status==='retained'?' · refresh failed; showing saved data.':'.'):'Weather unavailable.');
 set('stamp',data.checkedAt?(data.direct?'Sources checked directly ':'Forecast checked ')+fmt(data.checkedAt)+' (Dublin time). Forecasts are models, not Seapoint steps measurements.':'Awaiting first scheduled GitHub Actions update.');
}
function loading(){if(!loaded){set('headline','Checking conditions…');set('explain','Looking up tides, waves and wind.');$('answer').className='answer unknown';set('state','CHECKING');set('chosen',dayLabel(current.date)+' · '+current.time)}}
function fromSnapshot(s){
 const c=window.SeapointCore;
 const base={date:current.date,time:current.time,minimumTide,
   points:s.tidePoints||[],events:s.events||[],wind:s.wind||null,waves:s.waves||null,
   seaTemp:s.seaTemp||null,buoyTemp:s.buoyTemp||null,warningFeed:s.warningFeed||null,
   alertsFeed:s.alertsFeed||null,now:Date.now(),sources:{tides:{fallback:!!s.notes?.tides?.fallback}}};
 const forecast=window.SeapointForecast;
 const fresh = forecast.isFresh(s,base.now) && forecast.sourceFresh(s,'wind',base.now);
 for(const [id,key] of Object.entries({wind:'wind',waves:'waves',seaTemp:'seaTemp',buoy:'buoyTemp',warnings:'warningFeed',alerts:'alertsFeed'}))
   if(!forecast.sourceFresh(s,id,base.now))base[key]=null;
 if (!fresh) Object.assign(base,{wind:null,waves:null,seaTemp:null,buoyTemp:null,warningFeed:null,alertsFeed:null});
 const beyond = current.date>nextDate(here().date,7);
 let outlook;
 if (beyond) {
   outlook={status:'unknown',title:'Tides and daylight only',
     reason:'The wind and wave forecast will be available closer to this date.',hours:[]};
 } else if (!fresh) {
   outlook={status:'unknown',title:'Weather update unavailable',
     reason:'A current wind forecast and warnings are needed to pick a swim window.',hours:[]};
 } else outlook=c.dailyOutlook(base);
 if (followBestTime && outlook.pick) {
   current.time = base.time = outlook.pick;
   $('time').value = current.time;
 }
 const output=c.assess(base);
 const end=Math.ceil(c.localToUtc(base.date,base.time)/3600000)*3600000;
 const hour=c.dublinParts(end),rainHour=c.atInstant(base.wind,end,0);
 const rainAmount=window.SeapointWeather.rainAmount(rainHour);
 if(rainAmount!==null)output.rain={amount:rainAmount,start:c.fmtTime(end-3600000),end:hour.time};
 output.probability=window.SeapointWeather.probability(rainHour);
 const at=c.localToUtc(base.date,base.time),weatherHour=c.atInstant(base.wind,at);
 output.weatherAt=Number.isFinite(weatherHour?._at)?new Date(weatherHour._at).toISOString():null;
 output.condition=window.SeapointWeather.condition(weatherHour?.weather_code,window.SeapointWeather.nightAt(base.wind,weatherHour?._at??at));
 const midnight=c.localToUtc(base.date,'00:00'),nextMidnight=c.localToUtc(nextDate(base.date,1),'00:00');
 output.minimum=minimumTide;
 output.curve=c.tideCurve(base.points,base.events,midnight,nextMidnight);
 output.direct=!!s.retrievedDirectly;
 output.highs=c.highTidesForDay(base.events, current.date);
 output.outlook=outlook;
 output.fresh=fresh;
 output.slots=outlook.hours;
 output.sources=s.sources||{};
 output.buoy=s.buoyTemp||null;
 output.checkedAt=s.generatedAt||null;
 if (!fresh || beyond) {
   output.status='unknown';
   output.headline=outlook.title;
   output.explanation=outlook.reason;
 }
 return output;
}
async function load(force=false){
 const n=++seq;
 try {
   if (!snapshot || force || !window.SeapointForecast.isFresh(snapshot) || !window.SeapointForecast.sourceFresh(snapshot,'wind')) {
     lastRequestAt=Date.now();
     loading();
     if (!refreshRequest) refreshRequest=latestForecast().finally(()=>{refreshRequest=null;});
     const value=await refreshRequest;
     if (n!==seq) return;
     snapshot=value;
   }
   if (chooseDayFromForecast) {
     choose(window.SeapointCore.defaultSwimDate(snapshot.wind,Date.now()));
     return;
   }
   const selected=await tidesForSelection(snapshot,current.date);
   if (n===seq) render(fromSnapshot(selected));
 } catch(e){if(n!==seq)return;
  // Keep the last successful snapshot in memory for a later retry.
  renderWater(null);
  $('tide-figure').hidden=true;
  set('weather-when',dayLabel(current.date)+' · '+current.time);
  renderDaily({status:'unknown',title:'Forecast unavailable',reason:'A current forecast is needed to pick a swim window.'});
  loaded=null;$('answer').className='answer unknown';set('state','NOT UPDATED');set('chosen',dayLabel(current.date)+' · '+current.time);
  set('headline','Cannot check yet');set('explain','No current published forecast is available. No conditions have been invented.');
  set('notice','The latest forecast could not be loaded. Check the official marine warnings and local bathing notices.');
  $('warning-guide').hidden = true;
  renderFactors(null, null, null);
  set('window-main','Tide data unavailable');set('window-sub','A successful scheduled refresh is required.');set('high-detail','—');set('rise-detail','—');
  for(const id of ['sea-temp','air-temp','feels-temp','local-speed','local-gust','local-rain','rain-hour','local-condition','local-probability','local-direction'])set(id,'—');
  set('sea-temp-source','Unavailable');set('feels-source','Unavailable');set('temperature-note','No forecast data.');
  set('stamp','No published snapshot yet.');
  $('hours').innerHTML='<div class="hours-placeholder">No current hourly outlook</div>';
 }}
const tideField=$('minimum-tide');
tideField.value=minimumTide;
function applyTide(value) {
  minimumTide=value;
  tideField.value=value;
  try {localStorage.setItem('minimumTide',String(value));} catch {}
  set('tide-feedback','Using '+value+' m.');
  load();
}
$('tide-form').onsubmit=event=>{event.preventDefault();if(tideField.validity.valid)applyTide(tideField.valueAsNumber);};
$('reset-tide').onclick=()=>applyTide(window.SeapointCore.defaultMinimumTide);
$('today').onclick=()=>choose(here().date);
$('tomorrow').onclick=()=>choose(nextDate(here().date,1));
$('other').onclick=()=>{$('date').showPicker?.();$('date').focus()};
$('date').onchange=()=>choose($('date').value||here().date);
$('time').onchange=()=>choose(current.date||here().date,$('time').value||'14:00');
$('refresh').onclick=()=>load(true);
const p=new URLSearchParams(location.search),local=here(),validDate=/^20\d{2}-\d{2}-\d{2}$/.test(p.get('date')||''),validTime=/^([01]\d|2[0-3]):[0-5]\d$/.test(p.get('time')||'');
const date = validDate ? p.get('date') : validTime ? local.date : window.SeapointCore.defaultSwimDate(null, Date.now());
choose(date, validTime ? p.get('time') : undefined, !validDate && !validTime);

// Keep the remaining window and snapshot age accurate when a tab stays open.
function updateVisibleForecast() {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastRequestAt >= 15 * 60000) load(true);
  else if (snapshot && !refreshRequest) load();
}
document.addEventListener('visibilitychange', updateVisibleForecast);
setInterval(updateVisibleForecast, 60000);

const main = document.querySelector('main');
let lastScrollY = window.scrollY;
document.addEventListener('scroll', () => {
  const scrollingDown = window.scrollY > lastScrollY;
  lastScrollY = window.scrollY;
  if (!scrollingDown) return;

  const passed = Array.from(main.querySelectorAll('details[open]')).filter(section => {
    const bounds = section.getBoundingClientRect();
    return bounds.height > 0 && bounds.bottom <= 0;
  });
  if (!passed.length) return;

  // Keep the content below the closed sections in the same place on screen.
  const bottomBefore = main.getBoundingClientRect().bottom;
  for (const section of passed) {
    if (section.contains(document.activeElement)) {
      section.querySelector('summary').focus({preventScroll:true});
    }
    section.open = false;
  }
  const shift = main.getBoundingClientRect().bottom - bottomBefore;
  if (shift) window.scrollBy(0, shift);
  lastScrollY = window.scrollY;
}, {passive:true});


