import { injectIntoDocumentHead } from './html-document';
import { orderMathScriptsBeforeAmd } from '@/lib/interactive/math-script-order';
import {
  withObservationResponder,
  type ObservationIdentity,
} from '@/lib/interactive/observation-bridge';
import { INTERACTIVE_REFERENCE_EXCLUDED_TAG_NAMES } from '@/lib/interactive/element-reference-policy';

const INTERACTIVE_REFERENCE_EXCLUDED_TAG_LOOKUP = Object.fromEntries(
  INTERACTIVE_REFERENCE_EXCLUDED_TAG_NAMES.map((tagName) => [tagName, 1]),
);

/**
 * In-memory localStorage/sessionStorage shim, injected as the FIRST thing in the
 * document so the page's own scripts see working storage.
 *
 * The interactive iframe is sandboxed `allow-scripts` WITHOUT `allow-same-origin`
 * (intentional — combining them negates the sandbox for LLM-authored HTML). In a
 * null-origin document, touching `window.localStorage` throws a SecurityError;
 * many generated pages read/write storage in their setup code, so that throw
 * crashes the script before anything renders → a blank/black widget. This shim
 * replaces both storages with an in-memory implementation when the real ones are
 * inaccessible, keeping the sandbox intact while letting storage-using pages run.
 */
const STORAGE_SHIM = `<script data-iframe-storage-shim>
(function () {
  function makeStore() {
    var data = Object.create(null);
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ok = false;
    try { var s = window[name]; if (s) { s.getItem('__probe__'); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try { Object.defineProperty(window, name, { value: makeStore(), configurable: true }); } catch (e) {}
    }
  });
})();
</script>`;

/**
 * Runtime-error capture, injected as the VERY FIRST script so it observes errors
 * from the storage shim and every page script that follows. Generated interactive
 * pages frequently die on a runtime error (a `JSON.parse` of malformed config, a
 * reference to a CDN lib that failed to load, …) → the script aborts and the
 * widget renders blank. The sandboxed (null-origin) iframe can't be read by the
 * editor, but it CAN `postMessage` out: this forwards `window.onerror`, unhandled
 * rejections and `console.error` to the parent, which stores them per scene and
 * feeds them to the editor agent — so it can diagnose a blank page instead of
 * guessing. Only touches `window.*` so it stays sandbox-safe and unit-testable.
 *
 * The most important errors (a `JSON.parse` that aborts setup) fire SYNCHRONOUSLY
 * while srcDoc parses — potentially before the parent has subscribed its `message`
 * listener (which it installs from a passive effect after inserting the iframe).
 * To avoid losing exactly the errors this feature exists to surface, every post is
 * also buffered, and the shim re-emits the whole buffer when the parent sends a
 * `{ __maicErrorReplayRequest: true }` message once its listener is ready. The
 * parent dedups, so the live + replayed copies collapse to one.
 */
