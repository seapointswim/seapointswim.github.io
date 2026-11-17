'use strict';
(function(){
const core=typeof module==='object'?require('./core'):window.SeapointCore;
const codes={
  0:['Sunny','clear'],1:['Mainly sunny','mainly'],2:['Partly cloudy','partly'],3:['Overcast','cloud'],
  45:['Fog','fog'],48:['Freezing fog','fog'],51:['Light drizzle','drizzle'],53:['Drizzle','drizzle'],55:['Heavy drizzle','drizzle'],
  56:['Light freezing drizzle','ice'],57:['Heavy freezing drizzle','ice'],61:['Light rain','rain'],63:['Rain','rain'],65:['Heavy rain','rain'],
  66:['Light freezing rain','ice'],67:['Heavy freezing rain','ice'],71:['Light snow','snow'],73:['Snow','snow'],75:['Heavy snow','snow'],77:['Snow grains','snow'],
  80:['Light showers','showers'],81:['Showers','showers'],82:['Heavy showers','showers'],85:['Light snow showers','snowshowers'],86:['Heavy snow showers','snowshowers'],
  95:['Thunderstorm','thunder'],96:['Thunderstorm with hail','hail'],97:['Heavy thunderstorm','thunder'],99:['Thunderstorm with heavy hail','hail']
};
function condition(code,night=false){
  const found=Number.isInteger(code)?codes[code]:null;
  let [label,kind]=found||['Unavailable','unknown'];
  if(night&&code===0)label='Clear night';
  if(night&&code===1)label='Mainly clear';
  return {label,kind,night};
}
function nightAt(weather,at){
  const local=core.dublinParts(at),sun=core.sunTimesForDay(weather?.daily,local.date);
  return at<core.localToUtc(local.date,sun.rise)||at>=core.localToUtc(local.date,sun.set);
}
function icon(info){
  const {kind,night}=info;
  const sun='<circle cx="17" cy="17" r="7" fill="#f5c657" stroke="#bd861d"/><path d="M17 4v3m0 20v3M4 17h3m20 0h3M8 8l2 2m14 14 2 2M8 26l2-2M24 10l2-2" stroke="#bd861d"/>';
  const moon='<path d="M21 5a12 12 0 1 0 10 18A13 13 0 0 1 21 5Z" fill="#ccd6f1" stroke="#687ba4"/>';
  const cloud='<path d="M12 31a7 7 0 0 1 0-14 10 10 0 0 1 19-2 8 8 0 1 1 4 16Z" fill="#e4edf2" stroke="#637d8a"/>';
  const rain='<path d="m15 35-2 5m12-5-2 5m12-5-2 5" stroke="#3788bb" stroke-width="2.5"/>';
  const snow='<path d="M14 35v7m-3-5 6 3m-6 0 6-3m15-2v7m-3-5 6 3m-6 0 6-3" stroke="#6390a8"/>';
  let art='';
  if(kind==='unknown')art='<text x="24" y="31" text-anchor="middle" fill="#71858b" stroke="none" font-size="28">?</text>';
  else {
    if(['clear','mainly','partly','showers','snowshowers'].includes(kind))art+=night?moon:sun;
    if(kind!=='clear')art+=kind==='mainly'?'<g transform="translate(13 11) scale(.65)">'+cloud+'</g>':cloud;
    if(['rain','showers','ice'].includes(kind))art+=rain;
    if(kind==='drizzle')art+='<path d="M14 37h.1m10 0h.1m10 0h.1" stroke="#3788bb" stroke-width="3"/>';
    if(['snow','snowshowers','ice','hail'].includes(kind))art+=snow;
    if(['thunder','hail'].includes(kind))art+='<path d="m25 27-7 10h7l-3 8 12-13h-8l3-5Z" fill="#e7b33b" stroke="#ad7c22"/>';
    if(kind==='fog')art+='<path d="M7 35h33M12 40h23" stroke="#83979e"/>';
  }
  return '<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+art+'</svg>';
}
const finite=Number.isFinite;
function rainAmount(row){return finite(row?.rain)&&row.rain>=0&&finite(row?.showers)&&row.showers>=0?row.rain+row.showers:null;}
function probability(row){const v=row?.precipitation_probability;return finite(v)&&v>=0&&v<=100?v:null;}
const zoneFormat=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'});
function rowsForDay(snapshot,date){
  const next=new Date(Date.parse(date+'T12:00Z')+86400000).toISOString().slice(0,10);
  const rows=[],stop=core.localToUtc(next,'00:00');
  for(let at=core.localToUtc(date,'00:00');at<stop;at+=3600000){
    const a=core.atInstant(snapshot.wind,at,0),sea=core.atInstant(snapshot.waves,at,0);
    const wind=a?.wind_speed_10m,gust=a?.wind_gusts_10m,dir=a?.wind_direction_10m;
    rows.push({at,time:core.fmtTime(at),label:zoneFormat.format(at),air:a?.temperature_2m,feels:a?.apparent_temperature,
      condition:condition(a?.weather_code,nightAt(snapshot.wind,at)),cloud:a?.cloud_cover,
      wind:finite(wind)?Number(core.formatWindSpeed(wind)):null,gust:finite(gust)?Number(core.formatWindSpeed(gust)):null,
      dir:finite(dir)&&dir>=0&&dir<=360&&wind!==0?dir:null,calm:wind===0,
      waves:sea?.wave_height,rain:rainAmount(a),probability:probability(a)});
  }
  return rows;
}
const api={codes,condition,nightAt,icon,rainAmount,probability,rowsForDay};
if(typeof module==='object')module.exports=api;else window.SeapointWeather=api;
})();
