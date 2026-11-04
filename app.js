import { DEFAULT_PARAMS, intensityAt, deltaMm, envelopeZeroMm, sampleHit, wavelengthRGB, pathDifferenceMm, fieldAt } from './physics.js?v=2';

const $ = id => document.getElementById(id);
const scene = $('scene'), chart = $('chart');
const ctx = scene.getContext('2d'), g = chart.getContext('2d');
const state = { params: {...DEFAULT_PARAMS}, view: 'wave', running: !matchMedia('(prefers-reduced-motion: reduce)').matches, time: 0, probe: 0, rate: 80, hits: [], histogram: new Uint32Array(120), count: 0, envelope: true, pending: [], stepping: false, lastEmission: -99, lastDetection: -99, reference: null, settingsOpen: false };
const MAX_HITS = 40000;
let sceneW = 1, sceneH = 1, chartW = 1, chartH = 1, field = null, geometry = {}, chartGeometry = {};
let lastTime = 0, lastDraw = 0, particleRemainder = 0, dirty = true, toastTimer;
const fieldCanvas = document.createElement('canvas'), fieldCtx = fieldCanvas.getContext('2d');
const monospace = '"SFMono-Regular", Consolas, monospace';
const rgba = (alpha, rgb = wavelengthRGB(state.params.wavelength)) => `rgba(${rgb},${alpha})`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function notify(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 3200);
}
function updateSlider(id) {
  const input = $(id);
  input.style.setProperty('--progress', `${(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100}%`);
}
function clearHits() {
  state.hits.length = 0;
  state.pending.length = 0;
  state.stepping = false;
  state.lastEmission = state.lastDetection = -99;
  state.histogram.fill(0);
  state.count = 0;
  particleRemainder = 0;
  $('particle-count').textContent = '0';
  syncParticleButtons();
}
function updateReadout() {
  const y = state.probe;
  $('probe-y').innerHTML = `${y > 0 ? '+' : ''}${y.toFixed(2)} <small>mm</small>`;
  $('probe-i').innerHTML = `${(100 * intensityAt(y, state.params)).toFixed(1)} <small>%</small>`;
  const phaseCycles = pathDifferenceMm(y, state.params) / (state.params.wavelength * 1e-6);
  updatePhaseInspector();
  $('probe-path').innerHTML = state.params.mode === 'single' ? '— <small>单缝</small>' : `${phaseCycles > 0 ? '+' : ''}${phaseCycles.toFixed(2)} <small>λ</small>`;
}
function syncUI() {
  for (const id of ['wavelength', 'separation', 'distance', 'slitWidth', 'phase']) {
    const p = state.params[id];
    $(id).value = p;
    const [value, unit] = id === 'wavelength' ? [p.toFixed(0), 'nm'] : id === 'distance' ? [p.toFixed(2), 'm'] : id === 'phase' ? [p.toFixed(0), '°'] : [p.toFixed(2), 'mm'];
    $(`${id}-value`).innerHTML = `${value} <small>${unit}</small>`;
    $(id).setAttribute('aria-valuetext', `${value} ${unit}`);
    updateSlider(id);
  }
  $('experiment').dataset.view = state.view;
  const single = state.params.mode === 'single', coherent = state.params.mode === 'double';
  $('separation').disabled = single;
  $('phase').disabled = !coherent;
  $('separation').closest('.slider-control').classList.toggle('disabled-control', single);
  $('phase').closest('.slider-control').classList.toggle('disabled-control', !coherent);
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', button.dataset.mode === state.params.mode));
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', button.dataset.view === state.view));
  $('particle-controls').hidden = state.view !== 'particle';
  $('compact-values').textContent = `${state.params.wavelength} nm · d ${state.params.separation.toFixed(2)} mm · L ${state.params.distance.toFixed(2)} m`;
  syncParticleButtons();
  syncReference();
  $('chart-title').innerHTML = state.view === 'particle' ? '落点统计与理论分布 <span>直方图按样本峰值归一化</span>' : '屏幕上的光强分布 <span>I / I<sub>ref</sub></span>';
  scene.setAttribute('aria-label', state.view === 'particle' ? '探测屏上的单粒子随机落点，横轴为位置，重复实验后出现理论分布' : '双缝实验装置和实时波前示意，探测屏按物理模型显示条纹');
  $('play-label').textContent = (state.running||state.stepping) ? '暂停' : '继续';
  $('play-icon').textContent = (state.running||state.stepping) ? 'Ⅱ' : '▶';
  $('play').setAttribute('aria-label', (state.running||state.stepping) ? '暂停模拟' : '继续模拟');
  $('view-status').innerHTML = `<i></i>${state.running ? (state.view === 'wave' ? '波前传播中' : '粒子逐点积累中') : state.stepping ? '已发射，等待落屏' : '实验已暂停'}`;
  $('canvas-hint').textContent = state.view === 'wave' ? '点击探测屏，测量某一点的光强' : '每个亮点都是一次独立探测，点击屏幕可测量';
  $('scene-legend').textContent = state.view === 'particle' ? '单次探测落点' : coherent ? '相干波前' : single ? '单缝波前' : '路径已可区分';
  $('schematic-note').textContent = state.view === 'particle' ? '探测屏正视图 · 横向 ±15 mm' : '远场与屏幕同模 · 缝口波前为示意';
  $('envelope').disabled = !coherent;
  $('mode-note').innerHTML = '<span>↳</span>' + ({ double: '两束相干光叠加。亮纹处相互增强，暗纹处相互抵消。', single: '关闭一条缝，细密的干涉条纹消失。单缝自身仍产生衍射。', observed: '理想探测器留下完整路径信息，干涉项消失。并非因为有人在看。' }[state.params.mode]);
  $('result-label').textContent = coherent ? '相邻亮纹间距' : '中央衍射峰宽度';
  $('fringe-spacing').textContent = (coherent ? deltaMm(state.params) : 2 * envelopeZeroMm(state.params)).toFixed(2);
  $('result-formula').textContent = coherent ? 'Δy ≈ λL / d' : 'W ≈ 2λL / a';
  $('rate-value').textContent = `${state.rate} 个/秒`;
  $('rate').value = state.rate;
  updateSlider('rate');
  updateReadout();
  dirty = true;
}
function setParams(patch, message) {
  Object.assign(state.params, patch);
  clearHits();
  prepareField();
  syncUI();
  if (message) notify(message);
}
function fitCanvas(canvas, context, w, h) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function resize() {
  const mobile = innerWidth <= 640;
  const slot = $(mobile ? 'particle-main-slot' : 'particle-sidebar-slot');
  if ($('particle-controls').parentElement !== slot) slot.appendChild($('particle-controls'));
  if (!mobile && state.settingsOpen) toggleSettings(false);
  const r = scene.getBoundingClientRect(), c = chart.getBoundingClientRect();
  sceneW = r.width; sceneH = r.height; chartW = c.width; chartH = c.height;
  if (!sceneW || !sceneH) return;
  fitCanvas(scene, ctx, sceneW, sceneH);
  fitCanvas(chart, g, chartW, chartH);
  prepareField();
  dirty = true;
}
function prepareField() {
  const w = sceneW, h = sceneH;
  const barrier = w * .285, screenX = w * (.80 + .045 * (state.params.distance-.5)/2.5);
  const gap = 24 + (state.params.separation-.15)/.45 * 32;
  const top = 43, bottom = h - 53, center = (top + bottom) / 2;
  geometry = {barrier, screenX, center, top, bottom, slit1: center-gap/2, slit2: center+gap/2, gap};
  const fw = Math.max(2, Math.round((screenX-barrier)/1.5)), fh = Math.max(2, Math.round(bottom-top));
  fieldCanvas.width = fw; fieldCanvas.height = fh;
  const im = fieldCtx.createImageData(fw,fh), a = new Float32Array(fw*fh), b = new Float32Array(fw*fh), power = new Float32Array(fw*fh), fade = new Float32Array(fw*fh);
  const k = 2*Math.PI/(21*state.params.wavelength/520);
  for (let j=0;j<fh;j++) for(let i=0;i<fw;i++) {
    const depth=i/(fw-1),x=depth*(screenX-barrier),y=top+j/(fh-1)*(bottom-top),yMm=(center-y)/(bottom-top)*30;
    const sample=fieldAt(yMm,depth,state.params),index=j*fw+i;
    // Pixel geometry slows the visible carrier only; physical intensity uses SI-converted parameters.
    const carrier=k*Math.hypot(x,y-(state.params.mode==='single'?geometry.slit1:center));
    a[index]=(sample.amplitude??0)*Math.cos(carrier);
    b[index]=(sample.amplitude??0)*Math.sin(carrier);
    power[index]=sample.intensity;
    fade[index]=clamp((depth-.08)/.16,0,1);
  }
  field={im,a,b,power,fade,fw,fh};
  dirty=true;
}
function text(context, value, x, y, {color='#8ca283',size=10,align='center',mono=false}={}) {
  context.fillStyle=color;context.font=`${size}px ${mono?monospace:'-apple-system, "PingFang SC", sans-serif'}`;context.textAlign=align;context.fillText(value,x,y);
}
function line(context,x1,y1,x2,y2,color,width=1,dash=[]) {
  context.beginPath();context.strokeStyle=color;context.lineWidth=width;context.setLineDash(dash);context.moveTo(x1,y1);context.lineTo(x2,y2);context.stroke();context.setLineDash([]);
}
function drawGrid(context,w,h) {
  context.fillStyle='#111e1c';context.fillRect(0,0,w,h);
  context.fillStyle='#38544045';
  for(let x=10;x<w;x+=20) for(let y=12;y<h;y+=20) context.fillRect(x,y,1,1);
}
function renderWave() {
  const w=sceneW,h=sceneH,{barrier,screenX,center,top,bottom,slit1,slit2}=geometry;
  const rgb=wavelengthRGB(state.params.wavelength).split(',').map(Number),t=state.time*2.4;
  drawGrid(ctx,w,h);
  if(field){
    const {im,a,b,power,fade,fw,fh}=field,ct=Math.cos(t),st=Math.sin(t);
    for(let n=0;n<a.length;n++) {
      const v=a[n]*ct+b[n]*st;
      const brightness=state.params.mode==='observed' ? power[n]*.62 : power[n]*.24+v*v*.7;
      const p=n*4;
      im.data[p]=rgb[0];im.data[p+1]=rgb[1];im.data[p+2]=rgb[2];im.data[p+3]=Math.round(brightness*fade[n]*255);
    }
    fieldCtx.putImageData(im,0,0);ctx.drawImage(fieldCanvas,barrier+3,top,screenX-barrier-3,bottom-top);
  }
  const sourceX=Math.max(12,w*.035),sourceEnd=sourceX+(w<450?26:37),beam=ctx.createLinearGradient(sourceEnd,center,barrier,center);
  beam.addColorStop(0,rgba(.03));beam.addColorStop(1,rgba(.10));ctx.fillStyle=beam;ctx.fillRect(sourceEnd,top+7,barrier-sourceEnd,bottom-top-14);
  ctx.save();ctx.beginPath();ctx.rect(sourceEnd,top+7,barrier-sourceEnd,bottom-top-14);ctx.clip();
  const spacing=21*state.params.wavelength/520;
  for(let x=sourceEnd+((state.time*spacing*2.4/6.28)%spacing);x<barrier;x+=spacing){
    const alpha=.10+.25*(x-sourceEnd)/(barrier-sourceEnd);line(ctx,x,top+10,x,bottom-10,rgba(alpha),1.1);
  }ctx.restore();
  const laserGlow=ctx.createRadialGradient(sourceEnd,center,0,sourceEnd,center,28);laserGlow.addColorStop(0,rgba(.28));laserGlow.addColorStop(1,rgba(0));ctx.fillStyle=laserGlow;ctx.fillRect(sourceEnd-28,center-28,56,56);
  ctx.fillStyle='#324439';ctx.fillRect(sourceX,center-11,sourceEnd-sourceX,22);ctx.strokeStyle='#61735a';ctx.strokeRect(sourceX+.5,center-10.5,sourceEnd-sourceX,21);ctx.fillStyle='#a8c181';ctx.fillRect(sourceEnd-3,center-6,4,12);
  const slitWidth=4+state.params.slitWidth/.12*5;
  ctx.fillStyle='#64735c';ctx.fillRect(barrier-3,top-5,6,bottom-top+10);ctx.fillStyle='#111e1c';
  const slits=state.params.mode==='single'?[slit1]:[slit1,slit2];
  // Keep the original two apertures: single-slit mode physically covers the lower one.
  if(state.params.mode==='single'){ctx.fillStyle='#29362d';ctx.fillRect(barrier-7,slit2-8,14,16);line(ctx,barrier-5,slit2-6,barrier+5,slit2+6,'#a89470',1.3);}
  // The small region at the apertures is an explicitly illustrative local wavefront.
  if(state.params.mode!=='observed'){ctx.save();ctx.beginPath();ctx.rect(barrier+3,top,(screenX-barrier)*.19,bottom-top);ctx.clip();for(const sy of slits)for(let rr=(state.time*8)%18;rr<(screenX-barrier)*.22;rr+=18){ctx.beginPath();ctx.arc(barrier,sy,rr,-Math.PI/2,Math.PI/2);ctx.strokeStyle=rgba(.32*(1-rr/((screenX-barrier)*.23)));ctx.lineWidth=1;ctx.stroke();}ctx.restore();}
  slits.forEach(y=>{ctx.fillRect(barrier-5,y-slitWidth/2,10,slitWidth);ctx.fillStyle=rgba(.9);ctx.shadowBlur=10;ctx.shadowColor=rgba(.8);ctx.fillRect(barrier-2,y-slitWidth/2,4,slitWidth);ctx.shadowBlur=0;ctx.fillStyle='#111e1c';});
  if(state.params.mode==='observed'){
    slits.forEach(y=>{ctx.strokeStyle='#d1bc80';ctx.lineWidth=1;ctx.strokeRect(barrier+8,y-8,10,16);ctx.fillStyle='#d1bc80';ctx.fillRect(barrier+11,y-2,4,4);});
  }
  const screenW=w<450?11:15;
  ctx.fillStyle='#0a140f';ctx.fillRect(screenX,top-4,screenW,bottom-top+8);
  for(let py=top;py<bottom;py++) {
    const yMm=(center-py)/(bottom-top)*30;
    const val=intensityAt(yMm,state.params);
    ctx.fillStyle=rgba(.025+val*.93);ctx.fillRect(screenX,py,screenW,1);
  }
  ctx.strokeStyle='#69845a';ctx.strokeRect(screenX-.5,top-4.5,screenW+1,bottom-top+9);
  text(ctx,'相干光源',(sourceX+sourceEnd)/2,25,{size:w<450?8:10});
  text(ctx,state.params.mode==='single'?'单缝挡板':'双缝挡板',barrier,25,{size:w<450?8:10});
  text(ctx,'探测屏',screenX+screenW/2,25,{size:w<450?8:10});
  text(ctx,`${state.params.wavelength} nm`,(sourceX+sourceEnd)/2,bottom+18,{size:w<450?7:9,mono:true,color:'#5f795f'});
  line(ctx,barrier+13,bottom+17,screenX-13,bottom+17,'#364e3b');
  line(ctx,barrier+13,bottom+14,barrier+13,bottom+20,'#56724b');line(ctx,screenX-13,bottom+14,screenX-13,bottom+20,'#56724b');
  ctx.fillStyle='#111e1c';ctx.fillRect((barrier+screenX)/2-32,bottom+10,64,15);
  text(ctx,`L = ${state.params.distance.toFixed(2)} m`,(barrier+screenX)/2,bottom+20,{size:w<450?7:9,mono:true,color:'#88a276'});
  const axisX=screenX+screenW+8;
  [15,0,-15].forEach(yMm=>{const py=center-yMm/30*(bottom-top);line(ctx,axisX-3,py,axisX,py,'#4e6a4b');text(ctx,`${yMm>0?'+':''}${yMm}`,axisX+4,py+3,{size:w<450?7:8,mono:true,align:'left',color:'#6c8963'});});
  const probeY=center-state.probe/30*(bottom-top);
  if(w>460&&Math.abs(state.probe)>0.05) slits.forEach(y=>line(ctx,barrier+3,y,screenX,probeY,'#d5e7b43d',.7,[4,5]));
  line(ctx,screenX-6,probeY,screenX+screenW+4,probeY,'#e0edc8',1);
  ctx.beginPath();ctx.arc(screenX+screenW/2,probeY,3.2,0,Math.PI*2);ctx.strokeStyle='#e1eccf';ctx.lineWidth=1;ctx.stroke();
  if(state.params.mode==='observed') text(ctx,'完整路径信息已记录 · 两路强度相加',(barrier+screenX)/2,top+15,{size:w<450?7:9,color:'#b9b38c'});
}
function particleRect(){return {x:30,y:105,w:sceneW-60,h:sceneH-145};}
function renderParticles() {
  const w=sceneW,h=sceneH,r=particleRect();drawGrid(ctx,w,h);
  const source=36,slit=w*.38,screenX=w*.84,cy=39;
  text(ctx,'单粒子源',source,17,{size:8});text(ctx,state.params.mode==='single'?'保留上缝':'双缝挡板',slit,17,{size:8});text(ctx,'探测屏',screenX,17,{size:8});
  line(ctx,source+14,cy,slit-12,cy,'#5b77504d',1,[3,4]);line(ctx,slit+14,cy,screenX-10,cy,'#5b77504d',1,[3,4]);
  ctx.fillStyle='#3a5034';ctx.fillRect(source-13,cy-8,26,16);ctx.strokeStyle='#719260';ctx.strokeRect(source-13,cy-8,26,16);
  ctx.fillStyle='#718366';ctx.fillRect(slit-2,cy-17,4,34);ctx.fillStyle=rgba(.8);ctx.fillRect(slit-3,cy-7,6,4);if(state.params.mode!=='single')ctx.fillRect(slit-3,cy+5,6,4);else line(ctx,slit-4,cy+3,slit+4,cy+11,'#b7a179',1.5);
  ctx.fillStyle='#2d4930';ctx.fillRect(screenX-3,cy-14,6,28);
  if(state.params.mode==='observed'){ctx.strokeStyle='#c5b477';ctx.strokeRect(slit+7,cy-9,8,8);ctx.strokeRect(slit+7,cy+3,8,8);}
  const sourcePulse=clamp(1-(state.time-state.lastEmission)/.5,0,1),detectorPulse=clamp(1-(state.time-state.lastDetection)/.35,0,1);
  for(const [x,pulse] of [[source+12,sourcePulse],[screenX,detectorPulse]]){ctx.beginPath();ctx.arc(x,cy,4+10*(1-pulse),0,Math.PI*2);ctx.strokeStyle=rgba(pulse*.7);ctx.lineWidth=1.5;ctx.stroke();}
  text(ctx,'发射 → 通过装置 → 探测（不指定穿缝轨迹）',w/2,72,{size:w<450?8:9,color:'#6f8b67'});
  text(ctx,'探测屏正视图',r.x,94,{align:'left',size:8,color:'#93ab83'});
  text(ctx,`${state.count.toLocaleString()} 个落点`,w-r.x,94,{align:'right',size:8,mono:true,color:'#8aa677'});
  ctx.fillStyle='#0a140f';ctx.fillRect(r.x,r.y,r.w,r.h);ctx.strokeStyle='#3d5639';ctx.strokeRect(r.x+.5,r.y+.5,r.w,r.h);
  const rgb=wavelengthRGB(state.params.wavelength);
  ctx.save();ctx.beginPath();ctx.rect(r.x,r.y,r.w,r.h);ctx.clip();
  ctx.fillStyle=rgba(.55,rgb);
  const radius=w<450?.75:.85;
  for(const hit of state.hits){const x=r.x+(hit.y+15)/30*r.w,y=r.y+hit.v*r.h;ctx.fillRect(x-radius,y-radius,radius*2,radius*2);}
  const recent=state.hits.slice(-3);
  if(state.time-state.lastDetection<.35&&state.count>0){ctx.shadowBlur=9;ctx.shadowColor=rgba(.8,rgb);ctx.fillStyle=rgba(.95,rgb);for(const hit of recent){ctx.beginPath();ctx.arc(r.x+(hit.y+15)/30*r.w,r.y+hit.v*r.h,1.7,0,Math.PI*2);ctx.fill();}ctx.shadowBlur=0;}
  ctx.restore();
  for(let yMm=-15;yMm<=15;yMm+=5){const x=r.x+(yMm+15)/30*r.w;line(ctx,x,r.y+r.h+1,x,r.y+r.h+5,'#536f4b');text(ctx,`${yMm>0?'+':''}${yMm}`,x,r.y+r.h+18,{mono:true,size:8,color:'#7a956c'});}
  if(!state.count){text(ctx,state.pending.length?'已发射，等待探测…':'发射一个粒子，观察一次落点',w/2,r.y+r.h/2,{size:w<450?11:13,color:'#6c8663'});}
  const probeX=r.x+(state.probe+15)/30*r.w;
  line(ctx,probeX,r.y-3,probeX,r.y+r.h+2,'#d5e7b455',.8,[3,5]);
}
function renderChart(){
  const w=chartW,h=chartH,left=27,right=12,top=9,bottom=h-25,cw=w-left-right,ch=bottom-top;
  chartGeometry={left,right,top,bottom,cw,ch};g.clearRect(0,0,w,h);
  [0,.5,1].forEach(v=>{const y=bottom-v*ch;line(g,left,y,w-right,y,'#293e304d',.7,[3,4]);text(g,v===1?'1.0':v===0?'0':'0.5',left-8,y+3,{mono:true,size:8,color:'#617e60',align:'right'});});
  for(let yMm=-15;yMm<=15;yMm+=5){const x=left+(yMm+15)/30*cw;line(g,x,bottom,x,bottom+4,'#41603d');text(g,`${yMm>0?'+':''}${yMm}`,x,h-10,{mono:true,size:8,color:'#718b65'});}
  text(g,'mm',w-1,h-10,{mono:true,size:7,color:'#637c5d',align:'right'});
  if(state.view==='particle'&&state.count){
    let maxCount=0;for(let i=0;i<120;i++)maxCount=Math.max(maxCount,state.histogram[i]);
    g.fillStyle=rgba(.21);for(let i=0;i<120;i++){const hh=state.histogram[i]/maxCount*ch;g.fillRect(left+i/120*cw,bottom-hh,Math.max(1,cw/120-.5),hh);}
  }
  if(state.envelope&&state.params.mode==='double'){
    g.beginPath();for(let i=0;i<=cw;i++){const yMm=(i/cw)*30-15,val=intensityAt(yMm,{...state.params,mode:'single'}),x=left+i,y=bottom-val*ch;if(i===0)g.moveTo(x,y);else g.lineTo(x,y);}
    g.strokeStyle='#8aa77b65';g.lineWidth=1;g.setLineDash([4,4]);g.stroke();g.setLineDash([]);
  }
  if(state.reference){g.beginPath();for(let i=0;i<=cw;i++){const yy=bottom-intensityAt(i/cw*30-15,state.reference)*ch;if(i===0)g.moveTo(left+i,yy);else g.lineTo(left+i,yy);}g.strokeStyle='#d4b67ccc';g.lineWidth=1.2;g.setLineDash([5,4]);g.stroke();g.setLineDash([]);}
  const gradient=g.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,rgba(.18));gradient.addColorStop(1,rgba(0));
  g.beginPath();for(let i=0;i<=Math.ceil(cw);i++){const yMm=i/cw*30-15,y=bottom-intensityAt(yMm,state.params)*ch;if(i===0)g.moveTo(left+i,y);else g.lineTo(left+i,y);}
  g.strokeStyle=rgba(.90);g.lineWidth=1.5;g.stroke();g.lineTo(w-right,bottom);g.lineTo(left,bottom);g.closePath();g.fillStyle=gradient;g.fill();
  const px=left+(state.probe+15)/30*cw,py=bottom-intensityAt(state.probe,state.params)*ch;
  line(g,px,top,px,bottom,'#b8d79377',.8,[3,4]);g.beginPath();g.arc(px,py,3,0,Math.PI*2);g.fillStyle='#d7e9bc';g.fill();
}
function addHits(number){
  const n=Math.min(number,MAX_HITS-state.count);
  for(let i=0;i<n;i++) {const y=sampleHit(state.params),v=Math.random();state.hits.push({y,v});state.histogram[Math.min(119,Math.floor((y+15)/30*120))]++;}
  state.count+=n;state.lastDetection=state.time;$('particle-count').textContent=state.count.toLocaleString();dirty=true;syncParticleButtons();
  if(state.count>=MAX_HITS){state.running=false;state.stepping=false;syncUI();notify('已记录 40,000 个落点。重置后可以重新积累。');}
}
function frame(now){
  const dt=Math.min(.05,(now-lastTime)/1000||0);lastTime=now;
  const active=state.running||state.stepping;
  if(active&&!document.hidden){
    state.time+=dt;
    if(state.running&&state.view==='particle'){
      particleRemainder+=dt*state.rate;const n=Math.floor(particleRemainder);
      if(n){particleRemainder-=n;queueHits(n,false);}
    }
    const arrived=state.pending.filter(event=>event.at<=state.time);
    state.pending=state.pending.filter(event=>event.at>state.time);
    for(const event of arrived)addHits(event.n);
    if(state.stepping&&!state.pending.length){state.stepping=false;syncUI();}
    if(state.view==='particle')dirty=true;
  }
  if((dirty||(state.running&&state.view==='wave'))&&now-lastDraw>1000/30){
    if(state.view==='wave')renderWave();else renderParticles();renderChart();lastDraw=now;dirty=false;
  }
  requestAnimationFrame(frame);
}
function probeFromEvent(event,target){
  const r=target.getBoundingClientRect();
  if(target===chart){state.probe=clamp(((event.clientX-r.left-chartGeometry.left)/chartGeometry.cw)*30-15,-15,15);}
  else if(state.view==='particle'){const p=particleRect();state.probe=clamp((event.clientX-r.left-p.x)/p.w*30-15,-15,15);}
  else {state.probe=clamp((geometry.center-(event.clientY-r.top))/(geometry.bottom-geometry.top)*30,-15,15);}
  updateReadout();dirty=true;
}
function updatePhaseInspector(){
  const p=state.params,cycles=pathDifferenceMm(state.probe,p)/(p.wavelength*1e-6)+p.phase/360;
  const phase=cycles*2*Math.PI,factor=Math.cos(phase/2)**2;
  $('phase-waves').style.display=p.mode==='observed'?'none':'';
  for(const id of ['phase-wave-b','phase-wave-sum'])$(id).style.display=p.mode==='single'?'none':'';
  const path=(base,fn)=>Array.from({length:97},(_,i)=>`${i?'L':'M'}${28+i},${(base+fn(i/96*4*Math.PI)).toFixed(2)}`).join(' ');
  $('phase-wave-a').setAttribute('d',path(20,x=>-8*Math.sin(x)));
  $('phase-wave-b').setAttribute('d',path(20,x=>-8*Math.sin(x+phase)));
  $('phase-wave-sum').setAttribute('d',path(51,x=>-7*(Math.sin(x)+Math.sin(x+phase))));
  $('phase-total').textContent=p.mode==='double'?`总相位 ${(cycles*2).toFixed(2)}π`:p.mode==='single'?'单一孔径':'无相干交叉项';
  $('phase-condition').textContent=p.mode==='single'?'单缝衍射':p.mode==='observed'?'路径可区分，干涉消失':factor>.98?'同相增强 · 亮纹条件':factor<.02?'反相抵消 · 暗纹条件':'部分叠加';
  $('phase-explanation').textContent=p.mode==='single'?'下方狭缝被遮住，只保留上缝；没有两路程差。':p.mode==='observed'?'完整路径信息使相干项消失。两路强度相加，不再相加振幅。':`包含初始相位后，两路相差 ${cycles.toFixed(2)} 个周期；干涉因子 ${(factor*100).toFixed(1)}%，再乘衍射包络。`;
}
function syncParticleButtons(){
  const pending=state.pending.reduce((sum,event)=>sum+event.n,0),full=state.count+pending>=MAX_HITS;
  $('emit-one').disabled=$('emit-many').disabled=full;
  $('particle-help').textContent=state.count>=MAX_HITS?'已完成 40,000 次探测。重置实验后可继续。':pending?`已有 ${pending.toLocaleString()} 个粒子发射，等待落屏；飞行延时为示意。`:'发射后稍候落屏；改变实验条件会重新开始积累。';
}
function queueHits(number,manual=true){
  const pending=state.pending.reduce((sum,event)=>sum+event.n,0),n=Math.min(number,MAX_HITS-state.count-pending);
  if(n<=0){if(manual)notify('本轮记录已满，重置实验后可继续。');return;}
  state.pending.push({n,at:state.time+.5});state.lastEmission=state.time;
  if(!state.running)state.stepping=true;
  syncParticleButtons();dirty=true;
}
function syncReference(){
  $('reference-note').hidden=!state.reference;
  if(state.reference){const p=state.reference;$('reference-label').textContent=`虚线对照：${p.mode==='double'?'双缝':p.mode==='single'?'单缝':'路径探测'} · ${p.wavelength} nm · d ${p.separation.toFixed(2)} mm · L ${p.distance.toFixed(2)} m`;}
}
function toggleSettings(open){
  state.settingsOpen=open;$('experiment').classList.toggle('settings-open',open);
  $('settings-backdrop').hidden=!open;document.documentElement.classList.toggle('settings-visible',open);
  $('settings-toggle').setAttribute('aria-expanded',open);
  const controls=$('experiment-controls');
  if(open){controls.setAttribute('role','dialog');controls.setAttribute('aria-modal','true');$('settings-close').focus();}
  else{controls.removeAttribute('role');controls.removeAttribute('aria-modal');if(innerWidth<=640)$('settings-toggle').focus();}
}
$('settings-toggle').addEventListener('click',()=>toggleSettings(!state.settingsOpen));
$('settings-close').addEventListener('click',()=>toggleSettings(false));
$('settings-backdrop').addEventListener('click',()=>toggleSettings(false));
document.addEventListener('keydown',event=>{
  if(!state.settingsOpen)return;
  if(event.key==='Escape'){toggleSettings(false);return;}
  if(event.key==='Tab'){
    const items=[...$('experiment-controls').querySelectorAll('button,input,summary')].filter(el=>!el.disabled&&el.getClientRects().length),first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
$('save-reference').addEventListener('click',()=>{state.reference={...state.params};syncReference();dirty=true;notify('已保留当前曲线。继续调参，用虚线对比变化。');});
$('clear-reference').addEventListener('click',()=>{state.reference=null;syncReference();dirty=true;});
for(const target of [chart,scene]){
  let dragging=false;
  target.addEventListener('pointerdown',event=>{dragging=true;target.setPointerCapture(event.pointerId);probeFromEvent(event,target);});
  target.addEventListener('pointermove',event=>{if(dragging)probeFromEvent(event,target);});
  target.addEventListener('pointerup',()=>dragging=false);target.addEventListener('pointercancel',()=>dragging=false);
}
chart.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  event.preventDefault();state.probe=event.key==='Home'?0:event.key==='End'?15:clamp(state.probe+(event.key==='ArrowRight'?.1:-.1),-15,15);updateReadout();dirty=true;
});
for(const id of ['wavelength','separation','distance','slitWidth','phase']) $(id).addEventListener('input',()=>setParams({[id]:Number($(id).value)}));
document.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>{if(state.params.mode!==button.dataset.mode)setParams({mode:button.dataset.mode});}));
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>{state.view=button.dataset.view;syncUI();}));
$('play').addEventListener('click',()=>{if(state.view==='particle'&&state.count>=MAX_HITS){notify('先重置实验，再开始新一轮积累。');return;}if(state.running||state.stepping){state.running=false;state.stepping=false;}else{state.running=true;}syncUI();});
$('reset').addEventListener('click',()=>{state.params={...DEFAULT_PARAMS};state.probe=0;state.time=0;state.rate=80;state.envelope=true;state.reference=null;$('envelope').checked=true;clearHits();prepareField();syncUI();notify('已恢复默认参数，开始新的实验。');});
$('envelope').addEventListener('change',()=>{state.envelope=$('envelope').checked;dirty=true;});
$('rate').addEventListener('input',()=>{state.rate=Number($('rate').value);$('rate-value').textContent=`${state.rate} 个/秒`;updateSlider('rate');});
$('emit-one').addEventListener('click',()=>{state.running=false;queueHits(1);syncUI();});
$('emit-many').addEventListener('click',()=>{queueHits(1000);syncUI();});
$('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else if($('experiment').requestFullscreen)await $('experiment').requestFullscreen();else notify('当前浏览器不支持全屏，可横屏查看实验。');}catch{notify('当前浏览器暂不支持全屏显示。');}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏显示实验室');resize();});
$('export').addEventListener('click',()=>{
  const p=state.params;const rows=['# BETWEEN WAVES — Double-slit lab',`# mode=${p.mode}; wavelength_nm=${p.wavelength}; separation_mm=${p.separation}; slit_width_mm=${p.slitWidth}; distance_m=${p.distance}; phase_deg=${p.phase}`,'position_mm,normalized_intensity,envelope_intensity,geometric_path_difference_mm'+(state.reference?',reference_intensity':'')];
  if(state.reference){const r=state.reference;rows.splice(2,0,`# reference_mode=${r.mode}; reference_wavelength_nm=${r.wavelength}; reference_separation_mm=${r.separation}; reference_slit_width_mm=${r.slitWidth}; reference_distance_m=${r.distance}; reference_phase_deg=${r.phase}`);}
  for(let i=0;i<=600;i++){const y=-15+i*.05;rows.push([y.toFixed(2),intensityAt(y,p).toFixed(8),intensityAt(y,{...p,mode:'single'}).toFixed(8),p.mode==='single'?'':pathDifferenceMm(y,p).toFixed(9),...(state.reference?[intensityAt(y,state.reference).toFixed(8)]:[])].join(','));}
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.join('\n')],{type:'text/csv;charset=utf-8;'})),a=document.createElement('a');a.href=url;a.download=`between-waves-${p.mode}-${p.wavelength}nm.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('已导出当前参数下的光强分布。');
});
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
  const preset=button.dataset.preset;state.reference=preset==='particle'?null:{...DEFAULT_PARAMS};state.view=preset==='particle'?'particle':'wave';state.running=true;state.probe=0;
  const patch={...DEFAULT_PARAMS,...(preset==='red'?{wavelength:650}:preset==='observed'?{mode:'observed'}:{})};
  setParams(patch,preset==='red'?'波长从 520 nm 变为 650 nm，亮纹间距从 3.12 mm 增至 3.90 mm。':preset==='particle'?'一次一个落点。试试积累 1,000 个，看看随机背后的规律。':'路径完全可区分后，细条纹消失，只留下衍射包络。');
  $('experiment').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
}));
new ResizeObserver(resize).observe(scene.parentElement);
new ResizeObserver(resize).observe(chart.parentElement);
window.addEventListener('resize',resize);
syncUI();resize();requestAnimationFrame(frame);
