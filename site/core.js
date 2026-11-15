'use strict';
const DAY=86400000,HOUR=3600000,MIN=60000;
const TZ='Europe/Dublin';
const dublinFormatter = new Intl.DateTimeFormat('en-GB',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function dublinParts(t){
  const p=Object.fromEntries(dublinFormatter.formatToParts(new Date(t)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
function localToUtc(d,t){
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(d)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))return NaN;
  const guess=Date.parse(`${d}T${t}:00Z`),p=dublinParts(guess);
  const wall=Date.parse(`${p.date}T${p.time}:00Z`);
  let target=guess-(wall-guess);
  const q=dublinParts(target);
  if(`${q.date} ${q.time}`!==`${d} ${t}`){const r=dublinParts(target+HOUR);if(`${r.date} ${r.time}`===`${d} ${t}`)target+=HOUR;}
  return target;
}
const clockFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function fmtTime(t){return clockFormatter.format(t)}
function parseTideCsv(csv){
  const lines=csv.trim().split(/\r?\n/); if(lines.length<5) return [];
  const hdr=lines[0].split(',').map(x=>x.trim().replaceAll('"',''));
  const i=hdr.indexOf('time'),j=hdr.indexOf('Water_Level');if(i<0||j<0||!/metres?|meters?/i.test(lines[1]))return [];
  const pts=[];
  for(const line of lines.slice(2)){const p=line.split(','); const t=Date.parse(p[i]),v=Number(p[j]);if(p[j]?.trim() && Number.isFinite(t)&&Number.isFinite(v))pts.push({t,h:v});}
  return pts.sort((a,b)=>a.t-b.t);
}
function extrema(points){
  const events = [];
  // Rounded heights can stay flat even on a rising or falling tide.
  // Only a change of direction across the whole plateau is a turning point.
  for (let start = 0; start < points.length;) {
    let end = start;
    while (end + 1 < points.length && points[end+1].h === points[start].h &&
        points[end+1].t - points[end].t <= 30*MIN) end++;
    const before = points[start-1], after = points[end+1], h = points[start].h;
    if (before && after && points[start].t - before.t <= 30*MIN && after.t - points[end].t <= 30*MIN) {
      const high = before.h < h && after.h < h;
      const low = before.h > h && after.h > h;
      if (high || low) {
        const t = Math.round((points[start].t + points[end].t) / (2*MIN)) * MIN;
        events.push({t, h, type:high ? 'high' : 'low'});
      }
    }
    start = end + 1;
  }
  return events;
}
function highTidesForDay(events, date) {
  return events.filter(e => e.type === 'high' && dublinParts(e.t).date === date);
}
function interpolatedLevel(points,t){
  if(points.length<2||t<points[0].t||t>points[points.length-1].t)return null;
  let lo=0,hi=points.length-1;
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(points[mid].t<=t)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi];if(t===a.t)return a.h;if(t===b.t)return b.h;if(b.t-a.t>30*MIN)return null;return a.h+(b.h-a.h)*(t-a.t)/(b.t-a.t);
}
function fallbackEvents(table){return table.map(({date,time,height,type})=>({t:localToUtc(date,time),h:height,type})).filter(e=>Number.isFinite(e.t)).sort((a,b)=>a.t-b.t)};
function nearestHigh(events,t){const highs=events.filter(e=>e.type==='high');if(!highs.length)return null;
  const high=highs.reduce((x,y)=>Math.abs(y.t-t)<Math.abs(x.t-t)?y:x);
  if(Math.abs(high.t-t)>10*HOUR)return null;
  const span=Math.min(4,Math.max(2,3+(high.h-3.85)*1.0));
  return {...high,start:high.t-span*HOUR,end:high.t+span*HOUR,half:span};
}
function tideInfo(points,events,t){
  const high=nearestHigh(events,t);if(!high)return {valid:false,detail:'No tide prediction for this time'};
  const lows=events.filter(e=>e.type==='low');
  const before=[...lows].filter(e=>e.t<high.t).at(-1)||null;
  const after=lows.find(e=>e.t>high.t)||null;
  const low=t<=high.t?before:after;
  const level=points.length?interpolatedLevel(points,t):null;
  const modelLow = low?.source === 'port-table' ? low.modelLowHeight : low?.h;
  const aboveLow = level != null && Number.isFinite(modelLow) ? +(level - modelLow).toFixed(2) : null;
  const sameDatum = low && high.source === low.source;
  return {valid:true,high:{at:high.t,height:high.h},low:low?{at:low.t,height:low.h}:null,
    window:{start:high.start,end:high.end,hours:high.half},inside:t>=high.start&&t<=high.end,
    selectedLevel:level!=null?+level.toFixed(2):null,aboveLow,range:sameDatum?+(high.h-low.h).toFixed(2):null,
    datum:high.source === 'port-table' || !points.length ? 'Dublin Port chart datum' : 'LAT',heuristic:true};
}
const forecastTimes = new WeakMap();
function atHour(f,date,time,maxGap=40){
  const hourly=f?.hourly;if(!Array.isArray(hourly?.time))return null;
  const target=localToUtc(date,time);
  let times = forecastTimes.get(f);
  if (!times) {
    times = hourly.time.map(s => f.utcTime
      ? Date.parse(s.endsWith('Z') ? s : s + 'Z')
      : localToUtc(s.slice(0,10), s.slice(11,16)));
    forecastTimes.set(f, times);
  }
  let best=-1,bestDiff=Infinity;
  for(let i=0;i<times.length;i++){
    const u=times[i];
    const diff=Math.abs(u-target);if(diff<bestDiff){best=i;bestDiff=diff;}
  }
  if(best<0||bestDiff>maxGap*MIN)return null;
  const value={};for(const [k,arr] of Object.entries(hourly))if(k!=='time'&&Array.isArray(arr))value[k]=arr[best]??null;
  return value;
}
function windStatus(kn, gust, deg) {
  const onshore = Number.isFinite(deg) && (deg >= 315 || deg <= 105);
  if (Number.isFinite(gust) && gust >= 29) return {status:'avoid', short:'Strong gusts'};
  if (kn >= 22 || (onshore && kn >= 19)) return {status:'avoid', short:'Strong winds'};
  if (!Number.isFinite(kn) || !Number.isFinite(gust)) return {status:'unknown', short:'Incomplete wind forecast'};
  if (kn >= 16 || (onshore && kn >= 13) || gust >= 22) return {status:'caution', short:'Breezy'};
  return {status:'good', short:'Light to moderate'};
}
function waveStatus(h){if(!Number.isFinite(h))return {status:'unknown',short:'No forecast'};
  if(h>=1)return {status:'avoid',short:'Rough seas'};
  if(h>=0.6)return {status:'caution',short:'Noticeable waves'};
  return {status:'good',short:h<0.35?'Small waves':'Some chop possible'};
}
/** Standard NWS/US-Canada wind-chill index, valid at or below 10 °C and wind >4.8 km/h.
 * This estimates dry, exposed skin, not the much faster cooling of wet skin on exit. */
function windChillC(airC,windKn){
  if(!Number.isFinite(airC)||!Number.isFinite(windKn)||airC>10||windKn*1.852<=4.8)return null;
  const v=windKn*1.852;
  return 13.12+0.6215*airC-11.37*Math.pow(v,.16)+.3965*airC*Math.pow(v,.16);
}
function temperatureStatus(seaC, airC) {
  const coldWater = Number.isFinite(seaC) && seaC < 15;
  let note = 'The sea temperature is an estimate for nearby waters.';
  if (!Number.isFinite(seaC) && !Number.isFinite(airC)) note = 'Temperature forecasts are unavailable.';
  else if (!Number.isFinite(seaC)) note = 'Sea temperature is unavailable.';
  else if (coldWater) note = 'Cold-water shock is possible below 15°C.';
  return {status:'info', coldWater, note};
}
function activeWarnings(feed,t){if(!Array.isArray(feed))return null;
  return feed.filter(w=>{
    const r=w.regions||[];
    if(!r.includes('EI810')&&!r.includes('EI07'))return false;
    const from=Date.parse(w.onset||w.issued||''),to=Date.parse(w.expiry||'');
    return (!Number.isFinite(from)||t>=from)&&(!Number.isFinite(to)||t<=to);
  }).map(w=>({headline:w.headline||'Marine/weather warning',type:w.type||'',level:w.level||'Yellow'}));
}
const alertsAtSeapoint = new WeakMap();
function normaliseAlerts(json,t){
  const all=Array.isArray(json)?json:Array.isArray(json?.list)?json.list:Array.isArray(json?.data)?json.data:Array.isArray(json?.items)?json.items:null;
  if(!all)return {verified:false,active:[]};
  const complete=!(json?.count&&Number(json.count)>all.length);
  const beach='IEEABWC090_0000_0100';
  let localAlerts = alertsAtSeapoint.get(all);
  if (!localAlerts) {
    localAlerts = all.filter(x => JSON.stringify(x).toUpperCase().includes(beach));
    alertsAtSeapoint.set(all, localAlerts);
  }
  const active=localAlerts.filter(x=>{
    const start=x.start_date||x.from_date||x.startDate||x.start||x.date_from;
    const end=x.end_date||x.to_date||x.endDate||x.end||x.date_to;
    const begin=Date.parse(start),stop=Date.parse(end);
    return (!Number.isFinite(begin)||t>=begin)&&(!Number.isFinite(stop)||t<=stop+DAY-1);
  }).map(x=>({title:String(x.description||x.alert_type||x.reason||'EPA bathing alert')}));
  return {verified:complete,active};
}
function sunTimesForDay(daily, date) {
  const index = daily?.time?.indexOf(date) ?? -1;
  // The weather request already asks for local timestamps in Europe/Dublin.
  function clock(value) {
    if (typeof value !== 'string' || !value.startsWith(date + 'T')) return null;
    const time = value.slice(11, 16);
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null;
  }
  return {rise: clock(daily?.sunrise?.[index]), set: clock(daily?.sunset?.[index])};
}
function isDay(weather, date, time) {
  const sun = sunTimesForDay(weather?.daily, date);
  if (sun.rise && sun.set) {
    const selected = localToUtc(date, time);
    const start = localToUtc(date, sun.rise) + 15 * MIN;
    const end = localToUtc(date, sun.set) - 25 * MIN;
    return {...sun, ok: selected >= start && selected <= end};
  }
  const hour = atHour(weather, date, time);
  return {...sun, ok: Number.isFinite(hour?.is_day) ? Boolean(hour.is_day) : null};
}
function assess({date,time,points=[],events=[],wind=null,waves=null,seaTemp=null,buoyTemp=null,warningFeed=null,alertsFeed=null,sources={},now=Date.now()}){
  const selected=localToUtc(date,time);const tide=tideInfo(points,events,selected);
  const wh=atHour(wind,date,time),wv=atHour(waves,date,time);
  const wk=wh?.wind_speed_10m!=null?Number(wh.wind_speed_10m):null;
  const gust=wh?.wind_gusts_10m!=null?Number(wh.wind_gusts_10m):null;
  const wavesM=wv?.wave_height!=null?Number(wv.wave_height):null;
  const windGrade=windStatus(wk,gust,wh?.wind_direction_10m!=null?Number(wh.wind_direction_10m):null);
  const waveGrade=waveStatus(wavesM);
  const airC=wh?.temperature_2m!=null?Number(wh.temperature_2m):null;
  const seaRow=atHour(seaTemp,date,time);
  const modelSeaC=seaRow?.sea_surface_temperature!=null?Number(seaRow.sea_surface_temperature):null;
  // The M2 buoy is offshore. Only use its temperature as a clearly labelled
  // last resort for a near-now selected time; never imply it measures Seapoint.
  const selectedNearNow=Math.abs(selected-now)<=3*HOUR;
  const useBuoy= !Number.isFinite(modelSeaC)&&selectedNearNow&&buoyTemp?.fresh&&Number.isFinite(buoyTemp?.waterC);
  const waterC=Number.isFinite(modelSeaC)?modelSeaC:useBuoy?buoyTemp.waterC:null;
  const seaKind=Number.isFinite(modelSeaC)?'forecast':useBuoy?'offshore observation':'unavailable';
  const chill=windChillC(airC,wk);
  const apparentC=wh?.apparent_temperature!=null?Number(wh.apparent_temperature):null;
  const feelsC=chill!=null?chill:apparentC;
  const feelsLabel=chill!=null?'Wind chill':'Feels like';
  const thermal=temperatureStatus(waterC,airC);
  const light=isDay(wind,date,time);
  const warningList=activeWarnings(warningFeed,selected);
  const alerts=normaliseAlerts(alertsFeed,selected);
  const severeWarning=warningList?.find(w=>/orange|red|gale/i.test(w.level+' '+w.type));
  const warning=warningList?.[0]||null;
  let status='good',headline='Favourable conditions forecast',explanation='The tide is within the high-water window and the forecast wind and waves are below the planner’s caution levels.';
  const chosenPast=Number.isFinite(selected)&&selected<now-20*MIN;
  if(chosenPast){status='unknown';headline='Choose an upcoming time';explanation='This forecast is intended for future swims.';}
  else if(severeWarning||alerts.active.length){status='avoid';headline='Do not swim';explanation=severeWarning?.headline||'A bathing-water alert applies to Seapoint.';}
  else if(windGrade.status==='avoid'){
    status='avoid';headline=windGrade.short;
    explanation=windGrade.short==='Strong gusts' ? 'Gusts of '+Math.round(gust)+' kn are forecast.' : 'Sustained winds of '+Math.round(wk)+' kn are forecast.';
  }
  else if(waveGrade.status==='avoid'){status='avoid';headline='Rough seas';explanation='The wave forecast rules out this time.';}
  else if(!tide.valid){status='unknown';headline='No tide prediction';explanation='Cannot assess the swim window without tide information.';}
  else if(light.ok===false){status='avoid';headline='Not a good time';explanation='It is dark or too close to sunset.';}
  else if(!tide.inside){status='avoid';headline='Better closer to high tide';explanation='Outside your approximate high-tide swimming window.';}
  else if(windGrade.status==='unknown'||waveGrade.status==='unknown'||light.ok===null){status='unknown';headline='Not enough information';explanation='A daylight, wave or wind forecast is missing.';}
  else if(!alerts.verified||!warningList){status='unknown';headline='Warnings unverified';explanation='The weather warnings or bathing notices could not be verified.';}
  else if(warning||windGrade.status==='caution'||waveGrade.status==='caution'){status='caution';headline='Mixed conditions';explanation=warning?warning.headline:'Some chop is likely. Check the entry steps.';}
  const caveats=[];
  if(!warningList)caveats.push('Marine warnings could not be checked');
  if(!alerts.verified)caveats.push('Bathing alerts could not be checked');
  if(alerts.verified&&!alerts.active.length)caveats.push('No active bathing alerts found in checked feed');
  if(sources?.tides?.fallback)caveats.push('Using a dated published tide table');
  return {date,time,at:new Date(selected).toISOString(),status,headline,explanation,
    tide,waves:{heightM:wavesM,periodS:wv?.wave_period??null,...waveGrade},wind:{speedKn:wk,gustKn:gust,direction:wh?.wind_direction_10m??null,...windGrade},
    temperature:{waterC,airC,feelsC,feelsLabel,windChillC:chill,apparentC,seaKind,waterSource:seaKind==='forecast'?'Open-Meteo marine SST model':seaKind==='offshore observation'?'Marine Institute M2 offshore buoy':'Unavailable',...thermal},
    daylight:light,warnings:{verified:warningList!==null,active:warningList||[]},water:alerts,caveats};
}
function slots(input,date){return Array.from({length:20},(_,i)=>{const time=`${String(Math.floor((9*60+i*30)/60)).padStart(2,'0')}:${String((i*30)%60).padStart(2,'0')}`;const r=assess({...input,date,time});return {time,status:r.status}});}
function longestSwimWindow(samples, allowMixed) {
  let first = 0;
  let best = null;
  for (let i = 0; i <= samples.length; i++) {
    const sample = samples[i];
    if (sample && (sample.status === 'good' || (allowMixed && sample.status === 'caution'))) continue;
    const count = i - first;
    // Two adjacent forecast checks establish both ends of a period.
    if (count >= 2 && (!best || count > best.length)) best = samples.slice(first, i);
    first = i + 1;
  }
  return best;
}

function defaultSwimDate(wind, now) {
  const local = dublinParts(now);
  const sunset = sunTimesForDay(wind?.daily, local.date).set;
  if (!sunset) return local.date;
  const endOfWindow = localToUtc(local.date, sunset) - 25 * MIN;
  if (now < endOfWindow) return local.date;
  return new Date(Date.parse(local.date + 'T12:00:00Z') + DAY).toISOString().slice(0, 10);
}

function dailyOutlook(input) {
  const samples = [];
  const midnight = localToUtc(input.date, '00:00');
  const tomorrow = new Date(Date.parse(input.date + 'T12:00:00Z') + DAY).toISOString().slice(0, 10);
  const end = localToUtc(tomorrow, '00:00');
  for (let at = midnight; at < end; at += 15 * MIN) {
    const time = fmtTime(at);
    const reading = assess({...input, time});
    if (at < input.now) {
      reading.status = 'unknown';
    }
    samples.push(reading);
  }

  const upcoming = samples.filter(s => Date.parse(s.at) >= input.now);
  const daylight = upcoming.filter(s => s.daylight.ok !== false);
  const good = longestSwimWindow(upcoming, false);
  const period = good || longestSwimWindow(upcoming, true);
  // Include early and late daylight hours as well as the familiar daytime timeline.
  const hours = samples.filter(s => s.time.endsWith(':00') &&
    (s.daylight.ok === true || (s.time >= '09:00' && s.time <= '18:00')))
    .map(s => ({time:s.time, status:s.status}));

  if (period) {
    const pick = period[Math.floor((period.length - 1) / 2)];
    const warning = period.flatMap(s => s.warnings.active)[0];
    const mixed = period.find(s => s.status === 'caution');
    const reason = warning?.headline || mixed?.explanation ||
      'Favourable tide, wind and waves. High tide at ' + fmtTime(pick.tide.high.at) + '.';
    return {status:good ? 'good' : 'caution', start:period[0].time,
      end:period.at(-1).time, pick:pick.time, reason, warning, hours};
  }

  let status = 'avoid', title = 'No suitable swim window', reason;
  if (!upcoming.length || !daylight.length) {
    title = input.date <= dublinParts(input.now).date ? 'No daylight window left' : 'No daylight window';
    reason = 'Choose another day to see its forecast.';
  } else if (daylight.every(s => s.water.active.length)) {
    reason = 'A bathing-water alert applies to Seapoint.';
  } else if (daylight.some(s => s.status === 'unknown')) {
    status = 'unknown';
    title = 'Forecast incomplete';
    reason = 'There is too little verified information to pick a swim window.';
  } else {
    const inWindow = daylight.filter(s => s.tide.inside);
    const warning = inWindow.find(s => s.headline === 'Do not swim');
    if (warning) reason = warning.explanation;
    else if (daylight.every(s => s.wind.status === 'avoid') ||
        (inWindow.length && inWindow.every(s => s.wind.status === 'avoid'))) {
      title = 'Too windy for a dip';
      reason = (inWindow[0] || daylight[0]).explanation;
    }
    else if (!inWindow.length) reason = 'The daylight and high-tide windows do not overlap.';
    else if (inWindow.every(s => s.wind.status === 'avoid' || s.waves.status === 'avoid')) {
      reason = 'Rough conditions are forecast throughout the daylight tide window.';
    } else reason = 'No continuous 15-minute period meets the forecast criteria.';
  }
  return {status, title, reason, hours};
}

const SeapointCore={highTidesForDay,defaultSwimDate,dailyOutlook,dublinParts,localToUtc,fmtTime,parseTideCsv,extrema,interpolatedLevel,fallbackEvents,nearestHigh,tideInfo,atHour,windStatus,waveStatus,activeWarnings,normaliseAlerts,isDay,windChillC,temperatureStatus,assess,slots};
if(typeof module!=="undefined"&&module.exports)module.exports=SeapointCore;
if(typeof window!=="undefined")window.SeapointCore=SeapointCore;