const ERROR_CAPTURE_SHIM = `<script data-iframe-error-shim>
(function () {
  var buffer = [];
  var reportedNetworkErrors = typeof WeakSet === 'function' ? new WeakSet() : null;
  function emit(errorKind, message) {
    try {
      window.parent.postMessage(
        { __maicInteractive: true, kind: 'runtime-error', errorKind: errorKind, message: message },
        '*'
      );
    } catch (e) {}
  }
  function post(errorKind, message) {
    message = String(message).slice(0, 1200);
    if (buffer.length < 50) buffer.push([errorKind, message]);
    emit(errorKind, message);
  }
  function reportResourceFailure(target) {
    if (!target || !target.tagName) return false;
    var tag = String(target.tagName).toUpperCase();
    // A missing image or media file is usually a presentation fallback, not a
    // page-code failure. Script and stylesheet failures can disable the actual
    // interaction, so those are surfaced as retryable dependencies.
    if (tag !== 'SCRIPT' && tag !== 'LINK') return false;
    var url = target.src || target.href || '';
    if (!url) return false;
    post('dependency', 'Interactive ' + tag.toLowerCase() + ' resource could not load: ' + safeUrl(url));
    return true;
  }
  function safeUrl(value) {
    try {
      var parsed = new URL(String(value), document.baseURI);
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.origin + parsed.pathname;
    } catch (e) {
      return String(value).split(/[?#]/)[0];
    }
  }
  function redactUrls(value) {
    var source = String(value);
    var result = '';
    var cursor = 0;
    while (cursor < source.length) {
      var httpsIndex = source.indexOf('https://', cursor);
      var httpIndex = source.indexOf('http://', cursor);
      var start = httpsIndex < 0 ? httpIndex : httpIndex < 0 ? httpsIndex : Math.min(httpsIndex, httpIndex);
      if (start < 0) return result + source.slice(cursor);
      result += source.slice(cursor, start);
      var end = start;
      while (end < source.length) {
        var character = source.charAt(end);
        if (character === ' ' || character === '\\t' || character === '\\n' || character === '\\r' || character === '"' || character === "'" || character === '<' || character === '>') break;
        end++;
      }
      var candidate = source.slice(start, end);
      var suffix = '';
      while (candidate.length && '.,;:!?)]}'.indexOf(candidate.charAt(candidate.length - 1)) >= 0) {
        suffix = candidate.charAt(candidate.length - 1) + suffix;
        candidate = candidate.slice(0, -1);
      }
      result += safeUrl(candidate) + suffix;
      cursor = end;
    }
    return result;
  }
  function reportNetworkFailure(error, url) {
    var errorIsObject = error !== null && (typeof error === 'object' || typeof error === 'function');
    if (errorIsObject && reportedNetworkErrors && reportedNetworkErrors.has(error)) return;
    if (errorIsObject && reportedNetworkErrors) reportedNetworkErrors.add(error);
    var location = url ? ' (' + safeUrl(url) + ')' : '';
    var detail = error && (error.message || error.name) || 'network request failed';
    detail = redactUrls(detail);
    post('dependency', 'Interactive network request failed' + location + ': ' + detail);
  }
  window.addEventListener('message', function (e) {
    var d = e && e.data;
    if (d && d.__maicErrorReplayRequest === true) {
      for (var i = 0; i < buffer.length; i++) emit(buffer[i][0], buffer[i][1]);
    }
    if (e.source === window.parent && d && d.__maicRetryDependency === true) {
      // A failed request cannot safely be mapped back to an arbitrary button:
      // clicking it again can advance a game or submit the same answer twice.
      // The host explicitly labels this action as reloading the current page.
      window.location.reload();
    }
  });
  window.addEventListener('error', function (e) {
    if (e && reportResourceFailure(e.target)) return;
    if (e && e.message) {
      // Browsers report this layout diagnostic as an ErrorEvent even when the
      // page continues to run. Treating it as a fatal iframe error hides a
      // working interactive scene behind the runtime-error banner.
      if (/^ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)\.?$/.test(String(e.message).trim())) return;
      var message = String(e.message).trim();
      if (message === 'Script error.' && !e.filename) {
        message = 'A cross-origin script failed; the browser hid its source details.';
      }
      post('error', message + (e.filename ? ' (' + e.filename + ':' + (e.lineno || 0) + ')' : ''));
    } else if (e && e.target && (e.target.src || e.target.href)) {
      reportResourceFailure(e.target);
    }
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason;
    var rejectionName = r && (r.name || r.constructor && r.constructor.name);
    var rejectionMessage = (r && (r.message || r.stack)) || String(r || '');
    if (rejectionName === 'AbortError') return;
    if (
      /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(String(rejectionMessage))
    ) {
      reportNetworkFailure(r);
      return;
    }
    post('unhandledrejection', (r && (r.stack || r.message)) || r || 'unhandled promise rejection');
  });
  if (typeof window.fetch === 'function') {
    var nativeFetch = window.fetch;
    window.fetch = function () {
      var request = arguments[0];
      var requestUrl = typeof request === 'string' ? request : request && request.url;
      var result;
      try {
        result = nativeFetch.apply(this, arguments);
      } catch (error) {
        reportNetworkFailure(error, requestUrl);
        throw error;
      }
      return Promise.resolve(result).then(function (response) {
        if (response && (response.status === 408 || response.status === 429 || response.status >= 500)) {
          post('dependency', 'Interactive service returned HTTP ' + response.status + (requestUrl ? ' (' + safeUrl(requestUrl) + ')' : ''));
        }
        return response;
      }, function (error) {
        if (!error || error.name !== 'AbortError') reportNetworkFailure(error, requestUrl);
        throw error;
      });
    };
  }
  if (window.XMLHttpRequest && window.XMLHttpRequest.prototype) {
    var xhrPrototype = window.XMLHttpRequest.prototype;
    var nativeXhrOpen = xhrPrototype.open;
    var nativeXhrSend = xhrPrototype.send;
    if (typeof nativeXhrOpen === 'function' && typeof nativeXhrSend === 'function') {
      xhrPrototype.open = function (method, url) {
        this.__maicRequestUrl = url;
        return nativeXhrOpen.apply(this, arguments);
      };
      xhrPrototype.send = function () {
        var xhr = this;
        var requestUrl = xhr.__maicRequestUrl;
        xhr.addEventListener('load', function () {
          if (xhr.status === 408 || xhr.status === 429 || xhr.status >= 500) {
            post('dependency', 'Interactive service returned HTTP ' + xhr.status + (requestUrl ? ' (' + safeUrl(requestUrl) + ')' : ''));
          }
        });
        xhr.addEventListener('error', function () {
          reportNetworkFailure({ name: 'NetworkError', message: 'XMLHttpRequest failed' }, requestUrl);
        });
        xhr.addEventListener('timeout', function () {
          reportNetworkFailure({ name: 'TimeoutError', message: 'XMLHttpRequest timed out' }, requestUrl);
        });
        return nativeXhrSend.apply(this, arguments);
      };
    }
  }
  try {
    var c = window.console;
    if (c && c.error) {
      var _ce = c.error;
      c.error = function () {
        try { post('console.error', Array.prototype.map.call(arguments, function (a) { return (a && a.stack) || String(a); }).join(' ')); } catch (e) {}
        return _ce.apply(c, arguments);
      };
    }
  } catch (e) {}
})();
</script>`;

