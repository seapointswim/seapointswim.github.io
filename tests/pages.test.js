'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {buildSnapshot,mergeWaveForecast,parseBuoyCsv}=require('../scripts/update-data');
const core=require('../site/core');
const now=Date.parse('2026-11-15T08:00:00Z');
const day='2026-11-15';
const hours=Array.from({length:8*24},(_,i)=>new Date(Date.parse(day+'T00:00:00Z')+i*3600000).toISOString().slice(0,16));
function cosineTideCSV(){
 let s='time,Water_Level\nUTC,metres\n';
 const beginning=now-3*86400000;
 for(let i=0;i<13*24*6;i++){
  const t=beginning+i*10*60000;
  const localMinute=(t-Date.parse(day+'T14:00:00Z'))/60000;
  const v=2.40+1.2*Math.cos(2*Math.PI*localMinute/(12*60+25));
  s+=new Date(t).toISOString().replace('.000','')+','+v.toFixed(3)+'\n';
 }
 return s;
}
function okText(text){return {ok:true,json:async()=>JSON.parse(text),text:async()=>text};}
function makeFetch({tide=true,wind=true,waves=true,warning=true,alerts=true}={}){
 return async input=>{
  const u=new URL(input);
  if (u.hostname === 'erddap.marine.ie') {
    const constraints = decodeURIComponent(u.search).split('&').slice(1);
    const times = constraints.filter(part => part.startsWith('time'));
    assert.equal(times.length, u.pathname.includes('imiTidePrediction') ? 2 : 1);
    for (const condition of times) assert.match(condition, /^time[<>]=\d{4}-/);
  }
  if(u.pathname.includes('imiTidePrediction')) return tide?okText(cosineTideCSV()):{ok:false,status:503};
  if(u.pathname.includes('IWBNetwork'))return okText(`time,WindSpeed,WaveHeight,SeaTemperature\nUTC,knots,metres,degree_C\n2026-11-15T07:00:00Z,4.3,0.4,10.4\n`);
  if(u.hostname==='api.open-meteo.com')return wind?okText(JSON.stringify({
   hourly:{time:hours,wind_speed_10m:hours.map(()=>6),wind_gusts_10m:hours.map(()=>8),wind_direction_10m:hours.map(()=>240),temperature_2m:hours.map(()=>7),apparent_temperature:hours.map(()=>4),is_day:hours.map(x=>x.slice(11,13)>='08'&&x.slice(11,13)<='16'?1:0)},
   daily:{time:[day],sunrise:[day+'T07:50'],sunset:[day+'T16:22']}
  })): {ok:false,status:502};
  if(u.hostname==='marine-api.open-meteo.com'){
   if(u.searchParams.get('hourly')==='sea_surface_temperature')return okText(JSON.stringify({hourly:{time:hours,sea_surface_temperature:hours.map(()=>11.2)}}));
   return waves?okText(JSON.stringify({hourly:{time:hours,wave_height:hours.map(()=>.25),wave_period:hours.map(()=>4.1),wave_direction:hours.map(()=>70)}})):{ok:false,status:503};
  }
  if(u.hostname==='www.met.ie')return warning?okText('[]'):{ok:false,status:502};
  if(u.hostname==='data.epa.ie')return alerts?okText('{"count":0,"list":[]}'):{ok:false,status:502};
  throw Error('Unexpected test endpoint '+input);
 }
}
function assess(s,date='2026-11-15',time='14:00'){
 return core.assess({date,time,points:s.tidePoints,events:s.events,wind:s.wind,waves:s.waves,seaTemp:s.seaTemp,warningFeed:s.warningFeed,alertsFeed:s.alertsFeed,buoyTemp:s.buoyTemp,sources:{tides:{fallback:s.notes.tides.fallback}},now});
}
test('Github Pages paths are relative and browser core is loaded',()=>{
 const html=fs.readFileSync('site/index.html','utf8');
 assert.match(html,/src="\.\/core\.js(?:\?[^"]*)?"/);assert.match(html,/src="\.\/app\.js(?:\?[^"]*)?"/);
 assert.doesNotMatch(html,/src="\/app\.js"/);
});
test('mocked upstreams yield a complete snapshot for selected day',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch(),now});
 for(const meta of Object.values(d.sources))assert.equal(meta.status,'ok',JSON.stringify(meta));
 assert.ok(d.tidePoints.length>1000);assert.ok(d.events.length>20);
 const a=assess(d);
 assert.equal(a.waves.heightM,.25);assert.equal(a.wind.speedKn,6);
 assert.equal(a.temperature.waterC,11.2);assert.equal(a.temperature.airC,7);
 assert.equal(a.status,'good');
});
test('a missing wave API does not fabricate a good verdict',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch({waves:false}),now});
 assert.equal(d.sources.waves.status,'unavailable');
 assert.equal(assess(d).status,'unknown');
});
test('dated official tide table fallback is labelled and contains no fake selected level',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch({tide:false}),now});
 assert.equal(d.sources.tide.status,'published-copy');
 const a=assess(d);assert.equal(a.tide.datum,'Dublin Port chart datum');
 assert.equal(a.tide.selectedLevel,null);
 assert.equal(a.tide.aboveLow,null);
});
test('missing warning and alerts feed is shown as unverified, not invented safe',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch({warning:false,alerts:false}),now});
 const a=assess(d);
 assert.equal(a.warnings.verified,false);assert.equal(a.water.verified,false);
 assert.ok(a.caveats.some(c=>/could not be checked/i.test(c)));
});
test('active Seapoint bathing restriction blocks a favourable forecast',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch(),now});
 d.alertsFeed={count:1,list:[{beach_id:'IEEABWC090_0000_0100',start_date:'2026-11-13',end_date:'2026-11-17',description:'Bathe prohibited'}]};
 assert.equal(assess(d).status,'avoid');
});
test('water temperature below 15 C is noted without automatically downgrading a calm swim',async()=>{
 const d=await buildSnapshot({fetchImpl:makeFetch(),now});const a=assess(d);
 assert.equal(a.temperature.coldWater,true);assert.equal(a.status,'good');
});
test('wave fallback uses best-match where the coastal model has no data',()=>{
 const primary={hourly:{time:['2026-11-15T14:00'],wave_height:[null],wave_period:[null],wave_direction:[null]}};
 const backup={hourly:{time:hours,wave_height:hours.map(()=>.31),wave_period:hours.map(()=>3),wave_direction:hours.map(()=>70)}};
 const v=mergeWaveForecast(primary,backup);assert.equal(v.hourly.wave_height[14],.31);
});
test('buoy age and temperature parsed as an offshore observation',()=>{
 const csv='time,WindSpeed,WaveHeight,SeaTemperature\nUTC,knots,metres,degree_C\n2026-11-15T07:00:00Z,4.3,0.4,10.4\n';
 const b=parseBuoyCsv(csv,now);assert.equal(b.fresh,true);assert.equal(b.waterC,10.4);
});

