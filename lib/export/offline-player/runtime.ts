// Self-contained browser runtime: no imports, server, modules, fetch or storage.
// Keep it as source text so bundlers cannot introduce out-of-scope helper names.
export const OFFLINE_PLAYER_RUNTIME = String.raw`
(function(){
  'use strict';
  var lesson=JSON.parse(document.getElementById('lesson-data').textContent);
  var pages=lesson.pages, current=0, started=false, paused=false, narrationIndex=0, audioEpoch=0;
  var surfaces=new Map(), quizStates=new Map(), audio=new Audio(), boardIndex=-1;
  audio.id='lesson-audio';audio.hidden=true;document.body.append(audio);
  var $=function(id){return document.getElementById(id);};
  var stage=$('stage'), select=$('contents'), status=$('status');
  var pendingMedia=[];
  function el(tag,text,className){var node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
  function mathText(tag,text,className){var node=el(tag,text,className);if(lesson.math&&Object.prototype.hasOwnProperty.call(lesson.math,text))node.innerHTML=lesson.math[text];return node;}
  function tell(text){status.textContent=text;}
  function post(frame,command){if(frame&&frame.contentWindow)frame.contentWindow.postMessage({offlineLesson:true,command:command},'*');}
  function stopAudio(){audioEpoch++;audio.pause();audio.removeAttribute('src');audio.load();}
  function pauseSurface(node,value){
    if(!node)return;
    var frame=node.querySelector('iframe');post(frame,value?'pause':'resume');
    if(value){
      pendingMedia=Array.from(node.querySelectorAll('video,audio')).filter(function(m){return !m.paused;});
      pendingMedia.forEach(function(m){m.pause();});
    }else pendingMedia.forEach(function(m){m.play().catch(function(){tell('请点击页面中的媒体播放按钮。');});});
  }
  function narration(){
    stopAudio();var token=audioEpoch;
    var clips=pages[current].narration;
    if(!clips.length){tell('本页没有预先生成的配音，可由教师讲解。');return;}
    if(narrationIndex>=clips.length)narrationIndex=0;
    function playClip(){
      if(token!==audioEpoch)return;
      if(narrationIndex>=clips.length){tell('本页讲解结束，请手动进入下一页。');return;}
      var clip=clips[narrationIndex];$('caption').textContent=clip.text;
      while(!clip.src){narrationIndex++;if(narrationIndex>=clips.length){tell('其余段落没有配音，请查看讲稿。');return;}clip=clips[narrationIndex];}
      $('caption').textContent=clip.text;
      audio.src=clip.src;audio.playbackRate=Number($('speed').value);
      audio.onended=function(){narrationIndex++;playClip();};
      audio.onerror=function(){tell('配音无法播放，请使用讲稿继续授课。');};
      audio.play().catch(function(){tell('请再次点击“播放配音”以允许浏览器播放声音。');});
    }
    playClip();
  }
  function quiz(page,host){
    var questions=page.questions||[], state=quizStates.get(page.id);
    if(!state){state={index:0,answers:{},submitted:{}};quizStates.set(page.id,state);}
    host.replaceChildren();
    if(!questions.length){host.append(el('p','本页没有题目。'));return;}
    var q=questions[state.index], key=String(state.index), submitted=!!state.submitted[key];
    var chosen=state.answers[key]||(state.answers[key]=[]);
    var card=el('section',undefined,'quiz-card');
    card.append(el('p','课堂练习  '+(state.index+1)+' / '+questions.length,'eyebrow'));
    card.append(mathText('h2',q.question));
    card.append(el('p',q.type==='multiple'?'多选题：选择所有符合条件的选项，再确认答案。':q.type==='short_answer'?'写下你的思路，再与教师一起核对。':'单选题：选择一个选项，再确认答案。','muted'));
    if(q.type==='short_answer'){
      var input=el('textarea');input.setAttribute('aria-label','填写答案');input.value=chosen[0]||'';input.disabled=submitted;
      input.oninput=function(){state.answers[key]=[input.value];confirm.disabled=!input.value.trim();};card.append(input);
    }else{
      var options=el('div',undefined,'options');
      (q.options||[]).forEach(function(option){
        var button=mathText('button',option.value+'  '+option.label,'option');button.type='button';
        button.setAttribute('aria-pressed',String(chosen.indexOf(option.value)>=0));button.disabled=submitted;
        button.onclick=function(){
          if(q.type==='multiple'){var i=chosen.indexOf(option.value);if(i<0)chosen.push(option.value);else chosen.splice(i,1);}
          else state.answers[key]=[option.value];
          quiz(page,host);
        };options.append(button);
      });card.append(options);
    }
    var controls=el('div',undefined,'quiz-controls');
    var confirm=el('button',submitted?'已确认':'确认答案','primary');confirm.type='button';
    confirm.disabled=submitted||!chosen.some(function(v){return v.trim();});
    confirm.onclick=function(){state.submitted[key]=true;quiz(page,host);};controls.append(confirm);
    if(submitted){
      var feedback='已提交，请由教师点评。';
      if(q.type!=='short_answer'&&q.hasAnswer!==false&&q.answer&&q.answer.length){
        var correct=q.answer.length===chosen.length&&q.answer.every(function(a){return chosen.indexOf(a)>=0;});
        feedback=(correct?'回答正确。':'再想一想。')+' 参考答案：'+q.answer.join('、');
      }else if(q.hasAnswer!==false&&q.answer&&q.answer.length)feedback='参考答案：'+q.answer.join('；')+'（由教师判断）';
      var result=el('div',feedback,'feedback');result.setAttribute('role','status');
      if(q.analysis)result.append(mathText('p',q.analysis));card.append(result);
      var retry=el('button','重新作答');retry.onclick=function(){delete state.answers[key];delete state.submitted[key];quiz(page,host);};controls.append(retry);
    }
    if(state.index>0){var prev=el('button','上一题');prev.onclick=function(){state.index--;quiz(page,host);};controls.append(prev);}
    var next=el('button',state.index<questions.length-1?'下一题':'完成练习');next.disabled=!submitted;
    next.onclick=function(){if(state.index<questions.length-1){state.index++;quiz(page,host);}else{tell('练习完成，可点击下一页继续授课。');}};controls.append(next);
    card.append(controls);host.append(card);
  }
  function surface(page){
    if(surfaces.has(page.id))return surfaces.get(page.id);
    var node=el('div',undefined,'surface');node.dataset.pageId=page.id;
    if(page.kind==='slide'){
      var canvas=el('div',undefined,'slide-canvas');canvas.style.setProperty('--ratio',String(page.ratio||0.5625));
      var image=el('img');image.src=page.image;image.alt=page.title;canvas.append(image);
      (page.media||[]).forEach(function(m){
        var media=el(m.kind);media.src=m.src;media.controls=true;media.preload='metadata';
        media.setAttribute('aria-label',m.kind==='video'?'课堂视频':'课堂音频');
        media.style.cssText='position:absolute;left:'+m.left+'%;top:'+m.top+'%;width:'+m.width+'%;height:'+m.height+'%;transform:rotate('+m.rotate+'deg)';canvas.append(media);
      });node.append(canvas);
    }else if(page.kind==='interactive'){
      var frame=el('iframe');frame.title=page.title;frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('allow','autoplay; fullscreen');
      frame.onload=function(){if(pages[current].id!==page.id||paused)post(frame,'pause');};
      frame.srcdoc=page.html;node.append(frame);
    }else quiz(page,node);
    stage.append(node);surfaces.set(page.id,node);return node;
  }
  function fit(){
    var node=surfaces.get(pages[current].id);if(!node)return;
    var canvas=node.querySelector('.slide-canvas');if(!canvas)return;
    var ratio=pages[current].ratio||0.5625;
    var width=Math.min(stage.clientWidth,stage.clientHeight/ratio);
    canvas.style.width=width+'px';canvas.style.height=width*ratio+'px';
  }
  function show(index){
    if(index<0||index>=pages.length)return;
    stopAudio();narrationIndex=0;boardIndex=-1;$('board-view').hidden=true;
    surfaces.forEach(function(node){pauseSurface(node,true);node.hidden=true;});
    current=index;paused=false;pendingMedia=[];
    var page=pages[current], node=surface(page);node.hidden=false;
    post(node.querySelector('iframe'),'resume');
    select.value=String(current);$('page-title').textContent=page.title;$('counter').textContent=(current+1)+' / '+pages.length;
    $('previous').disabled=current===0;$('next').disabled=current===pages.length-1;
    $('pause').textContent='暂停本页';$('pause-mask').hidden=true;
    $('narrate').disabled=!page.narration.some(function(c){return c.src;});
    $('board').disabled=!(page.boards&&page.boards.length);
    $('caption').textContent='';$('notes').textContent=page.narration.map(function(c){return c.text;}).join('\n\n')||'本页没有讲稿。';
    tell(page.kind==='interactive'?'可直接操作页面；暂停本页可暂停动画与计时。':'由教师手动推进课堂进度。');fit();
  }
  function togglePause(){
    if(!started)return;paused=!paused;pauseSurface(surfaces.get(pages[current].id),paused);
    if(paused)audio.pause();
    $('pause-mask').hidden=!paused;$('pause').textContent=paused?'继续本页':'暂停本页';
    tell(paused?'本页已暂停，点击继续恢复。':'本页已恢复；配音可单独点击播放。');
  }
  pages.forEach(function(page,index){var option=el('option',(index+1)+'. '+page.title);option.value=String(index);select.append(option);});
  $('lesson-title').textContent=lesson.title;$('cover-title').textContent=lesson.title;
  $('cover-count').textContent=pages.length+' 页课件 · 离线授课 · 教师手动翻页';
  $('start').onclick=function(){started=true;$('cover').hidden=true;$('player').hidden=false;show(0);document.documentElement.requestFullscreen().catch(function(){});};
  $('previous').onclick=function(){show(current-1);};$('next').onclick=function(){show(current+1);};
  select.onchange=function(){show(Number(select.value));};$('pause').onclick=togglePause;$('resume').onclick=togglePause;
  $('replay').onclick=function(){
    if(!confirm('重播本页会重置本页的互动和答题进度，是否继续？'))return;
    var page=pages[current], node=surfaces.get(page.id);pauseSurface(node,true);if(node)node.remove();surfaces.delete(page.id);quizStates.delete(page.id);show(current);
  };
  $('narrate').onclick=function(){if(!audio.paused){audio.pause();tell('配音已暂停。');return;}if(paused)togglePause();if(audio.getAttribute('src')&& !audio.ended){audio.play().catch(function(){tell('配音播放失败。');});}else narration();};
  $('speed').onchange=function(){audio.playbackRate=Number(this.value);};
  $('notes-toggle').onclick=function(){$('notes').hidden=!$('notes').hidden;};
  $('fullscreen').onclick=function(){if(document.fullscreenElement)document.exitFullscreen().catch(function(){});else document.documentElement.requestFullscreen().catch(function(){tell('无法自动全屏，可按 F11。');});};
  $('blackout').onclick=function(){$('black-screen').hidden=false;};$('black-screen').onclick=function(){this.hidden=true;};
  $('board').onclick=function(){
    var boards=pages[current].boards||[];boardIndex++;
    if(boardIndex>=boards.length){boardIndex=-1;$('board-view').hidden=true;return;}
    $('board-image').src=boards[boardIndex].image;$('board-view').hidden=false;
    $('board-label').textContent='板书 '+(boardIndex+1)+' / '+boards.length+'（点击板书返回课件）';
  };
  $('board-view').onclick=function(){this.hidden=true;boardIndex=-1;};
  window.addEventListener('resize',fit);
  document.addEventListener('keydown',function(e){
    if(!started||e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    if(e.code==='Space'&&e.target.closest('button'))return;
    if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&e.target.closest('.option'))return;
    if(e.key==='ArrowRight'||e.key==='PageDown'){e.preventDefault();show(current+1);}
    else if(e.key==='ArrowLeft'||e.key==='PageUp'){e.preventDefault();show(current-1);}
    else if(e.code==='Space'){e.preventDefault();togglePause();}
    else if(e.key==='Escape'){$('black-screen').hidden=true;}
  });
  window.addEventListener('message',function(e){
    var node=surfaces.get(pages[current].id), frame=node&&node.querySelector('iframe');
    if(!frame||e.source!==frame.contentWindow)return;
    if(e.data&&e.data.offlineLesson===true&&(e.data.navigate===1||e.data.navigate===-1))show(current+e.data.navigate);
    if(e.data&&e.data.__maicInteractive===true&&e.data.kind==='runtime-error')tell('本页互动发生错误，可重播或切换下一页。错误：'+String(e.data.message).slice(0,180));
  });
})();`;