/** Parent-controlled playback speed for animations inside the iframe. */
const PLAYBACK_SPEED_SHIM = `<script data-iframe-playback-speed-shim>
(function () {
  var playbackRate = 1;
  var nativeRaf = typeof window.requestAnimationFrame === 'function' ? window.requestAnimationFrame.bind(window) : null;
  var nativeSetTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);
  var readNow = window.performance && typeof window.performance.now === 'function'
    ? window.performance.now.bind(window.performance)
    : Date.now;
  var lastVirtualPerformanceTime = readNow();
  var virtualPerformanceTime = lastVirtualPerformanceTime;
  var nativeDateNow = window.Date.now.bind(window.Date);
  var lastVirtualDateTime = nativeDateNow();
  var virtualDateTime = lastVirtualDateTime;
  var nextTimerId = -1;
  var timers = Object.create(null);

  function readVirtualPerformanceNow() {
    var now = readNow();
    virtualPerformanceTime += Math.max(0, now - lastVirtualPerformanceTime) * playbackRate;
    lastVirtualPerformanceTime = now;
    return virtualPerformanceTime;
  }
  function readVirtualDateNow() {
    var now = nativeDateNow();
    virtualDateTime += (now - lastVirtualDateTime) * playbackRate;
    lastVirtualDateTime = now;
    return virtualDateTime;
  }
  try {
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: readVirtualPerformanceNow
    });
  } catch (e) {
    try { window.performance.now = readVirtualPerformanceNow; } catch (ignored) {}
  }
  window.Date.now = readVirtualDateNow;

  function invoke(entry) {
    if (typeof entry.callback === 'function') entry.callback.apply(window, entry.args);
    else if (typeof entry.callback === 'string') window.eval(entry.callback);
  }
  function schedule(entry, virtualDelay) {
    entry.virtualDelay = Math.max(0, virtualDelay);
    entry.scheduledAt = readNow();
    entry.nativeId = nativeSetTimeout(function () {
      if (!entry.active) return;
      if (!entry.interval) {
        entry.active = false;
        delete timers[entry.id];
      }
      try { invoke(entry); }
      finally {
        if (entry.interval && entry.active) schedule(entry, entry.delay);
      }
    }, entry.virtualDelay / playbackRate);
  }
  function createTimer(callback, delay, args, interval) {
    var numericDelay = Number(delay);
    if (!isFinite(numericDelay) || numericDelay < 0) numericDelay = 0;
    numericDelay = Math.min(numericDelay, 2147483647);
    var id = nextTimerId--;
    var entry = { id: id, callback: callback, args: args, delay: numericDelay, interval: interval, active: true };
    timers[id] = entry;
    schedule(entry, numericDelay);
    return id;
  }
  function clearManagedTimer(id) {
    var entry = timers[id];
    if (!entry) return false;
    entry.active = false;
    nativeClearTimeout(entry.nativeId);
    delete timers[id];
    return true;
  }
  function applyAnimationRate(target) {
    try {
      var animations = target && typeof target.getAnimations === 'function'
        ? target.getAnimations()
        : (document.getAnimations ? document.getAnimations() : []);
      animations.forEach(function (animation) { animation.playbackRate = playbackRate; });
    } catch (e) {}
  }
  function setPlaybackRate(nextRate) {
    if (nextRate !== 0.25 && nextRate !== 0.5 && nextRate !== 1 && nextRate !== 2) return;
    if (nextRate === playbackRate) return;
    readVirtualPerformanceNow();
    readVirtualDateNow();
    var previousRate = playbackRate;
    var now = readNow();
    playbackRate = nextRate;
    Object.keys(timers).forEach(function (key) {
      var entry = timers[key];
      var elapsed = Math.max(0, now - entry.scheduledAt);
      var remainingVirtual = Math.max(0, entry.virtualDelay - elapsed * previousRate);
      nativeClearTimeout(entry.nativeId);
      schedule(entry, remainingVirtual);
    });
    applyAnimationRate(document);
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data;
    if (event.source !== window.parent || !data || data.__maicInteractivePlaybackSpeed !== true) return;
    setPlaybackRate(data.rate);
  });

  if (nativeRaf) {
    window.requestAnimationFrame = function (callback) {
      return nativeRaf(function () {
        // Use the same clock as animation start times and account for every
        // rate change, including changes made while no frame was scheduled.
        callback(readVirtualPerformanceNow());
      });
    };
  }

  var nativeAnimate = window.Element && window.Element.prototype.animate;
  if (nativeAnimate) {
    window.Element.prototype.animate = function () {
      var animation = nativeAnimate.apply(this, arguments);
      try { animation.playbackRate = playbackRate; } catch (e) {}
      return animation;
    };
  }
  if (document.addEventListener) {
    document.addEventListener('animationstart', function (event) { applyAnimationRate(event.target); }, true);
    document.addEventListener('transitionrun', function (event) { applyAnimationRate(event.target); }, true);
  }

  window.setTimeout = function (callback, delay) {
    return createTimer(callback, delay, Array.prototype.slice.call(arguments, 2), false);
  };
  window.setInterval = function (callback, delay) {
    return createTimer(callback, delay, Array.prototype.slice.call(arguments, 2), true);
  };
  window.clearTimeout = function (id) {
    if (!clearManagedTimer(id)) nativeClearTimeout(id);
  };
  window.clearInterval = function (id) {
    if (!clearManagedTimer(id)) nativeClearInterval(id);
  };
})();
</script>`;

