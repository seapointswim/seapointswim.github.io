'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const forecast=require('../site/forecast'),core=require('../site/core'),weather=require('../site/weather');
function fixture(start='2026-11-17T00:00Z',hours=72){
 const t=Date.parse(start)/1000,time=Array.from({length:hours},(_,i)=>t+i*3600);
 return {latitude:53.321613,longitude:-6.1596985,timezone:'Europe/Dublin',utc_offset_seconds:0,
 hourly_units:{wind_speed_10m:'kn',rain:'mm',showers:'mm'},
 hourly:{time,temperature_2m:time.map(()=>8),wind_speed_10m:time.map(()=>10),wind_gusts_10m:time.map(()=>20),wind_direction_10m:time.map(()=>90),
 rain:time.map(()=>0),showers:time.map(()=>0),weather_code:time.map(()=>2),precipitation_probability:time.map(()=>25)}};
}
test('both scheduled and direct fetch use the same explicit ECMWF request with history and UTC timestamps',async()=>{
 let request;
 const fetchImpl=async url=>{request=new URL(url);return {ok:true,json:async()=>fixture()};};
 const result=await forecast.fetchWind(fetchImpl);
 assert.equal(result.meta.status,'ok');assert.equal(result.value.model,'ecmwf_ifs');
 for(const [key,value] of Object.entries({models:'ecmwf_ifs',past_days:'5',forecast_days:'8',timeformat:'unixtime',timezone:'Europe/Dublin',wind_speed_unit:'kn',latitude:'53.2977505',longitude:'-6.1596072'}))assert.equal(request.searchParams.get(key),value,key);
 assert.match(request.searchParams.get('hourly'),/weather_code,cloud_cover,precipitation_probability/);
 assert.doesNotMatch(request.searchParams.get('hourly'),/sunshine/);
 assert.equal(result.value.utcTime,true);assert.ok(result.value.gridDistanceKm<3);
 assert.equal(result.value.modelIssuedAt,null);
 assert.match(fs.readFileSync('site/forecast.js','utf8'),/wind:fetchWind\(fetchImpl,true\)/);
 assert.match(fs.readFileSync('site/app.js','utf8'),/marine.buildSnapshot/);
});
test('all WMO codes, invalid values and day/night symbols have accessible descriptions',()=>{
 for(const code of [0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,97,99]){
  const c=weather.condition(code);assert.notEqual(c.label,'Unavailable');assert.match(weather.icon(c),/viewBox/);
 }
 for(const code of [null,undefined,NaN,'0',4,-1])assert.equal(weather.condition(code).label,'Unavailable');
 assert.equal(weather.condition(0,true).label,'Clear night');assert.equal(weather.condition(1,true).label,'Mainly clear');
 assert.notEqual(weather.icon(weather.condition(0)),weather.icon(weather.condition(0,true)));
 assert.equal(weather.condition(61).label,'Light rain');assert.equal(weather.condition(81).label,'Showers');
 assert.equal(weather.nightAt(null,Date.parse('2026-06-15T00:00Z')),true);
 assert.equal(weather.nightAt(null,Date.parse('2026-06-15T12:00Z')),false);
});
test('Dublin daylight-saving days have 23/25 distinct instants and disambiguated repeated local times',()=>{
 for(const [date,start,count] of [['2026-03-29','2026-03-28T00:00Z',23],['2026-10-25','2026-10-24T00:00Z',25]]){
  const f=forecast.normaliseWeather(fixture(start));const rows=weather.rowsForDay({wind:f},date);
  assert.equal(rows.length,count);assert.equal(new Set(rows.map(r=>r.at)).size,count);
  assert.equal(rows[0].time,'00:00');assert.equal(rows.at(-1).time,'23:00');
  if(count===25){const repeated=rows.filter(r=>r.time==='01:00');assert.equal(repeated.length,2);assert.notEqual(repeated[0].label,repeated[1].label);}
  else assert.equal(rows.filter(r=>r.time==='01:00').length,0);
 }
});
test('missing weather never means sunny/dry/calm, and probability is independent of amount',()=>{
 const f=fixture();f.hourly.rain[12]=null;f.hourly.weather_code[12]=null;f.hourly.wind_speed_10m[12]=null;f.hourly.precipitation_probability[12]=null;
 const row=weather.rowsForDay({wind:forecast.normaliseWeather(f)},'2026-11-17')[12];
 assert.equal(row.rain,null);assert.equal(row.probability,null);assert.equal(row.wind,null);assert.equal(row.calm,false);assert.equal(row.condition.label,'Unavailable');
 assert.equal(weather.rainAmount({rain:0,showers:0}),0);assert.equal(weather.probability({rain:0,showers:0}),null);
 assert.equal(weather.probability({precipitation_probability:101}),null);
 assert.equal(Number(core.formatWindSpeed(10)),5.1);
 assert.equal(weather.rowsForDay({wind:forecast.normaliseWeather(f)},'2026-12-01')[12].condition.label,'Unavailable');
});
test('precipitation keeps its actual end instant and five-day history remains usable',()=>{
 const f=fixture('2026-10-22T00:00Z',144);f.hourly.rain[72]=4;
 const n=forecast.normaliseWeather(f),end=f.hourly.time[72]*1000;
 assert.equal(core.rainRiskAt(n,end).end,end);
 assert.equal(core.rainRiskAt(n,end+48*3600000).status,'clear');
});
test('refresh failure retains data and original retrieval time without promoting an old model',()=>{
 const wind=forecast.normaliseWeather(fixture()),past='2026-11-17T10:00Z';wind.retrievedAt=past;
 const previous={schemaVersion:3,wind,generatedAt:past,sources:{wind:{checked:past,status:'ok'}}};
 const next=()=>({schemaVersion:3,wind:null,generatedAt:'2026-11-17T12:00Z',sources:{wind:{checked:'2026-11-17T12:00Z',error:'Timeout'}}});
 const result=forecast.retainPrevious(next(),previous);
 assert.equal(result.wind,wind);assert.equal(result.wind.retrievedAt,past);assert.equal(result.sources.wind.checked,past);assert.equal(result.sources.wind.status,'retained');
 assert.equal(forecast.sourceFresh(result,'wind',Date.parse('2026-11-17T12:00Z')),false);
 assert.equal(forecast.retainPrevious(next(),{...previous,schemaVersion:2}).wind,null);
});
test('units and unreasonable grid locations are rejected; optional missing fields are preserved',()=>{
 assert.throws(()=>forecast.normaliseWeather({...fixture(),longitude:0}),/grid/);
 assert.throws(()=>forecast.normaliseWeather({...fixture(),hourly_units:{wind_speed_10m:'kmh'}}),/unit/);
 const partial=fixture();delete partial.hourly.wind_gusts_10m;
 const row=weather.rowsForDay({wind:forecast.normaliseWeather(partial)},'2026-11-17')[0];assert.equal(row.gust,null);
 assert.equal(core.windStatus(10,null,90).status,'unknown');
});
test('page has no sunshine-minute display and retains daylight, tide controls and private feedback',()=>{
 for(const path of ['site/index.html','site/app.js','site/hourly-weather.js','site/forecast.js','site/weather.js'])assert.doesNotMatch(fs.readFileSync(path,'utf8'),/sunshine|sunMinutes|wx-sun/i,path);
 const html=fs.readFileSync('site/index.html','utf8');
 for(const id of ['sunrise','sunset','tide-chart','minimum-tide','feedback-title'])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/preceding 3 hours/);assert.match(html,/ensemble probability/);
});
