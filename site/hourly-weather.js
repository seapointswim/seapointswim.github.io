'use strict';
(function () {
  const core=window.SeapointCore;
  const $=id=>document.getElementById(id);
  const compass=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const finite=Number.isFinite;
  const clock=minutes=>minutes===1440?'24:00':String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
  const format=(v,digits,unit)=>finite(v)?Number(v.toFixed(digits))+' '+unit:'Unavailable';
  const series=[
    {id:'wind',title:'Wind & gusts',unit:'m/s',keys:['wind','gust'],step:5},
    {id:'waves',title:'Wave height',unit:'m',keys:['waves'],step:0.5},
    {id:'rain',title:'Rain',unit:'mm',keys:['rain'],step:1},
    {id:'sun',title:'Sunshine',unit:'min',keys:['sun'],step:60}
  ];
  let rows=[],selected=0,selectionKey='';
  function hourlyRows(snapshot,date) {
    const stop=core.localToUtc(new Date(Date.parse(date+'T12:00Z')+86400000).toISOString().slice(0,10),'00:00');
    const result=[];
    for(let at=core.localToUtc(date,'00:00')+3600000;at<=stop;at+=3600000){
      const local=core.dublinParts(at);
      const air=core.atHour(snapshot.wind,local.date,local.time,0);
      const sea=core.atHour(snapshot.waves,local.date,local.time,0);
      const wind=air?.wind_speed_10m,gust=air?.wind_gusts_10m,dir=air?.wind_direction_10m;
      result.push({end:at===stop?1440:minutes(local.time),air:air?.temperature_2m,
        wind:finite(wind)?Number(core.formatWindSpeed(wind)):null,
        gust:finite(gust)?Number(core.formatWindSpeed(gust)):null,
        dir:finite(dir)&&dir>=0&&dir<=360&&wind!==0?dir:null,
        calm:wind===0,waves:sea?.wave_height,
        rain:finite(air?.rain)&&finite(air?.showers)?air.rain+air.showers:null,
        sun:finite(air?.sunshine_duration)?Math.round(air.sunshine_duration/60):null,
        dry:air?.precipitation===0});
    }
    return result;
  }
  const left=42,right=492;
  const x=i=>left+(right-left)*(i+.5)/rows.length;
  function draw(svg,tag,attrs,label){
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    if(label!=null) el.textContent=label;
    svg.append(el);
  }
  function renderPlots(){
    const plot=$('weather-plots');plot.replaceChildren();
    for(const s of series){
      const panel=document.createElement('div');
      panel.className='wx-panel wx-'+s.id;
      const header=document.createElement('div');header.className='wx-heading';
      const title=document.createElement('strong');title.textContent=s.title+' ('+s.unit+')';
      const value=document.createElement('span');value.id='wx-value-'+s.id;
      header.append(title,value);panel.append(header);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      const wind=s.id==='wind',bottom=s.id==='sun',height=wind?89:bottom?78:54;
      svg.setAttribute('viewBox','0 0 500 '+height);
      svg.setAttribute('aria-hidden','true');
      panel.append(svg);plot.append(panel);
      const max=Math.max(s.step,Math.ceil(Math.max(0,...rows.flatMap(r=>s.keys.map(k=>r[k])).filter(finite))/s.step)*s.step);
      const base=47,y=v=>base-v/max*36;
      for(const tick of [0,max]){
        draw(svg,'line',{x1:left,x2:right,y1:y(tick),y2:y(tick),class:'wx-grid'});
        draw(svg,'text',{x:left-5,y:y(tick)+4,'text-anchor':'end'},String(tick));
      }
      draw(svg,'rect',{class:'wx-cursor',x:0,y:4,width:(right-left)/rows.length,height:wind?75:44});
      for(const k of s.keys){
        let d='',move=true;
        rows.forEach((r,i)=>{
          if(!finite(r[k])){move=true;return;}
          if(s.id==='rain'||s.id==='sun'){
            if(r[k]>0)draw(svg,'rect',{class:'wx-bar',x:x(i)-(right-left)/rows.length*.32,y:y(r[k]),width:(right-left)/rows.length*.64,height:base-y(r[k]),rx:1.5});
          }else{
            d+=(move?' M':' L')+x(i).toFixed(2)+' '+y(r[k]).toFixed(2);
            move=false;
            draw(svg,'circle',{class:'wx-dot '+k,cx:x(i),cy:y(r[k]),r:1.6});
          }
        });
        if(d)draw(svg,'path',{d,class:'wx-line '+k});
      }
      rows.forEach((r,i)=>{
        if(wind && finite(r.dir)){
          draw(svg,'path',{class:'wx-arrow',d:'M0 6 V-6 M-4 -2 L0 -6 L4 -2',transform:'translate('+x(i)+' 66) rotate('+((r.dir+180)%360)+')'});
        }
        if(wind && r.calm)draw(svg,'circle',{class:'wx-calm',cx:x(i),cy:66,r:2});
        if(bottom && (i===0||r.end%360===0))draw(svg,'text',{x:x(i),y:70,'text-anchor':'middle'},clock(r.end).slice(0,2)+'h');
        if(s.keys.every(k=>!finite(r[k])))draw(svg,'text',{x:x(i),y:34,'text-anchor':'middle'},'–');
      });
      svg.onclick=e=>{
        const p=svg.createSVGPoint();p.x=e.clientX;p.y=e.clientY;
        const local=p.matrixTransform(svg.getScreenCTM().inverse());
        select(Math.floor((local.x-left)/(right-left)*rows.length));
      };
    }
  }
  function select(index){
    selected=Math.max(0,Math.min(rows.length-1,index));
    const row=rows[selected],arrow=finite(row.dir)?' · from '+compass[Math.round(row.dir/22.5)%16]:'';
    $('wx-hour').value=String(selected);
    $('wx-back').disabled=selected===0;$('wx-next').disabled=selected===rows.length-1;
    $('wx-air').textContent='Air '+format(row.air,0,'°C');
    $('wx-value-wind').textContent=format(row.wind,1,'m/s')+arrow+' · gusts '+format(row.gust,1,'m/s');
    $('wx-value-waves').textContent=format(row.waves,2,'m');
    $('wx-value-rain').textContent=row.rain===0?'Dry · 0 mm':format(row.rain,2,'mm');
    $('wx-value-sun').textContent=format(row.sun,0,'min');
    for(const cursor of $('weather-plots').querySelectorAll('.wx-cursor'))
      cursor.setAttribute('x',x(selected)-(right-left)/rows.length/2);
  }
  $('wx-hour').onchange=e=>select(Number(e.target.value));
  $('wx-back').onclick=()=>select(selected-1);
  $('wx-next').onclick=()=>select(selected+1);
  window.renderHourlyWeather=function(outlook){
    const fresh=window.SeapointForecast.isFresh(snapshot);
    rows=fresh?hourlyRows(snapshot,current.date):[];
    const available=rows.some(r=>['wind','gust','waves','sun','rain','air'].some(k=>finite(r[k])));
    $('wx-view').hidden=!available;
    if(!available){
      $('weather-summary').textContent='Hourly forecasts are unavailable for this date.';
      selectionKey='';return;
    }
    const key=current.date+' '+current.time;
    if(selectionKey!==key){
      selected=rows.findIndex(r=>r.end>=minutes(current.time));
      selectionKey=key;
    }
    $('wx-hour').replaceChildren(...rows.map((r,i)=>new Option(clock(r.end),String(i))));
    const now=here(), earliest=now.date===current.date?minutes(now.time):0;
    const best=rows.filter(r=>outlook.start&&r.dry&&r.sun>=30&&
      Math.min(r.end,minutes(outlook.end))-Math.max(r.end-60,minutes(outlook.start),earliest)>=15)
      .sort((a,b)=>b.sun-a.sun)[0];
    $('weather-summary').textContent=best?'Sunny and dry within the swim window · '+clock(Math.max(best.end-60,minutes(outlook.start),earliest))+'–'+clock(Math.min(best.end,minutes(outlook.end))):'';
    renderPlots();select(selected);
  };
})();