/** Dormant-by-default picker installed into generated interactive documents. */
const ELEMENT_PICKER_SHIM = `<script data-iframe-element-picker-shim>
(function () {
  if (window.__maicElementPickerInstalled) return;
  window.__maicElementPickerInstalled = true;
  var armed = false;
  var mode = null;
  var selectors = [];
  var selectedSelector = null;
  var selectedHandle = null;
  var invalidSelectedSelector = null;
  var root = null;
  var hoverBox = null;
  var selectedBox = null;
  var candidate = null;
  var raf = null;
  var stableIdPattern = /^[A-Za-z][A-Za-z0-9_-]{0,126}$/;
  var excludedTags = ${JSON.stringify(INTERACTIVE_REFERENCE_EXCLUDED_TAG_LOOKUP)};
  function emit(message) {
    try { window.parent.postMessage(message, '*'); } catch (e) {}
  }
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, function (char) { return '\\\\' + char; });
  }
  function unique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
  }
  function selectorFor(element) {
    if (element.id) {
      var byId = '#' + cssEscape(element.id);
      if (unique(byId)) return byId;
    }
    var tag = element.tagName.toLowerCase();
    if (element.classList && element.classList.length) {
      var classes = Array.prototype.slice.call(element.classList, 0, 3).map(cssEscape);
      if (classes.length) {
        var byClass = tag + '.' + classes.join('.');
        if (unique(byClass)) return byClass;
      }
    }
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var nodeTag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (!parent) break;
      var sameTag = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      var part = nodeTag;
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      parts.unshift(part);
      var path = parts.join(' > ');
      if (unique(path)) return path;
      node = parent;
    }
    return parts.join(' > ') || tag;
  }
  function playbackRootFor(element) {
    var node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var tag = node.tagName.toLowerCase();
      var id = node.getAttribute('id');
      if (!excludedTags[tag] && id && stableIdPattern.test(id)) {
        var selector = '#' + id;
        if (unique(selector)) return node;
      }
      node = node.parentElement;
    }
    return null;
  }
  function ensureRoot() {
    if (root && root.isConnected) return;
    root = document.createElement('div');
    root.setAttribute('data-maic-element-picker-overlay', '');
    root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
    hoverBox = document.createElement('div');
    hoverBox.style.cssText = 'display:none;position:absolute;border:2px solid #7c3aed;background:rgba(124,58,237,.10);box-sizing:border-box;border-radius:3px;pointer-events:none;';
    root.appendChild(hoverBox);
    selectedBox = document.createElement('div');
    selectedBox.setAttribute('data-maic-picker-selected', '');
    selectedBox.style.cssText = 'display:none;position:absolute;border:3px solid #7c3aed;background:rgba(124,58,237,.10);box-sizing:border-box;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.9);pointer-events:none;';
    root.appendChild(selectedBox);
    (document.body || document.documentElement).appendChild(root);
  }
  function removeRoot() {
    if (root) root.remove();
    root = null;
    hoverBox = null;
    selectedBox = null;
  }
  function position(node, element) {
    var rect = element.getBoundingClientRect();
    node.style.left = (rect.left + window.scrollX) + 'px';
    node.style.top = (rect.top + window.scrollY) + 'px';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
  }
  function isOverlay(element) {
    return !!(element && element.closest && element.closest('[data-maic-element-picker-overlay]'));
  }
  function selectable(element) {
    return !!element && element.nodeType === 1 && element !== document.documentElement && element !== document.body && !isOverlay(element);
  }
  function eventElement(event) {
    if (selectable(event.target)) return event.target;
    return document.elementFromPoint(event.clientX, event.clientY);
  }
  function validateSelectedHandle() {
    if (!selectedSelector || invalidSelectedSelector === selectedSelector || !selectedHandle) return null;
    var matches = [];
    try { matches = document.querySelectorAll(selectedSelector); } catch (e) {}
    if (!selectedHandle.isConnected || matches.length !== 1 || matches[0] !== selectedHandle) {
      invalidSelectedSelector = selectedSelector;
      selectedHandle = null;
      return null;
    }
    return selectedHandle;
  }
  function draw() {
    raf = null;
    if (!armed && !selectedSelector) { removeRoot(); return; }
    ensureRoot();
    if (armed && candidate && candidate.isConnected) {
      position(hoverBox, candidate);
      hoverBox.style.display = 'block';
    } else {
      hoverBox.style.display = 'none';
    }
    var selected = validateSelectedHandle();
    if (selected) {
      position(selectedBox, selected);
      selectedBox.style.display = 'block';
    } else {
      selectedBox.style.display = 'none';
    }
    Array.prototype.slice.call(root.querySelectorAll('[data-maic-picker-pin]')).forEach(function (node) { node.remove(); });
    selectors.forEach(function (selector, index) {
      var element = null;
      try { element = document.querySelector(selector); } catch (e) {}
      if (!selectable(element)) return;
      var badge = document.createElement('div');
      badge.setAttribute('data-maic-picker-pin', '');
      badge.textContent = String(index + 1);
      badge.style.cssText = 'position:absolute;display:grid;place-items:center;width:20px;height:20px;border-radius:999px;background:#7c3aed;color:white;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.35);font:700 11px/1 system-ui,sans-serif;box-sizing:border-box;pointer-events:none;';
      var rect = element.getBoundingClientRect();
      badge.style.left = Math.max(0, rect.left + window.scrollX - 8) + 'px';
      badge.style.top = Math.max(0, rect.top + window.scrollY - 8) + 'px';
      root.appendChild(badge);
    });
    if (selectedSelector && selectedHandle && invalidSelectedSelector !== selectedSelector) scheduleDraw();
  }
  function scheduleDraw() {
    if (raf == null) raf = window.requestAnimationFrame(draw);
  }
  function onPointerMove(event) {
    var element = eventElement(event);
    candidate = mode === 'playback-stable-id'
      ? playbackRootFor(element)
      : (selectable(element) ? element : null);
    scheduleDraw();
  }
  function block(event) {
    if (!armed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onClick(event) {
    if (!armed) return;
    block(event);
    var target = eventElement(event);
    var element = mode === 'playback-stable-id'
      ? playbackRootFor(target)
      : (selectable(target) ? target : null);
    if (!element) return;
    candidate = element;
    var selector = mode === 'playback-stable-id' ? '#' + element.id : selectorFor(element);
    if (mode === 'playback-stable-id') {
      selectedSelector = selector;
      selectedHandle = element;
      invalidSelectedSelector = null;
      var pickedMode = mode;
      // Playback selection is single-shot. Disarm locally before the parent
      // projection returns, while retaining the exact clicked Element handle
      // for the persistent outline.
      disarm();
      emit({ __maicInteractive: true, kind: 'element-picked', mode: pickedMode, selector: selector });
    } else {
      emit({
        __maicInteractive: true,
        kind: 'element-picked',
        mode: mode,
        selector: selector,
        outerHTML: String(element.outerHTML || '').slice(0, 2048),
        text: String(typeof element.innerText === 'string' ? element.innerText : '').slice(0, 200)
      });
    }
    scheduleDraw();
  }
  function onKey(event) {
    if (!armed || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    var cancelledMode = mode;
    disarm();
    emit({ __maicInteractive: true, kind: 'element-picker-disarmed', mode: cancelledMode });
  }
  function arm(nextMode) {
    if (nextMode !== 'editor' && nextMode !== 'playback-stable-id') return;
    mode = nextMode;
    if (armed) { scheduleDraw(); return; }
    armed = true;
    ensureRoot();
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('submit', block, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', scheduleDraw, true);
    window.addEventListener('resize', scheduleDraw);
    scheduleDraw();
  }
  function disarm() {
    if (!armed) { mode = null; return; }
    armed = false;
    mode = null;
    candidate = null;
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('submit', block, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', scheduleDraw, true);
    window.removeEventListener('resize', scheduleDraw);
    if (raf != null) { window.cancelAnimationFrame(raf); raf = null; }
    if (selectedSelector) scheduleDraw();
    else removeRoot();
  }
  function syncSelectedSelector(nextSelector) {
    if (nextSelector === selectedSelector) return;
    selectedSelector = nextSelector;
    selectedHandle = null;
    invalidSelectedSelector = null;
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event && event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'element-picker:arm') arm(data.mode);
    else if (data.type === 'element-picker:disarm') disarm();
    else if (data.type === 'element-picker:sync') {
      selectors = Array.isArray(data.selectors) ? data.selectors.filter(function (item) { return typeof item === 'string'; }) : [];
      syncSelectedSelector(typeof data.selectedSelector === 'string' ? data.selectedSelector : null);
      if (armed || selectedSelector) scheduleDraw();
      else {
        if (raf != null) { window.cancelAnimationFrame(raf); raf = null; }
        removeRoot();
      }
    }
  });
})();
</script>`;

