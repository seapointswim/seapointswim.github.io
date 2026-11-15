'use strict';
/** Scheduled snapshot builder for static GitHub Pages. No API keys or dependencies. */
const fs = require('node:fs');
const path = require('node:path');
const {SEAPOINT_STATION, parseTideCsv, extrema, defaultSwimDate, sunTimesForDay, highTidesForDay, fmtTime} = require('../site/core.js');
const seapointTides2026 = require('./tides-2026.js');

const ROOT = path.resolve(__dirname, '../site/data/conditions.json');
const NOW = () => Date.now();
const HOUR = 3600000;
const EPS = 1e-8;
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
    const r=await fetchImpl(urlText,{signal:abort.signal,headers:{'Accept':({csv:'text/csv',html:'text/html',json:'application/json'})[type],'User-Agent':'SeapointSwim-GitHubPages/1.0'}});
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

async function buildSnapshot({fetchImpl=fetch,now=Date.now()}={}){
  const low=iso(now-2*24*HOUR),high=iso(now+10*24*HOUR);
  const tideUrl='https://erddap.marine.ie/erddap/tabledap/imiTidePredictionEpa.csv?time%2CstationID%2Csea_surface_height&'+[`stationID=${encodeURIComponent(JSON.stringify(SEAPOINT_STATION))}`, encodeURIComponent('time>=' + low), encodeURIComponent('time<=' + high)].join('&');
  const windUrl=url('https://api.open-meteo.com/v1/forecast',{
    latitude:'53.29694',longitude:'-6.15862',hourly:'wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,is_day',daily:'sunrise,sunset',wind_speed_unit:'kn',timezone:'Europe/Dublin',past_days:1,forecast_days:8
  });
  const waveParams={latitude:'53.30',longitude:'-6.12',hourly:'wave_height,wave_period,wave_direction',timezone:'Europe/Dublin',cell_selection:'sea',past_days:1,forecast_days:8};
  const seaUrl=url('https://marine-api.open-meteo.com/v1/marine',{
    latitude:'53.30',longitude:'-6.12',hourly:'sea_surface_temperature',timezone:'Europe/Dublin',cell_selection:'sea',past_days:1,forecast_days:8
  });
  const buoyUrl='https://erddap.marine.ie/erddap/tabledap/IWBNetwork.csv?time%2CWindSpeed%2CWaveHeight%2CSeaTemperature&'+'station_id=%22M2%22&' + encodeURIComponent('time>=' + iso(now-12*HOUR));
  const promises={
    tide:attempt('tide',async()=>{
      const csv=await readRemote(tideUrl,'csv',fetchImpl);
      const pts=parseTideCsv(csv);
      if(pts.length<100)throw Error('Tide feed returned fewer than 100 usable points or unrecognised units');
      return pts;
    }),
    wind:attempt('wind',async()=>{
      const d=await readRemote(windUrl,'json',fetchImpl);
      if(!validHourly(d,'wind_speed_10m')||!validHourly(d,'temperature_2m'))throw Error('Incomplete wind or air-temperature forecast');
      return d;
    }),
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
    alerts:attempt('alerts',()=>fetchAllAlerts(fetchImpl)),
  };
  const ids=Object.keys(promises);
  const values=await Promise.all(ids.map(id=>promises[id]));
  const found=Object.fromEntries(ids.map((id,i)=>[id,values[i]]));
  let tidePoints=found.tide.value||[];
  let events=extrema(tidePoints),sourceFallback=false;
  if (!events.length) {
    const first = Date.parse(low), last = Date.parse(high);
    // The saved highs and lows come from this same beach model and vertical datum.
    tidePoints = [];
    events = seapointTides2026.map(([utc,h,type]) => ({t:Date.parse(utc),h,type}))
      .filter(e => e.t >= first && e.t <= last);
    sourceFallback = events.length > 0;
    found.tide.meta.status = sourceFallback ? 'published-copy' : 'unavailable';
  }
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
// Put the dated readings in the served HTML as well as the interactive forecast.
function initialReadings(html, snapshot) {
  const date = defaultSwimDate(snapshot.wind, Date.parse(snapshot.generatedAt));
  const daylight = sunTimesForDay(snapshot.wind?.daily, date);
  const highs = highTidesForDay(snapshot.events, date).map(e => fmtTime(e.t));
  const dayLabel = new Intl.DateTimeFormat('en-IE', {weekday:'short',day:'numeric',month:'short',
    timeZone:'Europe/Dublin'}).format(new Date(date+'T12:00:00Z'));
  const fields = {'daily-day':'Best forecast window · '+dayLabel, sunrise:daylight.rise,
    sunset:daylight.set, 'daily-highs':highs.join(' and ') || 'Unavailable'};
  for (const [id,value] of Object.entries(fields)) {
    const field = new RegExp('(id="' + id + '">)[^<]*');
    if (!field.test(html)) throw Error('Missing summary field: ' + id);
    html = html.replace(field, (_, tag) => tag + value);
  }
  return html;
}
async function main(){
  const snap=await buildSnapshot();
  fs.mkdirSync(path.dirname(ROOT),{recursive:true});
  fs.writeFileSync(ROOT,JSON.stringify(snap));
  const index = path.resolve(__dirname, '../site/index.html');
  fs.writeFileSync(index, initialReadings(fs.readFileSync(index,'utf8'), snap));
  const statuses=Object.entries(snap.sources).map(([k,v])=>`${k}:${v.status}${v.error?'('+v.error+')':''}`).join(' ');
  console.log(`Updated ${snap.generatedAt} · ${statuses}`);
  if(process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Seapoint Swim data refresh\n\nUpdated ${snap.generatedAt}\n\n| Source | Status | Detail |\n|---|---|---|\n${Object.entries(snap.sources).map(([k,v])=>`| ${k} | ${v.status} | ${(v.error||'OK').replace(/\|/g,'/')} |`).join('\n')}\n`);
  }
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={initialReadings,buildSnapshot,parseBuoyCsv,mergeWaveForecast,fetchAllAlerts};
