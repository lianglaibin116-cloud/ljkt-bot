import type { OfflineLesson } from './types';
import { OFFLINE_PLAYER_RUNTIME } from './runtime';
import katex from 'katex';
import { renderQuizMathText } from '@/lib/quiz/math-text';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function quizMath(lesson: OfflineLesson): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  for (const page of lesson.pages)
    for (const question of page.questions ?? []) {
      const texts = [
        question.question,
        question.analysis ?? '',
        ...(question.answer ?? []),
        ...(question.options ?? []).map((o) => o.value + '  ' + o.label),
      ];
      for (const text of texts) {
        const segments = renderQuizMathText(text);
        if (!segments.some((segment) => segment.type === 'math')) continue;
        // Native MathML keeps formulas offline without downloading fonts or scripts.
        result[text] = segments
          .map((segment) =>
            segment.type === 'text'
              ? escape(segment.value)
              : katex.renderToString(segment.value, {
                  output: 'mathml',
                  displayMode: segment.displayMode,
                  throwOnError: false,
                  trust: false,
                  strict: false,
                }),
          )
          .join('');
      }
    }
  return result;
}

export function buildOfflinePlayerHtml(lesson: OfflineLesson): string {
  // Never interpolate authored text into executable script or HTML markup.
  const data = JSON.stringify({ ...lesson, math: quizMath(lesson) })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' data: blob:; style-src 'unsafe-inline' data:; img-src data: blob:; font-src data: blob:; media-src data: blob:; frame-src 'self' about: data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; worker-src blob:">
<title>${escapeHtml(DEFAULT_BRAND.productName)} · 离线授课</title><style>
*{box-sizing:border-box} [hidden]{display:none!important} body{margin:0;background:#f5f6f1;color:#20352b;font-family:"Microsoft YaHei",system-ui,sans-serif}button,select{font:inherit;color:#20352b;background:#fff;border:1px solid #d5ddd4;border-radius:9px;padding:10px 14px;cursor:pointer}button:hover{background:#edf2ec}button:disabled{opacity:.4;cursor:default}button:focus-visible,select:focus-visible{outline:3px solid #789783;outline-offset:2px}.primary{background:#315846;color:white;border-color:#315846}.primary:hover{background:#244436}.muted{color:#657186}.eyebrow{font-size:15px;color:#315846;font-weight:700}h2{font-size:clamp(22px,3vw,36px);line-height:1.5;white-space:pre-wrap}#cover{min-height:100vh;display:grid;place-items:center;padding:36px;background:radial-gradient(ellipse at top,#e4ede3,#f5f6f1 72%)}.cover-inner{max-width:850px;text-align:center}h1{font-size:clamp(30px,5vw,56px);line-height:1.35}#cover p{color:#66736b;line-height:1.8}#start{font-size:22px;margin:24px;padding:16px 40px}#player{height:100dvh;display:flex;flex-direction:column}header{display:flex;align-items:center;gap:18px;padding:10px 18px;border-bottom:1px solid #dce3db;background:#fbfcf9}#lesson-title{max-width:25vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:15px}#contents{max-width:50vw;min-width:180px}#counter{margin-left:auto;white-space:nowrap}#stage{position:relative;flex:1;min-height:0;overflow:hidden;background:#e9ede7}.surface{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:white;color:#19243b}.slide-canvas{position:relative;flex:none}.slide-canvas>img{width:100%;height:100%;display:block}iframe{width:100%;height:100%;border:0;background:white}.surface:has(.quiz-card){overflow:auto;align-items:flex-start;background:#f3f5f0}.quiz-card{width:min(100%,1050px);padding:24px 40px 36px}.options{display:grid;gap:12px}.option{text-align:left;color:#23314b;background:white;border:2px solid #d4dbe0;white-space:pre-wrap;font-size:clamp(18px,2vw,25px);padding:16px}.option[aria-pressed=true]{background:#e7eee6;border-color:#668572;color:#244436}.option:disabled{opacity:1}.quiz-controls{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}.feedback{padding:16px 20px;background:#e5f2ed;border-left:5px solid #258e70;margin-top:20px;line-height:1.7;white-space:pre-wrap;font-size:20px}textarea{width:100%;min-height:140px;font:inherit;font-size:22px;border:1px solid #a6b3c9;border-radius:10px;padding:16px}footer{padding:10px 16px;flex:none;background:#fbfcf9;border-top:1px solid #dce3db}.controls{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}.status-row{display:flex;gap:12px;align-items:center;margin-top:8px;font-size:13px;color:#66736b}#page-title{font-weight:600;flex-shrink:0;max-width:35vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#caption{padding:6px 16px;max-height:12vh;overflow:auto;background:#edf1eb;white-space:pre-wrap}#caption:empty{display:none}#notes{position:absolute;right:12px;top:64px;bottom:130px;max-width:min(600px,90vw);padding:24px;background:#fcfbf5;color:#202b3f;z-index:5;overflow:auto;white-space:pre-wrap;line-height:1.8;font-size:20px;box-shadow:0 12px 60px #0003;border-radius:14px}#pause-mask{position:absolute;inset:0;display:grid;place-items:center;background:#20352b44;z-index:3}#resume{font-size:24px;box-shadow:0 10px 40px #0003}#black-screen{position:fixed;inset:0;background:black;z-index:20;cursor:pointer}#board-view{position:absolute;inset:0;background:#20352b;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer}#board-image{max-width:100%;max-height:92%;object-fit:contain}#board-label{padding:8px;color:white} @media(max-width:700px){header{padding:8px}#lesson-title{display:none}.quiz-card{padding:15px}button,select{padding:8px;font-size:14px}.status-row{font-size:11px}}
.quiz-controls button{background:#fff;color:#23314b;border-color:#a6b3c9}.quiz-controls button:hover{background:#e9edf5}.quiz-controls .primary{background:#315846;color:#fff;border-color:#315846}.quiz-card math{font-size:1.12em}.quiz-card math[display=block]{margin:12px 0;overflow:auto}
</style></head><body>
<div id="cover"><div class="cover-inner"><p>${escapeHtml(DEFAULT_BRAND.productName)} · 离线授课</p><h1 id="cover-title"></h1><p id="cover-count"></p><button id="start" class="primary">开始上课</button><p>插入 U 盘后双击此文件即可打开。<br>方向键翻页，空格暂停。互动完成后，在底部继续下一页。</p></div></div>
<main id="player" hidden><header><span id="lesson-title"></span><select id="contents" aria-label="课程目录"></select><span id="counter"></span><button id="fullscreen">全屏</button></header>
<div id="stage"><div id="pause-mask" hidden><button id="resume" class="primary">继续本页</button></div><div id="board-view" hidden><img id="board-image" alt="本页板书"><span id="board-label"></span></div></div>
<div id="caption" aria-live="polite"></div><aside id="notes" hidden></aside>
<footer><div class="controls"><button id="previous">上一页</button><button id="pause">暂停本页</button><button id="replay">重播本页</button><button id="narrate">播放 / 暂停配音</button><select id="speed" aria-label="配音速度"><option value="1">1 倍速</option><option value="1.25">1.25 倍速</option><option value="1.5">1.5 倍速</option><option value="0.75">0.75 倍速</option></select><button id="notes-toggle">讲稿</button><button id="board">板书</button><button id="blackout">黑屏</button><button id="next" class="primary">下一页</button></div><div class="status-row"><span id="page-title"></span><span id="status" role="status"></span></div></footer></main><div id="black-screen" hidden title="点击返回课堂"></div>
<script id="lesson-data" type="application/json">${data}</script><script>${OFFLINE_PLAYER_RUNTIME}</script></body></html>`;
}
