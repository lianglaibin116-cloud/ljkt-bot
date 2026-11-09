import { injectIntoDocumentHead } from '@/lib/utils/html-document';
import { patchHtmlForIframe } from '@/lib/utils/iframe';

// Installed before authored scripts. Timers retain their remaining delay while
// paused; RAF timestamps use the same virtual clock as performance.now().
const BRIDGE = String.raw`
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:">
<script>
(function () {
  var paused=false, offset=0, pausedAt=0, sequence=0;
  var now=performance.now.bind(performance), dateNow=Date.now.bind(Date);
  var timeout=window.setTimeout.bind(window), clear=window.clearTimeout.bind(window);
  var raf=window.requestAnimationFrame.bind(window), cancel=window.cancelAnimationFrame.bind(window);
  var timers=new Map(), frames=new Map(), animations=[], media=[];
  function clock(){return (paused?pausedAt:now())-offset;}
  try{Object.defineProperty(performance,'now',{value:clock});}catch(e){}
  Date.now=function(){return dateNow()-offset-(paused?now()-pausedAt:0);};
  function schedule(id, task){
    task.due=now()+task.remaining;
    task.native=timeout(function(){
      if(!timers.has(id))return;
      if(!task.repeat)timers.delete(id);
      else {task.remaining=task.delay; if(!paused)schedule(id,task);}
      if(typeof task.fn==='function')task.fn.apply(window,task.args);
      else Function(String(task.fn))();
    },task.remaining);
  }
  function add(fn,delay,repeat,args){
    var id=++sequence, ms=Math.max(repeat?1:0,Number(delay)||0);
    var task={fn:fn,delay:ms,remaining:ms,repeat:repeat,args:args};
    timers.set(id,task);if(!paused)schedule(id,task);return id;
  }
  window.setTimeout=function(fn,delay){return add(fn,delay,false,Array.prototype.slice.call(arguments,2));};
  window.setInterval=function(fn,delay){return add(fn,delay,true,Array.prototype.slice.call(arguments,2));};
  window.clearTimeout=window.clearInterval=function(id){var task=timers.get(id);if(task){clear(task.native);timers.delete(id);}};
  function scheduleFrame(id,task){task.native=raf(function(){frames.delete(id);task.fn(clock());});}
  window.requestAnimationFrame=function(fn){var id=++sequence, task={fn:fn};frames.set(id,task);if(!paused)scheduleFrame(id,task);return id;};
  window.cancelAnimationFrame=function(id){var task=frames.get(id);if(task){cancel(task.native);frames.delete(id);}};
  function setPaused(value){
    if(value===paused)return;
    if(value){
      pausedAt=now();paused=true;
      timers.forEach(function(t){clear(t.native);t.remaining=Math.max(0,t.due-pausedAt);});
      frames.forEach(function(t){cancel(t.native);});
      animations=document.getAnimations().filter(function(a){return a.playState==='running';});
      animations.forEach(function(a){a.pause();});
      media=Array.from(document.querySelectorAll('audio,video')).filter(function(m){return !m.paused;});
      media.forEach(function(m){m.pause();});
    }else{
      offset+=now()-pausedAt;paused=false;
      timers.forEach(function(t,id){schedule(id,t);});frames.forEach(function(t,id){scheduleFrame(id,t);});
      animations.forEach(function(a){try{a.play();}catch(e){}});
      media.forEach(function(m){m.play().catch(function(){});});
    }
  }
  window.addEventListener('message',function(e){
    if(e.source!==parent||!e.data||e.data.offlineLesson!==true)return;
    if(e.data.command==='pause')setPaused(true);
    if(e.data.command==='resume')setPaused(false);
  });
  document.addEventListener('securitypolicyviolation',function(e){
    parent.postMessage({__maicInteractive:true,kind:'runtime-error',message:'离线页面阻止了未打包资源：'+String(e.blockedURI).slice(0,160)},'*');
  });
  document.addEventListener('click',function(e){
    var link=e.target.closest&&e.target.closest('a[href]');
    if(link&&link.getAttribute('href')&&!link.getAttribute('href').startsWith('#')){
      e.preventDefault();parent.postMessage({__maicInteractive:true,kind:'runtime-error',message:'离线模式不打开外部链接，请使用播放器翻页。'},'*');
    }
  },true);
  window.addEventListener('keydown',function(e){
    if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(e.key==='PageDown'||e.key==='PageUp'){
      e.preventDefault();parent.postMessage({offlineLesson:true,navigate:e.key==='PageDown'?1:-1},'*');
    }
  });
})();
</script>`;

export function prepareOfflineInteraction(html: string): string {
  return injectIntoDocumentHead(patchHtmlForIframe(html), BRIDGE);
}