async function dayInput() {
 const s = await buildSnapshot({fetchImpl:makeFetch(),now});
 return {date:day, now, points:s.tidePoints, events:s.events, wind:s.wind,
   waves:s.waves, seaTemp:s.seaTemp, warningFeed:s.warningFeed, alertsFeed:s.alertsFeed};
}

test('top answer gives a continuous daylight period and a time inside it', async () => {
 const input = await dayInput();
 const plan = core.dailyOutlook(input);
 assert.equal(plan.status, 'good');
 assert.ok(plan.start < plan.end);
 assert.ok(plan.start <= plan.pick && plan.pick <= plan.end);
 assert.ok(plan.start >= '08:05' && plan.end <= '15:57');
 for (let t = core.localToUtc(day,plan.start); t <= core.localToUtc(day,plan.end); t += 15*60000) {
   assert.equal(core.assess({...input,time:core.fmtTime(t)}).status,'good');
 }
});

test('very cold water and wind chill do not affect the period or its grade', async () => {
 const input = await dayInput();
 const normal = core.dailyOutlook(input);
 input.seaTemp.hourly.sea_surface_temperature.fill(5);
 input.wind.hourly.temperature_2m.fill(-4);
 input.wind.hourly.apparent_temperature.fill(-9);
 const cold = core.dailyOutlook(input);
 assert.deepEqual(cold, normal);
 assert.equal(core.assess({...input,time:cold.pick}).temperature.waterC,5);
});

