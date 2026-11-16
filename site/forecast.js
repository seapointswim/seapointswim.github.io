'use strict';
(function () {
const {SEAPOINT_STATION,parseTideCsv,extrema} = typeof module === 'object' ? require('./core') : window.SeapointCore;
const NOW = () => Date.now();
const HOUR = 3600000;
const PROVIDERS={
  tide: {name:'Marine Institute · Seapoint beach tide model',url:'https://erddap.marine.ie/erddap/info/imiTidePredictionEpa/index.html'},
  wind: {name:'Open-Meteo · local wind and air temperature forecast',url:'https://open-meteo.com/en/docs'},
  waves: {name:'Open-Meteo · nearby offshore wave forecast',url:'https://open-meteo.com/en/docs/marine-weather-api'},
  seaTemp: {name:'Open-Meteo · model sea-surface temperature',url:'https://open-meteo.com/en/docs/marine-weather-api'},
  buoy: {name:'Marine Institute · M2 offshore weather buoy',url:'https://www.marine.ie/site-area/data-services/real-time-observations/irish-weather-buoy-network'},
  warnings: {name:'Met Éireann · coastal warning feed',url:'https://www.met.ie/forecasts/marine-inland-lakes'},
  alerts: {name:'EPA · bathing water alerts feed',url:'https://www.beaches.ie/'},
};
function url(base, query){const u=new URL(base);for(const [k,v] of Object.entries(query))u.searchParams.set(k,String(v));return u.toString();}
function iso(ms){return new Date(ms).toISOString().replace('.000','');}
function validHourly(value, key){return !!(value && Array.isArray(value.hourly?.time) && value.hourly.time.length>=24 &&
  Array.isArray(value.hourly[key]) && value.hourly[key].some(x=>typeof x==='number' && Number.isFinite(x)));}
function srcMeta(id,status,extra={}){return {name:PROVIDERS[id].name,url:PROVIDERS[id].url,status,checked:new Date().toISOString(),...extra};}
function failure(e){return e?.name==='AbortError'?'Timeout':String(e?.message||e).slice(0,250);}
async function readRemote(urlText, type, fetchImpl, timeout=12000){
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),timeout);
  try{
    const r=await fetchImpl(urlText,{signal:abort.signal,cache:'no-store',headers:{Accept:({csv:'text/csv',json:'application/json'})[type]}});
    if(!r.ok)throw new Error(`HTTP ${r.status} from ${new URL(urlText).hostname}`);
    const data=type==='json'?await r.json():await r.text();
    if(data?.error)throw new Error(data.reason||'Provider returned error');
    return data;
  }finally{clearTimeout(timer)}
}
async function attempt(id, fn){
  const start=NOW();
  try{return {value:await fn(),meta:srcMeta(id,'ok',{ms:NOW()-start})}}
  catch(e){return {value:null,meta:srcMeta(id,'unavailable',{error:failure(e),ms:NOW()-start})}}
}
function parseBuoyCsv(csv,now){
  if(typeof csv!=='string')return null;
  const lines=csv.trim().split(/\r?\n/);if(lines.length<3)return null;
  const hdr=lines[0].split(',').map(x=>x.replaceAll('"','').trim());
  const idx=k=>hdr.indexOf(k);
  const [ti,wi,hi,si]=['time','WindSpeed','WaveHeight','SeaTemperature'].map(idx);
  if([ti,wi,hi,si].some(i=>i<0))throw new Error('Unexpected M2 buoy CSV columns');
  for(const line of lines.slice(2).reverse()){
    const a=line.split(','),t=Date.parse(a[ti]);
    if(!Number.isFinite(t))continue;
    const get=i=>{const v=a[i];return v!=null&&v.trim()!==''&&Number.isFinite(Number(v))?Number(v):null};
    const sea=get(si),wind=get(wi),wave=get(hi);
    if(sea===null&&wind===null&&wave===null)continue;
    return {at:new Date(t).toISOString(),waveM:wave,windKn:wind,waterC:sea,fresh:t<=now+5*60000&&now-t<=3*HOUR};
  }
  return null;
}
async function fetchAllAlerts(fetchImpl){
  const base='https://data.epa.ie/bw/api/v1/Alerts';const pp=500;
  const first=await readRemote(url(base,{per_page:pp,page:1}),'json',fetchImpl);
  const one=Array.isArray(first?.list)?first.list:null;if(!one)throw Error('Unexpected EPA alert structure');
  const count=Number(first.count)||one.length;let combined=[...one];
  // Fetch the remaining pages rather than misreporting a partial page as no alerts.
  for(let p=2;p<=Math.min(10,Math.ceil(count/pp));p++){
    const next=await readRemote(url(base,{per_page:pp,page:p}),'json',fetchImpl);
    if(!Array.isArray(next?.list))throw Error('EPA alert pagination returned unexpected format');
    combined.push(...next.list);
  }
  return {count,list:combined};
}
function mergeWaveForecast(primary, fallback){
  if(!validHourly(primary,'wave_height')&&!validHourly(fallback,'wave_height'))return null;
  if(!validHourly(primary,'wave_height'))return fallback;
  if(!validHourly(fallback,'wave_height'))return primary;
  const p=primary.hourly, f=fallback.hourly, pi=new Map(p.time.map((t,i)=>[t,i]));
  const keys=['wave_height','wave_period','wave_direction'];
  const vals={time:[...new Set([...p.time,...f.time])].sort()};
  for(const key of keys){vals[key]=vals.time.map(t=>{
    const i=pi.get(t);const primaryValue=i===undefined?null:p[key]?.[i];
    if(typeof primaryValue==='number'&&Number.isFinite(primaryValue))return primaryValue;
    const j=f.time.indexOf(t);return j<0?null:(f[key]?.[j]??null);
  });}
  return {...fallback,hourly:vals,gridInfo:'DWD EWAM sea grid where available, Open-Meteo best-match elsewhere'};
}


