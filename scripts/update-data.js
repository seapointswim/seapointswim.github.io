'use strict';
const fs = require('node:fs');
const path = require('node:path');
const forecast = require('../site/forecast');
const {defaultSwimDate,sunTimesForDay,highTidesForDay,fmtTime}=require('../site/core');
const ROOT=path.resolve(__dirname,'../site/data/conditions.json');
function buildSnapshot(options) {
  return forecast.buildSnapshot({loadTables:()=>require('../site/data/tide-tables.json'),...options});
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
module.exports={...forecast,initialReadings,buildSnapshot};