/** Move authored DOM elements in edit mode without exposing the sandbox DOM to the host. */
const LAYOUT_EDITOR_SHIM = `<script data-iframe-layout-editor-shim>
(function () {
  if (window.__maicLayoutEditorInstalled) return;
  window.__maicLayoutEditorInstalled = true;
  var active = false;
  var root = null;
  var box = null;
  var candidate = null;
  var selected = null;
  var dragging = null;
  var changes = Object.create(null);
  var raf = null;
  var previousCursor = '';
  var previousCursorPriority = '';
  function emit(message) {
    try { window.parent.postMessage(message, '*'); } catch (e) {}
  }
  function unique(selector) {
    try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
  }
  function safeName(value) {
    return /^[A-Za-z][A-Za-z0-9_-]{0,126}$/.test(value || '');
  }
  function layoutSelectorFor(element) {
    if (safeName(element.id)) {
      var byId = '#' + element.id;
      if (unique(byId)) return byId;
    }
    var tag = element.tagName.toLowerCase();
    var classes = element.classList
      ? Array.prototype.filter.call(element.classList, safeName).slice(0, 3)
      : [];
    if (classes.length) {
      var byClass = tag + '.' + classes.join('.');
      if (unique(byClass)) return byClass;
    }
    var parts = [];
    var node = element;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      var nodeTag = node.tagName.toLowerCase();
      if (!/^[a-z][a-z0-9-]*$/.test(nodeTag)) return null;
      var parent = node.parentElement;
      if (!parent) break;
      var sameTag = Array.prototype.filter.call(parent.children, function (child) {
        return child.tagName === node.tagName;
      });
      var part = nodeTag;
      if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      parts.unshift(part);
      var path = parts.join(' > ');
      if (unique(path)) return path;
      node = parent;
    }
    return null;
  }
  function isOverlay(element) {
    return !!(element && element.closest && element.closest('[data-maic-layout-editor-overlay]'));
  }
  function selectable(element) {
    if (!element || element.nodeType !== 1 || element === document.documentElement || element === document.body) return false;
    if (isOverlay(element)) return false;
    var tag = element.tagName.toLowerCase();
    return tag !== 'script' && tag !== 'style' && tag !== 'link' && tag !== 'meta' && tag !== 'template';
  }
  function eventElement(event) {
    if (selectable(event.target)) return event.target;
    return document.elementFromPoint(event.clientX, event.clientY);
  }
  function groupTargetFor(element) {
    if (!selectable(element)) return element;
    var origin = element.getBoundingClientRect();
    var node = element;
    while (node.parentElement && node.parentElement !== document.body && node.parentElement !== document.documentElement) {
      var parent = node.parentElement;
      var rect = parent.getBoundingClientRect();
      var sizeIsComparable = rect.width <= origin.width * 4 + 32 && rect.height <= origin.height * 4 + 32;
      var hasSiblingContent = parent.children.length > 1 && String(parent.innerText || parent.textContent || '').trim().length > 0;
      if (sizeIsComparable && hasSiblingContent) return parent;
      if (!sizeIsComparable) break;
      node = parent;
    }
    return element;
  }
  function parseTranslate(value) {
    if (!value || value === 'none') return { x: 0, y: 0 };
    var values = value.match(/-?(?:\\d+(?:\\.\\d+)?|\\.\\d+)px/g) || [];
    return {
      x: values.length > 0 ? parseFloat(values[0]) : 0,
      y: values.length > 1 ? parseFloat(values[1]) : 0
    };
  }
  function position(node, element) {
    var rect = element.getBoundingClientRect();
    node.style.left = rect.left + 'px';
    node.style.top = rect.top + 'px';
    node.style.width = rect.width + 'px';
    node.style.height = rect.height + 'px';
  }
  function ensureRoot() {
    if (root && root.isConnected) return;
    root = document.createElement('div');
    root.setAttribute('data-maic-layout-editor-overlay', '');
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    box = document.createElement('div');
    box.style.cssText = 'display:none;position:absolute;border:2px solid #7c3aed;background:rgba(124,58,237,.08);box-sizing:border-box;border-radius:3px;pointer-events:none;';
    root.appendChild(box);
    (document.body || document.documentElement).appendChild(root);
  }
  function draw() {
    raf = null;
    if (!active) return;
    ensureRoot();
    var element = dragging ? dragging.element : (selected && selected.isConnected ? selected : candidate);
    if (element && element.isConnected) {
      position(box, element);
      box.style.display = 'block';
    } else {
      box.style.display = 'none';
    }
    if (dragging) scheduleDraw();
  }
  function scheduleDraw() {
    if (raf == null) raf = window.requestAnimationFrame(draw);
  }
  function changeFor(element, selector) {
    var change = changes[selector];
    if (change && change.element === element) return change;
    var computed = parseTranslate(window.getComputedStyle(element).translate);
    change = {
      selector: selector,
      element: element,
      x: computed.x,
      y: computed.y,
      originalInline: element.style.getPropertyValue('translate'),
      originalPriority: element.style.getPropertyPriority('translate')
    };
    changes[selector] = change;
    return change;
  }
  function applyChange(change, x, y) {
    change.x = Math.max(-4096, Math.min(4096, x));
    change.y = Math.max(-4096, Math.min(4096, y));
    change.element.style.setProperty('translate', change.x + 'px ' + change.y + 'px', 'important');
  }
  function block(event) {
    if (!active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function onPointerDown(event) {
    if (!active || event.button !== 0) return;
    var element = eventElement(event);
    if (!selectable(element)) return;
    if (!event.altKey) element = groupTargetFor(element);
    var selector = layoutSelectorFor(element);
    if (!selector) return;
    block(event);
    var change = changeFor(element, selector);
    dragging = {
      element: element,
      selector: selector,
      change: change,
      startX: event.clientX,
      startY: event.clientY,
      originX: change.x,
      originY: change.y,
      moved: false
    };
    selected = element;
    try { element.setPointerCapture(event.pointerId); } catch (e) {}
    scheduleDraw();
  }
  function onPointerMove(event) {
    if (!active) return;
    if (!dragging) {
      var target = eventElement(event);
      if (selectable(target) && !event.altKey) target = groupTargetFor(target);
      candidate = selectable(target) ? target : null;
      scheduleDraw();
      return;
    }
    block(event);
    var dx = event.clientX - dragging.startX;
    var dy = event.clientY - dragging.startY;
    if (Math.abs(dx) + Math.abs(dy) > 1) dragging.moved = true;
    applyChange(dragging.change, dragging.originX + dx, dragging.originY + dy);
    scheduleDraw();
  }
  function onPointerUp(event) {
    if (!active || !dragging) return;
    block(event);
    var completed = dragging;
    dragging = null;
    if (completed.moved) {
      emit({
        __maicInteractive: true,
        kind: 'layout-change',
        mode: 'layout',
        override: { selector: completed.selector, x: completed.change.x, y: completed.change.y }
      });
    }
    scheduleDraw();
  }
  function onClick(event) { block(event); }
  function onSubmit(event) { block(event); }
  function onKey(event) {
    if (!active || event.key !== 'Escape') return;
    block(event);
    disarm(true);
    emit({ __maicInteractive: true, kind: 'layout-editor-cancelled', mode: 'layout' });
  }
  function arm() {
    if (active) return;
    active = true;
    previousCursor = document.documentElement.style.getPropertyValue('cursor');
    previousCursorPriority = document.documentElement.style.getPropertyPriority('cursor');
    document.documentElement.style.setProperty('cursor', 'move', 'important');
    ensureRoot();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove, true);
    window.addEventListener('pointerup', onPointerUp, true);
    window.addEventListener('pointercancel', onPointerUp, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('submit', onSubmit, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', scheduleDraw, true);
    window.addEventListener('resize', scheduleDraw);
    scheduleDraw();
  }
  function disarm(restore) {
    if (!active) return;
    active = false;
    dragging = null;
    candidate = null;
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('submit', onSubmit, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', scheduleDraw, true);
    window.removeEventListener('resize', scheduleDraw);
    if (raf != null) { window.cancelAnimationFrame(raf); raf = null; }
    if (previousCursor) document.documentElement.style.setProperty('cursor', previousCursor, previousCursorPriority);
    else document.documentElement.style.removeProperty('cursor');
    if (restore) {
      Object.keys(changes).forEach(function (selector) {
        var change = changes[selector];
        if (!change.element || !change.element.isConnected) return;
        if (change.originalInline) change.element.style.setProperty('translate', change.originalInline, change.originalPriority);
        else change.element.style.removeProperty('translate');
      });
      selected = null;
    }
    changes = Object.create(null);
    if (root) root.remove();
    root = null;
    box = null;
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return;
    var data = event && event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'interactive-layout:arm') arm();
    else if (data.type === 'interactive-layout:disarm') disarm(true);
  });
})();
</script>`;

