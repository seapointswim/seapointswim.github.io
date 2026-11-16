'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {SEAPOINT_STATION, parseTideCsv, extrema} = require('../site/core');
const {tideUrl} = require('../site/forecast');
const filename = path.resolve(__dirname, '../site/data/tide-tables.json');
const day = 86400000;
function annualEvents(points, year) {
  const start = Date.UTC(year,0,1), end = Date.UTC(year+1,0,1);
  const relevant = points.filter(p=>p.t>=start && p.t<=end);
  if (!relevant.length || relevant[0].t>start || relevant.at(-1).t<end-600000 ||
      relevant.some((p,i)=>i && p.t-relevant[i-1].t!==600000)) {
    throw Error('Incomplete Seapoint time series for '+year);
  }
  const events=extrema(points).filter(e=>e.t>=start && e.t<end);
  return events.map(e=>[new Date(e.t).toISOString().replace('.000Z','Z'),e.h,e.type]);
}
async function extend() {
  const tables=JSON.parse(fs.readFileSync(filename,'utf8'));
  if (tables.stationID!==SEAPOINT_STATION) throw Error('Unexpected archive station');
  const base='https://erddap.marine.ie/erddap/info/imiTidePredictionEpa/index.json';
  const info=await fetch(base,{signal:AbortSignal.timeout(20000)});
  if (!info.ok) throw Error('Tide metadata HTTP '+info.status);
  const rows=(await info.json()).table.rows;
  const bound=attr=>Date.parse(rows.find(r=>r[1]==='NC_GLOBAL' && r[2]===attr)?.[4]);
  const first=bound('time_coverage_start'), last=bound('time_coverage_end');
  if (!Number.isFinite(first) || !Number.isFinite(last)) throw Error('Unknown tide coverage');
  for (let year=new Date().getUTCFullYear();Date.UTC(year+1,0,1)<=last;year++) {
    if (tables.years[year] || Date.UTC(year,0,1)<first) continue;
    const url=tideUrl(Math.max(first,Date.UTC(year,0,1)-day),Math.min(last,Date.UTC(year+1,0,1)+day));
    const data=await fetch(url,{signal:AbortSignal.timeout(60000)});
    if (!data.ok) throw Error('Tide data HTTP '+data.status);
    tables.years[year]=annualEvents(parseTideCsv(await data.text()),year);
  }
  fs.writeFileSync(filename,JSON.stringify(tables)+'\n');
}
if (require.main===module) extend().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={annualEvents};
