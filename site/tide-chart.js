'use strict';
function renderTideChart(data) {
  const svg=document.getElementById('tide-chart'),figure=document.getElementById('tide-figure');
  const samples=data.curve,levels=samples.map(p=>p.height).filter(Number.isFinite);
  svg.replaceChildren();
  figure.hidden=!levels.length;
  if (figure.hidden) return;
  const start=samples[0].t,end=samples.at(-1).t;
  const x=t=>36+(t-start)/(end-start)*378;
  const floor=Math.min(0,Math.floor(Math.min(...levels)));
  const ceiling=Math.max(floor+1,Math.ceil(Math.max(...levels)+0.15));
  const y=h=>143-(h-floor)/(ceiling-floor)*122;
  function draw(tag,attrs,label) {
    const element=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [name,value] of Object.entries(attrs)) element.setAttribute(name,String(value));
    if(label!=null) element.textContent=label;
    svg.append(element);
  }
  function line(x1,y1,x2,y2,style) {draw('line',{x1,y1,x2,y2,class:style});}
  function text(x,y,label,anchor='middle') {draw('text',{x,y,'text-anchor':anchor},label);}
  const minimum=data.minimum;
  document.getElementById('tide-caption').textContent='Seapoint tide · '+dayLabel(data.date);
  document.getElementById('tide-legend').textContent='Solid curve: predicted tide · '+(minimum>ceiling?'Your '+minimum+' m minimum is above the chart.':'Dashed line: your '+minimum+' m minimum')+(data.tide.valid?' · Dot: '+data.time+' ('+data.tide.selectedLevel.toFixed(2)+' m)':'');
  for(let h=floor;h<=ceiling;h++){
    line(x(start),y(h),x(end),y(h),'grid');
    text(30,y(h)+4,h+' m','end');
  }
  for(const time of ['00:00','06:00','12:00','18:00','24:00']){
    const t=time==='24:00'?end:window.SeapointCore.localToUtc(data.date,time);
    text(x(t),165,time);
  }
  let path='',newSegment=true;
  for(const sample of samples) {
    if(sample.height==null){newSegment=true;continue;}
    path+=(newSegment?'M':' L')+x(sample.t).toFixed(2)+' '+y(sample.height).toFixed(2);
    newSegment=false;
  }
  draw('path',{d:path,class:'curve'});
  if(minimum<=ceiling) line(x(start),y(minimum),x(end),y(minimum),'minimum');
  for(const high of data.highs){
    const index=Math.round((high.t-start)/(5*60000)),height=samples[index]?.height;
    if(height!=null) text(Math.max(60,Math.min(390,x(high.t))),y(height)-9,'High '+window.SeapointCore.fmtTime(high.t));
  }
  if(data.tide.valid) draw('circle',{cx:x(Date.parse(data.at)),cy:y(data.tide.selectedLevel),r:4.5,class:'selected-time'});
}