/**
 * Keep the authored page's primary progression control reachable when a generated
 * game lays it out below the iframe viewport. The proxy deliberately clicks the
 * original control, so the game's own validation, scoring and level-transition
 * logic remain authoritative.
 */
const ACTION_RESCUE_SHIM = `<script data-iframe-action-rescue-shim>
(function () {
  if (window.__maicActionRescueInstalled) return;
  window.__maicActionRescueInstalled = true;
  var root = null;
  var proxy = null;
  var source = null;
  var frame = null;
  var actionPattern = /(?:提交|确认(?:答案|本题)?|完成本题|下一(?:题|关|步)|继续|submit|confirm|check(?: answer)?|next(?: question| level)?|continue)/i;
  var startPattern = /(?:开始|开始挑战|进入游戏|重新挑战|重试|再来一次|start|restart|retry|play (?:now|again))/i;

  function textOf(element) {
    return String(element.getAttribute('aria-label') || element.value || element.textContent || '').replace(/\\s+/g, ' ').trim();
  }
  function rendered(element) {
    if (!element || !element.isConnected) return false;
    var style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) === 0)) return false;
    var rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }
  function insideViewport(element) {
    var rect = element.getBoundingClientRect();
    if (!(rect.top >= 8 && rect.left >= 8 && rect.bottom <= window.innerHeight - 8 && rect.right <= window.innerWidth - 8)) return false;
    var node = element.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || (style.opacity !== '' && Number(style.opacity) === 0)) return false;
      var clipsX = /(?:hidden|clip|auto|scroll)/.test(style.overflowX || style.overflow || '');
      var clipsY = /(?:hidden|clip|auto|scroll)/.test(style.overflowY || style.overflow || '');
      if (clipsX || clipsY) {
        var parentRect = node.getBoundingClientRect();
        if ((clipsX && (rect.right <= parentRect.left || rect.left >= parentRect.right)) ||
            (clipsY && (rect.bottom <= parentRect.top || rect.top >= parentRect.bottom))) return false;
      }
      node = node.parentElement;
    }
    if (typeof document.elementFromPoint === 'function') {
      var hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit && hit !== element && !element.contains(hit)) return false;
    }
    return true;
  }
  function controls() {
    return Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]')).filter(function (element) {
      return !element.closest('[data-maic-action-rescue]');
    });
  }
  function visibleStartExists(elements) {
    return elements.some(function (element) {
      return startPattern.test(textOf(element)) && rendered(element) && insideViewport(element) && !element.disabled;
    });
  }
  function findSource(elements) {
    var hiddenFallback = null;
    for (var i = 0; i < elements.length; i++) {
      var element = elements[i];
      if (!actionPattern.test(textOf(element))) continue;
      if (rendered(element)) {
        if (!insideViewport(element)) return element;
        continue;
      }
      if (!hiddenFallback && !element.disabled) hiddenFallback = element;
    }
    return hiddenFallback;
  }
  function ensureProxy() {
    if (proxy && proxy.isConnected) return;
    root = document.createElement('div');
    root.setAttribute('data-maic-action-rescue', '');
    root.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483600;pointer-events:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;';
    proxy = document.createElement('button');
    proxy.type = 'button';
    proxy.style.cssText = 'display:none;min-width:132px;min-height:46px;padding:10px 18px;border:1px solid rgba(255,255,255,.42);border-radius:12px;background:#7c3aed;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3);font:700 15px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;pointer-events:auto;';
    proxy.addEventListener('click', function () {
      if (!source || source.disabled) return;
      source.click();
      schedule();
    });
    root.appendChild(proxy);
    (document.body || document.documentElement).appendChild(root);
  }
  function refresh() {
    frame = null;
    if (proxy) proxy.style.display = 'none';
    var pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay && rendered(pauseOverlay)) {
      source = null;
      return;
    }
    var elements = controls();
    source = visibleStartExists(elements) ? null : findSource(elements);
    if (!source) {
      if (proxy) proxy.style.display = 'none';
      return;
    }
    ensureProxy();
    proxy.textContent = textOf(source) || 'Confirm';
    proxy.disabled = !!source.disabled;
    proxy.style.display = 'block';
    proxy.style.opacity = source.disabled ? '.55' : '1';
    proxy.style.cursor = source.disabled ? 'not-allowed' : 'pointer';
  }
  function schedule() {
    if (frame != null) return;
    frame = window.requestAnimationFrame(refresh);
  }
  function init() {
    ensureProxy();
    refresh();
    new MutationObserver(schedule).observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'disabled', 'aria-hidden']
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    window.__maicActionRescueRefresh = refresh;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
</script>`;