const BEACH = SEAPOINT_STATION.replace(/_MODELLED$/, '');
async function fetchBeachNotices(fetchImpl) {
  // This is the EPA's own beach-specific feed used by beaches.ie. It supports browser access.
  const endpoint = url('https://api.beaches.ie/odata/beaches', {
    $filter:"Code eq '" + BEACH + "'", $expand:'Incidents',
    $select:'Code,HasRestrictionInPlace,ClosedTypeName,RestrictionTypeName,Incidents'
  });
  const result = await readRemote(endpoint,'json',fetchImpl);
  const beach = result?.value?.[0];
  if (result?.value?.length !== 1 || beach?.Code !== BEACH ||
      typeof beach.HasRestrictionInPlace !== 'boolean' || !Array.isArray(beach.Incidents) ||
      typeof beach.ClosedTypeName !== 'string') throw Error('Incomplete EPA bathing notices');
  const list = beach.Incidents.map(i => ({beach_id:BEACH, start_date:i.StartDate,
    end_date:i.EndDate, description:i.RestrictionTypeName || i.IncidentDescription || 'Bathing notice'}));
  if (beach.HasRestrictionInPlace || beach.ClosedTypeName !== 'Open (N)') {
    list.push({beach_id:BEACH,description:beach.RestrictionTypeName || 'A bathing restriction is in place'});
  }
  return {count:list.length,list};
}
function tideUrl(first,last) {
  return 'https://erddap.marine.ie/erddap/tabledap/imiTidePredictionEpa.csv?time%2CstationID%2Csea_surface_height&' +
    ['stationID='+encodeURIComponent(JSON.stringify(SEAPOINT_STATION)),
      encodeURIComponent('time>='+iso(first)),encodeURIComponent('time<='+iso(last))].join('&');
}
function savedEvents(tables, first, last) {
  if (tables?.stationID !== SEAPOINT_STATION) return [];
  const events=[];
  for (let year=new Date(first).getUTCFullYear(); year<=new Date(last).getUTCFullYear(); year++) {
    for (const [utc,h,type] of tables.years?.[year] || []) {
      const t=Date.parse(utc);
      if (t>=first && t<=last && Number.isFinite(h) && (type==='high' || type==='low')) events.push({t,h,type});
    }
  }
  return events;
}
async function getTides(first,last,{fetchImpl=fetch,loadTables}={}) {
  const found = await attempt('tide', async () => {
    const points=parseTideCsv(await readRemote(tideUrl(first,last),'csv',fetchImpl));
    if (points.length<3) throw Error('No Seapoint predictions in this period');
    return points;
  });
  const points=found.value || [];
  const events=extrema(points);
  const gap=30*60000;
  const intervals=[];
  for (const point of points) {
    const span=intervals.at(-1);
    if (!span || point.t-span.end>gap) intervals.push({start:point.t,end:point.t});
    else span.end=point.t;
  }
  let fallback=false;
  if (loadTables && !(events.length && intervals.length===1 &&
      intervals[0].start<=first+10*60000 && intervals[0].end>=last-10*60000)) {
    try {
      const copy=savedEvents(await loadTables(),first,last);
      for (const event of copy) {
        if (intervals.some(span=>event.t>=span.start+gap && event.t<=span.end-gap)) continue;
        if (events.some(e=>e.type===event.type && Math.abs(e.t-event.t)<=gap)) continue;
        events.push(event);
        fallback=true;
      }
      events.sort((a,b)=>a.t-b.t);
    } catch { /* Keep any genuine readings from the live model. */ }
  }
  found.meta.status=fallback ? 'published-copy' : events.length ? 'ok' : 'unavailable';
  return {value:{points,events,fallback},meta:found.meta};
}
function isFresh(snapshot, now=Date.now()) {
  const age=now-Date.parse(snapshot?.generatedAt);
  return Number.isFinite(age) && age>=-20*60000 && age<=90*60000;
}
async function fetchWind(fetchImpl=fetch, retryConnection=false) {
  const windUrl=url('https://api.open-meteo.com/v1/forecast',{
    latitude:'53.29694',longitude:'-6.15862',hourly:'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,is_day',daily:'sunrise,sunset',wind_speed_unit:'kn',timezone:'Europe/Dublin',past_days:1,forecast_days:8
  });
  return attempt('wind',async()=>{
    let weather;
    try {
      weather=await readRemote(windUrl,'json',fetchImpl);
    } catch (error) {
      if (!retryConnection || !(error instanceof TypeError || error.name==='AbortError' ||
          /^HTTP 5/.test(error.message))) throw error;
      await new Promise(resolve=>setTimeout(resolve,750));
      weather=await readRemote(windUrl,'json',fetchImpl);
    }
    if (!validHourly(weather,'wind_speed_10m') || !validHourly(weather,'wind_gusts_10m') ||
        !validHourly(weather,'temperature_2m')) throw Error('Incomplete wind or air-temperature forecast');
    return weather;
  });
}
async function buildSnapshot({fetchImpl=fetch,now=Date.now(),loadTables,beachNotices=false}={}){
  const waveParams={latitude:'53.30',longitude:'-6.12',hourly:'wave_height,wave_period,wave_direction',timezone:'Europe/Dublin',cell_selection:'sea',past_days:1,forecast_days:8};
  const seaUrl=url('https://marine-api.open-meteo.com/v1/marine',{
    latitude:'53.30',longitude:'-6.12',hourly:'sea_surface_temperature',timezone:'Europe/Dublin',cell_selection:'sea',past_days:1,forecast_days:8
  });
  const buoyUrl='https://erddap.marine.ie/erddap/tabledap/IWBNetwork.csv?time%2CWindSpeed%2CWaveHeight%2CSeaTemperature&'+'station_id=%22M2%22&' + encodeURIComponent('time>=' + iso(now-12*HOUR));
  const promises={
    tide:getTides(now-2*24*HOUR,now+10*24*HOUR,{fetchImpl,loadTables}),
    wind:fetchWind(fetchImpl,true),
    waves:attempt('waves',async()=>{
      const [ewam,best]=await Promise.allSettled([
        readRemote(url('https://marine-api.open-meteo.com/v1/marine',{...waveParams,models:'dwd_ewam',forecast_days:3}),'json',fetchImpl),
        readRemote(url('https://marine-api.open-meteo.com/v1/marine',waveParams),'json',fetchImpl),
      ]);
      const d=mergeWaveForecast(ewam.status==='fulfilled'?ewam.value:null,best.status==='fulfilled'?best.value:null);
      if(!d)throw Error('No usable wave heights from either model');
      return d;
    }),
    seaTemp:attempt('seaTemp',async()=>{
      const d=await readRemote(seaUrl,'json',fetchImpl);
      if(!validHourly(d,'sea_surface_temperature'))throw Error('Sea temperature model returned no values');
      return d;
    }),
    buoy:attempt('buoy',async()=>{
      const csv=await readRemote(buoyUrl,'csv',fetchImpl);
      const b=parseBuoyCsv(csv,now);if(!b)throw Error('No usable M2 buoy readings');return b;
    }),
    warnings:attempt('warnings',async()=>{
      const d=await readRemote('https://www.met.ie/Open_Data/json/warning_ALL.json','json',fetchImpl);
      if(!Array.isArray(d))throw Error('Unexpected Met Éireann warning feed');return d;
    }),
    alerts:attempt('alerts',()=>beachNotices ? fetchBeachNotices(fetchImpl) : fetchAllAlerts(fetchImpl)),
  };
  const ids=Object.keys(promises);
  const values=await Promise.all(ids.map(id=>promises[id]));
  const found=Object.fromEntries(ids.map((id,i)=>[id,values[i]]));
  const {points:tidePoints,events,fallback:sourceFallback}=found.tide.value;
  const out={
    schemaVersion:2,generatedAt:new Date(now).toISOString(),validForMinutes:90,
    coverage:{days:8,timeZone:'Europe/Dublin'},
    tidePoints,events,
    wind:found.wind.value,waves:found.waves.value,seaTemp:found.seaTemp.value,
    buoyTemp:found.buoy.value,warningFeed:found.warnings.value,alertsFeed:found.alerts.value,
    sources:Object.fromEntries(ids.map(id=>[id,found[id].meta])),
    notes:{tides:{stationID:SEAPOINT_STATION, fallback:sourceFallback},models:'Forecast grid points are offshore; waves and sea temperatures are not Seapoint steps measurements.'},
  };
  return out;
}

const api={buildSnapshot,fetchWind,getTides,tideUrl,savedEvents,isFresh,parseBuoyCsv,mergeWaveForecast,fetchAllAlerts,fetchBeachNotices};
if (typeof module === 'object') module.exports=api;
else window.SeapointForecast=api;
})();