test('strong winds and strong gusts each exclude an otherwise suitable day', async () => {
 const input = await dayInput();
 for (const [speed,gust] of [[22,26],[10,29]]) {
   input.wind.hourly.wind_speed_10m.fill(speed);
   input.wind.hourly.wind_gusts_10m.fill(gust);
   const plan = core.dailyOutlook(input);
   assert.equal(plan.title,'Too windy for a dip');
   assert.equal(plan.start,undefined);
   assert.match(plan.reason,/wind|gust/i);
 }
 assert.equal(core.windStatus(null,31,null).status,'avoid');
 assert.equal(core.windStatus(19,23,60).status,'avoid');
});

test('a gusty hour breaks the window, and today only shows time still ahead', async () => {
 const input = await dayInput();
 const start = core.dailyOutlook(input).start;
 input.wind.hourly.wind_gusts_10m[14]=34;
 const split = core.dailyOutlook(input);
 assert.equal(split.status,'good');
 assert.ok(split.end <= '13:30' || split.start >= '14:45');
 const later = core.dailyOutlook({...input,now:core.localToUtc(day, '14:46')});
 assert.ok(later.start >= '15:00' && later.start > start);
 const dark = core.dailyOutlook({...input,now:core.localToUtc(day, '20:00')});
 assert.equal(dark.title,'No daylight window left');
 assert.equal(dark.start,undefined);
});

test('a warning is shown on a mixed window and a bathing restriction removes it', async () => {
 const input = await dayInput();
 input.warningFeed = [{regions:['EI810'],headline:'Small Craft warning',level:'Yellow'}];
 const mixed = core.dailyOutlook(input);
 assert.equal(mixed.status,'caution');
 assert.equal(mixed.reason,'Small Craft warning');
 input.alertsFeed = {count:1,list:[{beach_id:'IEEABWC090_0000_0100',start_date:day,end_date:day}]};
 assert.equal(core.dailyOutlook(input).start,undefined);
 assert.match(core.dailyOutlook(input).reason,/bathing-water/);
});

test('missing wind, warnings or bathing notices cannot produce a recommended period', async () => {
 const input = await dayInput();
 for (const missing of ['wind','warningFeed','alertsFeed']) {
   const plan=core.dailyOutlook({...input,[missing]:null});
   assert.equal(plan.status,'unknown',missing);
   assert.equal(plan.start,undefined,missing);
 }
});

test('the default day follows Dublin daylight in winter and summer', () => {
 for (const [date,sunset,check,expected] of [
   ['2026-06-15','21:56','19:00','2026-06-15'],
   ['2026-11-15','16:24','16:10','2026-11-16']
 ]) {
   const wind = {daily:{time:[date],sunset:[date+'T'+sunset]}};
   assert.equal(core.defaultSwimDate(wind,core.localToUtc(date,check)),expected);
 }
});

test('sunrise and sunset follow the selected Dublin date independently of the swim window', () => {
 const summer = '2026-06-15', winter = '2026-11-16';
 const weather = {daily:{time:[summer,winter], sunrise:[summer+'T04:57',winter+'T07:49'],
   sunset:[summer+'T21:57',winter+'T16:24']}};
 assert.deepEqual(core.isDay(weather,summer,'05:00'),{rise:'04:57',set:'21:57',ok:false});
 assert.deepEqual(core.isDay(weather,winter,'08:15'),{rise:'07:49',set:'16:24',ok:true});
 weather.daily.sunrise[1] = null;
 assert.deepEqual(core.isDay(weather,winter,'08:15'),{rise:null,set:'16:24',ok:null});
 assert.deepEqual(core.isDay(weather,'2026-12-01','08:15'),{rise:null,set:null,ok:null});
});