/**
 * Generated games sometimes display a full-screen pause overlay while leaving
 * their working pause toggle behind it. Keep the paused state visible without
 * letting that overlay obscure or intercept the game's other controls. Reuse
 * the original pause button as the resume button instead of adding a floating
 * control that can cover the game's content.
 */
const PAUSE_RESCUE_SHIM = `<script data-iframe-pause-rescue-shim>
(function () {
  if (window.__maicPauseRescueInstalled) return;
  window.__maicPauseRescueInstalled = true;

  function install() {
    var overlay = document.getElementById('pause-overlay');
    if (!overlay) return;
    var controls = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], input[type="button"]'));
    var hasResume = controls.some(function (control) {
      return overlay.contains(control) && /(?:继续|恢复|resume|continue)/i.test(String(control.textContent || control.value || control.getAttribute('aria-label') || ''));
    });
    if (hasResume) return;
    var pauseControl = controls.find(function (control) {
      return !overlay.contains(control) && /\\btogglePause\\s*\\(/.test(control.getAttribute('onclick') || '');
    });
    if (!pauseControl) return;

    // The generated overlay covers the entire game. Keep its pause message, but
    // let the original controls remain visible and reachable while paused.
    overlay.style.background = 'transparent';
    overlay.style.backdropFilter = 'none';
    overlay.style.setProperty('-webkit-backdrop-filter', 'none');
    overlay.style.pointerEvents = 'none';
    var pauseLabel = pauseControl.textContent;
    function updateLabel() {
      var paused = !overlay.hidden && !overlay.classList.contains('hidden') && window.getComputedStyle(overlay).display !== 'none';
      pauseControl.textContent = paused ? '▶ 继续游戏 Resume' : pauseLabel;
    }
    new MutationObserver(updateLabel).observe(overlay, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    updateLabel();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
</script>`;

