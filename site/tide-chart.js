'use strict';
let tideProbeKey='', tideProbeMinute=0;
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
    return element;
  }
  function line(x1,y1,x2,y2,style) {draw('line',{x1,y1,x2,y2,class:style});}
  function text(x,y,label,anchor='middle') {draw('text',{x,y,'text-anchor':anchor},label);}
  const minimum=data.minimum;
  document.getElementById('tide-caption').textContent='Seapoint tide · '+dayLabel(data.date);
  document.getElementById('tide-legend').textContent='The curve shows the predicted tide. '+(minimum>ceiling?'Your '+minimum+' m minimum is above the chart.':'The dashed line marks your '+minimum+' m minimum.');
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
  const guide=draw('line',{y1:21,y2:143,class:'probe-line'});
  const dot=draw('circle',{r:4.5,class:'selected-time'});
  const dayMinutes=(end-start)/60000;
  const key=data.date+' '+data.time;
  if(key!==tideProbeKey){
    tideProbeKey=key;
    tideProbeMinute=Math.round((Date.parse(data.at)-start)/60000);
  }
  function probe(minute){
    tideProbeMinute=Math.max(0,Math.min(dayMinutes,Math.round(minute)));
    const t=start+tideProbeMinute*60000;
    const i=Math.floor(tideProbeMinute/5), a=samples[i], b=samples[i+1];
    const fraction=(t-a.t)/(5*60000);
    let height=null;
    if(Number.isFinite(a.height)){
      if(fraction===0)height=a.height;
      else if(Number.isFinite(b?.height))height=a.height+(b.height-a.height)*fraction;
    }
    const time=t===end?'24:00':window.SeapointCore.fmtTime(t);
    const reading=time+' · '+(height===null?'Tide height unavailable':height.toFixed(2)+' m');
    document.getElementById('tide-readout').textContent=reading;
    svg.setAttribute('aria-valuenow',tideProbeMinute);
    svg.setAttribute('aria-valuetext',reading);
    guide.setAttribute('x1',x(t));guide.setAttribute('x2',x(t));
    dot.setAttribute('visibility',height===null?'hidden':'visible');
    if(height!==null){dot.setAttribute('cx',x(t));dot.setAttribute('cy',y(height));}
  }
  function pointer(event){
    const matrix=svg.getScreenCTM();
    if(!matrix)return;
    const point=svg.createSVGPoint();
    point.x=event.clientX;point.y=event.clientY;
    const local=point.matrixTransform(matrix.inverse());
    probe((local.x-x(start))/(x(end)-x(start))*dayMinutes);
  }
  svg.setAttribute('aria-valuemin','0');
  svg.setAttribute('aria-valuemax',dayMinutes);
  svg.onpointerdown=event=>{
    if(!event.isPrimary||event.button!==0)return;
    svg.setPointerCapture(event.pointerId);pointer(event);
  };
  svg.onpointermove=event=>{
    if(event.isPrimary&&(svg.hasPointerCapture(event.pointerId)||event.pointerType==='mouse'))pointer(event);
  };
  svg.onkeydown=event=>{
    const offsets={ArrowLeft:-5,ArrowDown:-5,ArrowRight:5,ArrowUp:5,PageDown:-60,PageUp:60};
    if(event.key==='Home')probe(0);
    else if(event.key==='End')probe(dayMinutes);
    else if(Object.hasOwn(offsets,event.key))probe(tideProbeMinute+offsets[event.key]);
    else return;
    event.preventDefault();
  };
  probe(tideProbeMinute);
}
