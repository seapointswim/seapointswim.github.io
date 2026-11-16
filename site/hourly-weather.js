'use strict';
(function () {
  const core=window.SeapointCore;
  const $=id=>document.getElementById(id);
  const compass=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const finite=Number.isFinite;
  const clock=minutes=>minutes===1440?'24:00':String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0');
  const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
  const format=(v,digits,unit)=>finite(v)?Number(v.toFixed(digits))+' '+unit:'—';
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
      header.append(title);panel.append(header);
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
    const row=rows[selected];
    $('wx-hour').value=String(selected);
    $('wx-selected-heading').textContent='Readings at '+clock(row.end)+' · '+dayLabel(current.date);
    $('wx-back').disabled=selected===0;$('wx-next').disabled=selected===rows.length-1;
    for(const {key,digits,unit} of measures){
      $('wx-'+key).textContent=key==='dir'?direction(row):format(row[key],digits,unit);
    }
    for(const cursor of $('weather-plots').querySelectorAll('.wx-cursor'))
      cursor.setAttribute('x',x(selected)-(right-left)/rows.length/2);
  }
  const measures=[
    {key:'wind',label:'Wind',digits:1,unit:'m/s'},
    {key:'dir',label:'Wind from'},
    {key:'gust',label:'Gusts',digits:1,unit:'m/s'},
    {key:'waves',label:'Waves',digits:2,unit:'m'},
    {key:'rain',label:'Rain',digits:2,unit:'mm'},
    {key:'sun',label:'Sunshine',digits:0,unit:'min'},
    {key:'air',label:'Air',digits:0,unit:'°C'}
  ];
  const direction=r=>finite(r.dir)?compass[Math.round(r.dir/22.5)%16]:r.calm?'Calm':'—';
  function tableHeading(scope,text){
    const heading=document.createElement('th');
    heading.scope=scope;
    heading.textContent=text;
    return heading;
  }
  function renderTable(){
    $('wx-caption').textContent='Hourly readings · '+dayLabel(current.date);
    const times=rows.map((row,index)=>{
      const heading=tableHeading('col',clock(row.end));
      if(index===selected)heading.className='wx-current';
      return heading;
    });
    $('wx-times').replaceChildren(tableHeading('col','Hour ending'),...times);
    const body=$('wx-rows');
    body.replaceChildren();
    for(const {key,label,digits,unit} of measures){
      const tr=body.insertRow();
      tr.append(tableHeading('row',unit?label+' ('+unit+')':label));
      rows.forEach((row,index)=>{
        const cell=tr.insertCell();
        if(index===selected)cell.className='wx-current';
        if(key==='dir'){
          if(finite(row.dir)){
            const arrow=document.createElement('span');
            arrow.className='wx-table-arrow';arrow.setAttribute('aria-hidden','true');arrow.textContent='↑';
            arrow.style.transform='rotate('+((row.dir+180)%360)+'deg)';cell.append(arrow);
          }
          cell.append(direction(row));
        }else{
          cell.textContent=finite(row[key])?String(Number(row[key].toFixed(digits))):'—';
        }
      });
    }
  }
  function showView(table){
    $('wx-plots-view').hidden=table;
    $('wx-table-view').hidden=!table;
    $('show-plots').setAttribute('aria-pressed',String(!table));
    $('show-table').setAttribute('aria-pressed',String(table));
    if(table)renderTable();
  }
  $('show-plots').onclick=()=>showView(false);
  $('show-table').onclick=()=>showView(true);
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
    const sunny=[];
    for(const p of (outlook.periods||[]).filter(p=>p.status===outlook.status)){
      for(const row of rows){
        if(!row.dry || row.sun==null || row.sun<30)continue;
        const from=Math.max(row.end-60,minutes(p.start),earliest),to=Math.min(row.end,minutes(p.end));
        if(to-from>=15)sunny.push({from,to,sun:row.sun});
      }
    }
    const best=sunny.sort((a,b)=>b.sun-a.sun)[0];
    $('weather-summary').textContent=best?'Sunny and dry · '+clock(best.from)+'–'+clock(best.to):'';
    renderPlots();select(selected);
    if(!$('wx-table-view').hidden)renderTable();
  };
})();