/**
 * Some generated SVG diagrams place an absolutely positioned detail sidebar
 * over a full-width diagram. Reserve the sidebar's width while it is open so
 * the SVG viewBox scales all nodes into the visible area.
 */
const DIAGRAM_SIDEBAR_SHIM = `<script data-iframe-diagram-sidebar-shim>
(function () {
  if (window.__maicDiagramSidebarInstalled) return;
  window.__maicDiagramSidebarInstalled = true;

  function install() {
    var diagram = document.querySelector('.diagram-container > svg#diagram[viewBox]');
    var sidebar = document.querySelector('.sidebar');
    if (!diagram || !sidebar) return;
    var container = diagram.parentElement;
    if (!container || window.getComputedStyle(sidebar).position !== 'absolute') return;

    function sync() {
      var style = window.getComputedStyle(sidebar);
      var open = !sidebar.hidden && !sidebar.classList.contains('collapsed') &&
        style.display !== 'none' && style.visibility !== 'hidden';
      var width = open ? sidebar.getBoundingClientRect().width || parseFloat(style.width) || 0 : 0;
      container.style.right = Math.ceil(width) + 'px';
    }

    container.style.transition = 'right 0.3s ease';
    new MutationObserver(sync).observe(sidebar, {
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
    window.addEventListener('resize', sync);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();
</script>`;

/**
 * Patch embedded HTML to display correctly inside an iframe.
 *
 * Injects a runtime-error capture shim + a storage shim (so sandboxed pages that
 * use localStorage don't crash) plus CSS that ensures proper sizing and scrolling
 * behavior when HTML content is rendered via srcDoc in an iframe. The shims are
 * placed first so they run before the page's own scripts (error capture first, so
 * it also observes the storage shim).
 */
/**
 * Identity for the observation reader shim. Supplied by the caller and never
 * generated here: it is serialized into the returned document, so a value that
 * changed per call would churn the iframe `srcDoc` and break pooling keep-alive.
 * Omitted by consumers that produce standalone documents (video export), where
 * no parent ever asks and the bytes count against an export size cap.
 */
export function patchHtmlForIframe(html: string, observation?: ObservationIdentity): string {
  const iframeCss = `<style data-iframe-patch>
  html, body {
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    overflow-x: hidden;
    overflow-y: auto;
  }
  /* Fix min-h-screen: in iframes 100vh is the iframe height, which is correct,
     but ensure body actually fills it */
  body { min-height: 100vh; }
</style>`;

  const injection =
    '\n' +
    ERROR_CAPTURE_SHIM +
    '\n' +
    PLAYBACK_SPEED_SHIM +
    '\n' +
    ELEMENT_PICKER_SHIM +
    '\n' +
    LAYOUT_EDITOR_SHIM +
    '\n' +
    ACTION_RESCUE_SHIM +
    '\n' +
    PAUSE_RESCUE_SHIM +
    '\n' +
    DIAGRAM_SIDEBAR_SHIM +
    '\n' +
    STORAGE_SHIM +
    '\n' +
    iframeCss;

  const patched = injectIntoDocumentHead(orderMathScriptsBeforeAmd(html), injection);
  // Body end, not head: the reader captures the scope element as it installs.
  return observation ? withObservationResponder(patched, observation) : patched;
}
