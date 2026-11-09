'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createObservationSession } from '@/lib/interactive/observation-bridge';
import { createPortal } from 'react-dom';
import { useWidgetIframeStore } from '@/lib/store/widget-iframe';
import {
  useInteractiveIframePool,
  type IframePoolEntry,
} from '@/lib/store/interactive-iframe-pool';
import { useSceneRuntimeErrors } from '@/lib/store/scene-runtime-errors';
import { formatInteractiveRuntimeIssue } from '@/lib/interactive/runtime-error';
import {
  handleInteractiveLayoutEditorMessage,
  useInteractiveLayoutEditor,
} from '@/lib/store/interactive-layout-editor';
import {
  GENUI_LOGICAL_HEIGHT,
  GENUI_LOGICAL_WIDTH,
  fitGenUiViewport,
} from '@/lib/interactive/logical-viewport';
import { intersectClientBoxes } from '@/lib/edit/visible-client-rect';
import { useCanvasStore } from '@/lib/store/canvas';
import { useElementRefsStore } from '@/lib/store/element-refs';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  ELEMENT_REF_SELECTOR_MAX,
  ELEMENT_SNAPSHOT_MAX,
  INTERACTIVE_OUTERHTML_MAX,
  makeInteractiveElementRef,
} from '@/lib/workbench/element-refs';
import { InteractiveRuntimeErrorBanner } from './InteractiveRuntimeErrorBanner';

type InteractivePickerMessage = {
  __maicInteractive?: boolean;
  kind?: string;
  mode?: unknown;
  selector?: unknown;
  outerHTML?: unknown;
  text?: unknown;
};

type ElementPickerMode = 'editor' | 'playback-stable-id';
type InteractivePlaybackRate = 0.25 | 0.5 | 1 | 2;

const PLAYBACK_SPEED_CONTROL_HEIGHT = 36;
const PLAYBACK_SPEED_CONTROL_INSET = 12;

function getVisibleSlot(entry: IframePoolEntry) {
  if (!entry.rect) return null;
  const visible = intersectClientBoxes(entry.rect, entry.clip ?? entry.rect);
  if (!visible || visible.width <= 0 || visible.height <= 0) return null;
  return visible;
}

function getPlaybackSpeedControlStyle(slot: NonNullable<ReturnType<typeof getVisibleSlot>>) {
  return {
    position: 'fixed' as const,
    left: slot.left + PLAYBACK_SPEED_CONTROL_INSET,
    top: Math.max(
      slot.top + PLAYBACK_SPEED_CONTROL_INSET,
      slot.top + slot.height - PLAYBACK_SPEED_CONTROL_HEIGHT - PLAYBACK_SPEED_CONTROL_INSET,
    ),
    zIndex: 2,
  };
}

export function resolveInteractivePickerMode(
  editorArmed: boolean,
  playbackArmed: boolean,
): ElementPickerMode | null {
  if (playbackArmed) return 'playback-stable-id';
  if (editorArmed) return 'editor';
  return null;
}

export type PlaybackInteractivePickerState = {
  readonly sceneId: string;
  readonly active: boolean;
  readonly selectedSelector?: string;
};

export type PlaybackInteractiveComponentPick = {
  readonly sceneId: string;
  readonly selector: string;
};

const PLAYBACK_STABLE_ID_SELECTOR = /^#[A-Za-z][A-Za-z0-9_-]{0,126}$/u;

export function handlePlaybackInteractivePickerMessage(
  sceneId: string,
  armed: boolean,
  data: InteractivePickerMessage | undefined,
  onPick: (pick: PlaybackInteractiveComponentPick) => void,
  onCancel: () => void,
): boolean {
  if (!armed || !data || data.__maicInteractive !== true || data.mode !== 'playback-stable-id') {
    return false;
  }
  if (data.kind === 'element-picker-disarmed') {
    onCancel();
    return true;
  }
  if (
    data.kind !== 'element-picked' ||
    typeof data.selector !== 'string' ||
    !PLAYBACK_STABLE_ID_SELECTOR.test(data.selector)
  ) {
    return false;
  }
  onPick({ sceneId, selector: data.selector });
  return true;
}

/** Validate an untrusted iframe picker message and apply it to host-owned state. */
export function handleInteractivePickerMessage(
  sceneId: string,
  data: InteractivePickerMessage | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): boolean {
  if (!data || data.__maicInteractive !== true || data.mode !== 'editor') return false;
  const target = useCanvasStore.getState().pickTarget;
  const armed = target?.purpose === 'element-ref' && target.sceneId === sceneId;
  if (data.kind === 'element-picker-disarmed') {
    if (armed) useCanvasStore.getState().setPickTarget(null);
    return armed;
  }
  if (data.kind !== 'element-picked' || !armed) return false;
  if (
    typeof data.selector !== 'string' ||
    typeof data.outerHTML !== 'string' ||
    typeof data.text !== 'string'
  ) {
    return false;
  }
  const selector = data.selector.slice(0, ELEMENT_REF_SELECTOR_MAX);
  const outerHTML = data.outerHTML.slice(0, INTERACTIVE_OUTERHTML_MAX);
  const text = data.text.slice(0, ELEMENT_SNAPSHOT_MAX);
  if (!selector.trim() || !outerHTML.trim()) return false;
  const refsStore = useElementRefsStore.getState();
  if (refsStore.ownerSessionId !== target.ownerSessionId) return false;
  refsStore.toggle(
    makeInteractiveElementRef(target.stageId, sceneId, { selector, outerHTML, text }, t),
  );
  return true;
}

/**
 * Stable host for interactive scene iframes (#619).
 *
 * Mounted once at the `Stage` root — outside the mode-swap / scene subtree that
 * unmounts and remounts — so the iframe elements it renders survive Pro mode
 * toggles, scene switches, and any PlaybackChromeRoot remount. The in-tree
 * `InteractiveRenderer` is only a placeholder that registers content and reports
 * the on-screen rect; the actual iframes live here, portaled into a stable host
 * node and positioned over each scene's rect via `position: fixed`.
 *
 * Portal target follows `document.fullscreenElement` so the iframe stays inside
 * the fullscreen subtree during presentation mode (which calls requestFullscreen
 * on the playback stage, not on body); otherwise it lives on `document.body`.
 * A low z-index keeps it under Radix dialogs (e.g. the scene-switch confirm)
 * while still covering the canvas box during interactive playback AND Pro-mode
 * editing — the editor agent fixes interactive HTML, so the teacher must see the
 * live page while editing. Visibility is driven by the placeholder's ownership
 * (gone → hidden, never unmounted), so the document is preserved for a
 * zero-reload return.
 */
export function InteractiveIframeHost({
  playbackPicker,
  onPlaybackPick,
  onPlaybackCancel,
}: {
  readonly playbackPicker?: PlaybackInteractivePickerState | null;
  readonly onPlaybackPick?: (pick: PlaybackInteractiveComponentPick) => void;
  readonly onPlaybackCancel?: () => void;
}) {
  const entries = useInteractiveIframePool((s) => s.entries);
  const activeSceneId = useInteractiveIframePool((s) => s.activeSceneId);
  const reset = useInteractiveIframePool((s) => s.reset);
  const setActiveScene = useWidgetIframeStore((s) => s.setActiveScene);
  const layoutEditSceneId = useInteractiveLayoutEditor((s) => s.sceneId);
  const [playbackRate, setPlaybackRate] = useState<InteractivePlaybackRate>(1);
  const activeEntry = activeSceneId ? entries[activeSceneId] : undefined;
  const activeSlot = activeEntry ? getVisibleSlot(activeEntry) : null;

  // Portal into the fullscreen element when one is active (presentation mode
  // fullscreens the stage, and a body-portaled iframe would not be part of that
  // subtree, so it would vanish). Falls back to body otherwise.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    const sync = () => setPortalTarget(document.fullscreenElement ?? document.body);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  // Keep the messaging store's active scene in lock-step (its legacy fallback
  // path resolves the current widget by active scene when no id is passed).
  useEffect(() => {
    setActiveScene(activeSceneId);
  }, [activeSceneId, setActiveScene]);

  // The host is mounted once per classroom (inside Stage). When it unmounts —
  // e.g. on classroom switch — drop the pool so a new classroom doesn't briefly
  // render the previous one's stale iframes.
  useEffect(() => reset, [reset]);

  if (!portalTarget) return null;

  return createPortal(
    <>
      {Object.entries(entries).map(([sceneId, entry]) => (
        <PooledIframe
          key={sceneId}
          sceneId={sceneId}
          entry={entry}
          playbackRate={playbackRate}
          visible={entry.owner !== null && sceneId === activeSceneId}
          playbackArmed={Boolean(playbackPicker?.active && playbackPicker.sceneId === sceneId)}
          playbackSelectedSelector={
            playbackPicker?.sceneId === sceneId ? playbackPicker.selectedSelector : undefined
          }
          layoutEditing={layoutEditSceneId === sceneId}
          onPlaybackPick={onPlaybackPick}
          onPlaybackCancel={onPlaybackCancel}
        />
      ))}
      {activeEntry?.owner !== null && activeEntry?.srcDoc && activeSlot ? (
        <InteractivePlaybackSpeedControl
          rate={playbackRate}
          onRateChange={setPlaybackRate}
          style={getPlaybackSpeedControlStyle(activeSlot)}
        />
      ) : null}
    </>,
    portalTarget,
  );
}

function InteractivePlaybackSpeedControl({
  rate,
  onRateChange,
  style,
}: {
  readonly rate: InteractivePlaybackRate;
  readonly onRateChange: (rate: InteractivePlaybackRate) => void;
  readonly style: CSSProperties;
}) {
  const { t } = useI18n();

  return (
    <div
      role="group"
      data-testid="interactive-playback-speed"
      aria-label={t('roundtable.speed')}
      style={style}
      className="pointer-events-auto flex h-9 w-[120px] items-center justify-center gap-1 rounded-md border border-white/20 bg-gray-950/80 px-1.5 py-1 shadow-md backdrop-blur"
    >
      <button
        type="button"
        data-testid="interactive-playback-speed-decrease"
        aria-label={t('roundtable.slower')}
        title={t('roundtable.slower')}
        disabled={rate === 0.25}
        onClick={() => onRateChange(rate === 2 ? 1 : rate === 1 ? 0.5 : 0.25)}
        className="flex h-6 w-6 items-center justify-center rounded text-base font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        −
      </button>
      <span
        data-testid="interactive-playback-speed-value"
        aria-live="polite"
        className="min-w-9 text-center text-xs font-semibold tabular-nums text-white"
      >
        {rate}×
      </span>
      <button
        type="button"
        data-testid="interactive-playback-speed-increase"
        aria-label={t('roundtable.faster')}
        title={t('roundtable.faster')}
        disabled={rate === 2}
        onClick={() => onRateChange(rate === 0.25 ? 0.5 : rate === 0.5 ? 1 : 2)}
        className="flex h-6 w-6 items-center justify-center rounded text-base font-semibold text-white transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:text-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
      >
        +
      </button>
    </div>
  );
}

interface PooledIframeProps {
  readonly sceneId: string;
  readonly entry: IframePoolEntry;
  readonly playbackRate: InteractivePlaybackRate;
  readonly visible: boolean;
  readonly playbackArmed: boolean;
  readonly playbackSelectedSelector?: string;
  readonly layoutEditing: boolean;
  readonly onPlaybackPick?: (pick: PlaybackInteractiveComponentPick) => void;
  readonly onPlaybackCancel?: () => void;
}

/**
 * One persisted iframe. Stays mounted as long as its pool entry exists (only
 * evicted by LRU), so its document is preserved across scene/mode changes.
 * `srcDoc` / `src` come straight from the entry and only change when the
 * content changes — that is the single intended reload path.
 *
 * Security: the sandbox intentionally omits `allow-same-origin`.
 * Combining `allow-scripts` with `allow-same-origin` on a srcDoc iframe
 * effectively negates sandbox protections — the embedded document is treated
 * as same-origin with the parent and can access cookies, localStorage, and
 * the parent DOM. Since the HTML may originate from LLM output or imported
 * classroom JSON, keeping the iframe in a unique (null) origin prevents
 * any embedded script from reaching the host application's state.
 * postMessage communication (the only parent↔iframe channel used here)
 * works correctly with a null origin because the host sends with
 * targetOrigin='*'.
 */
function PooledIframe({
  sceneId,
  entry,
  playbackRate,
  visible,
  playbackArmed,
  playbackSelectedSelector,
  layoutEditing,
  onPlaybackPick,
  onPlaybackCancel,
}: PooledIframeProps) {
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const runtimeErrors = useSceneRuntimeErrors((state) => state.errors[sceneId]);
  const runtimeErrorSignature = runtimeErrors?.map(formatInteractiveRuntimeIssue).join('\n') ?? '';
  const [dismissedRuntimeSignature, setDismissedRuntimeSignature] = useState<string | null>(null);
  const [iframeRetryNonce, setIframeRetryNonce] = useState(0);
  const playbackRateRef = useRef<InteractivePlaybackRate>(playbackRate);
  playbackRateRef.current = playbackRate;
  // `srcDoc` already carries every shim, the observation reader included; the
  // reader is installed for each pooled document and one that publishes no
  // outlet answers `no-interface`. This reads the identity baked into that
  // document rather than minting a second, disagreeing one.
  const observation = { html: entry.srcDoc, identity: entry.observationIdentity };
  const observationSession = useRef<ReturnType<typeof createObservationSession> | null>(null);
  const registerObservation = useWidgetIframeStore((s) => s.registerObservation);
  useLayoutEffect(() => {
    observationSession.current?.dispose();
    observationSession.current = null;
    registerObservation(sceneId, async (sourceHtml, signal) => {
      const pool = useInteractiveIframePool.getState();
      const current = pool.entries[sceneId];
      if (
        pool.activeSceneId !== sceneId ||
        !current?.owner ||
        current.sourceHtml !== sourceHtml ||
        current.srcDoc !== entry.srcDoc
      )
        return undefined;
      const session = observationSession.current;
      if (!session) return undefined;
      const moved = new AbortController();
      const unsubscribe = useInteractiveIframePool.subscribe((next) => {
        if (
          next.activeSceneId !== sceneId ||
          next.entries[sceneId]?.owner !== current.owner ||
          next.entries[sceneId]?.srcDoc !== entry.srcDoc
        )
          moved.abort();
      });
      let result;
      try {
        result = await session.capture({ signal: AbortSignal.any([signal, moved.signal]) });
      } finally {
        unsubscribe();
      }
      if (moved.signal.aborted) return undefined;
      const latest = useInteractiveIframePool.getState();
      if (
        latest.activeSceneId !== sceneId ||
        !latest.entries[sceneId]?.owner ||
        latest.entries[sceneId]?.srcDoc !== entry.srcDoc ||
        observationSession.current !== session ||
        !session.isActive()
      )
        return undefined;
      return result;
    });
    return () => {
      observationSession.current?.dispose();
      observationSession.current = null;
      registerObservation(sceneId, null);
    };
  }, [sceneId, entry.srcDoc, registerObservation]);
  const registerIframe = useWidgetIframeStore((s) => s.registerIframe);
  const markIframeReady = useWidgetIframeStore((s) => s.markIframeReady);
  const getSendMessage = useWidgetIframeStore((s) => s.getSendMessage);
  const pickTarget = useCanvasStore.use.pickTarget();
  const refs = useElementRefsStore.use.refs();
  const editorArmed = pickTarget?.purpose === 'element-ref' && pickTarget.sceneId === sceneId;
  const effectiveMode = resolveInteractivePickerMode(editorArmed, playbackArmed);
  const selectors = useMemo(
    () =>
      refs.flatMap((ref) =>
        ref.kind === 'interactive-element' && ref.sceneId === sceneId ? [ref.selector] : [],
      ),
    [refs, sceneId],
  );
  const documentToken = entry.srcDoc ? `srcDoc:${entry.srcDoc}` : `src:${entry.src ?? ''}`;

  // Register the postMessage callback for this scene (moved here from the
  // placeholder, since the iframe now lives in the host). Stable per scene:
  // the callback reads contentWindow lazily at send time.
  useLayoutEffect(() => {
    const send = (type: string, payload: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ type, ...payload }, '*');
    };
    return registerIframe(sceneId, send, documentToken);
  }, [documentToken, sceneId, registerIframe]);

  useEffect(() => {
    const send = getSendMessage(sceneId);
    if (!send) return;
    send(effectiveMode ? 'element-picker:arm' : 'element-picker:disarm', {
      mode: effectiveMode,
    });
    return () => {
      if (effectiveMode) send('element-picker:disarm', { mode: effectiveMode });
    };
  }, [effectiveMode, entry.srcDoc, getSendMessage, sceneId]);

  useEffect(() => {
    getSendMessage(sceneId)?.(
      layoutEditing ? 'interactive-layout:arm' : 'interactive-layout:disarm',
      {},
    );
  }, [layoutEditing, entry.srcDoc, getSendMessage, sceneId]);

  useEffect(() => {
    getSendMessage(sceneId)?.('element-picker:sync', {
      mode: playbackSelectedSelector ? 'playback-stable-id' : effectiveMode,
      selectors: effectiveMode === 'editor' ? selectors : [],
      selectedSelector: playbackSelectedSelector ?? null,
    });
  }, [effectiveMode, entry.srcDoc, getSendMessage, playbackSelectedSelector, sceneId, selectors]);

  // Capture runtime errors the iframe's error shim posts out (see iframe.ts).
  // The active scene's banner reads this store. Matched to THIS iframe by
  // event.source (sandboxed null-origin iframes still postMessage to the parent).
  //
  // The errors that matter most (a JSON.parse that aborts setup) fire while srcDoc
  // parses — possibly BEFORE this passive effect subscribes. The shim buffers every
  // error and re-emits it on request, so after subscribing we ask for a replay to
  // recover anything posted pre-subscription. Re-subscribed per document version
  // (entry.srcDoc) so each fresh page gets its own replay request; addError dedups
  // the live + replayed copies. iframeRef is read lazily, so the handler is stable.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const d = e.data as
        | (InteractivePickerMessage & { errorKind?: string; message?: unknown })
        | undefined;
      if (!d || d.__maicInteractive !== true) return;
      if (d.kind === 'layout-editor-cancelled' && d.mode === 'layout') {
        useInteractiveLayoutEditor.getState().cancel(sceneId);
        return;
      }
      if (handleInteractiveLayoutEditorMessage(sceneId, d)) return;
      if (d.kind === 'runtime-error') {
        const kind = typeof d.errorKind === 'string' ? d.errorKind : 'error';
        const msg = typeof d.message === 'string' ? d.message : String(d.message ?? '');
        if (kind === 'resource') return;
        useSceneRuntimeErrors.getState().addError(sceneId, {
          kind: kind === 'dependency' ? 'dependency' : 'runtime',
          message: msg,
        });
        return;
      }
      if (
        onPlaybackPick &&
        onPlaybackCancel &&
        handlePlaybackInteractivePickerMessage(
          sceneId,
          playbackArmed,
          d,
          onPlaybackPick,
          onPlaybackCancel,
        )
      ) {
        return;
      }
      if (effectiveMode === 'editor') handleInteractivePickerMessage(sceneId, d, t);
    };
    window.addEventListener('message', onMessage);
    iframeRef.current?.contentWindow?.postMessage({ __maicErrorReplayRequest: true }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [sceneId, entry.srcDoc, effectiveMode, onPlaybackCancel, onPlaybackPick, playbackArmed, t]);

  // A content change reloads the iframe; drop the previous render's errors so the
  // captured set reflects the CURRENT page (e.g. after the agent applies a fix).
  useEffect(() => {
    setDismissedRuntimeSignature(null);
    useSceneRuntimeErrors.getState().clearScene(sceneId);
  }, [sceneId, entry.srcDoc]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { __maicInteractivePlaybackSpeed: true, rate: playbackRate },
      '*',
    );
  }, [entry.srcDoc, playbackRate]);

  const rect = entry.rect;
  const clip = entry.clip ?? rect;
  const viewport = rect ? fitGenUiViewport(rect) : null;
  const visibleViewport = viewport && clip ? intersectClientBoxes(viewport.box, clip) : null;
  // Require a real measured box before showing — a null or zero-size rect means
  // the slot hasn't laid out yet; showing then would flash a 0x0 iframe pinned
  // at the viewport origin.
  const shown =
    visible &&
    rect !== null &&
    clip !== null &&
    viewport !== null &&
    visibleViewport !== null &&
    visibleViewport.width > 0 &&
    visibleViewport.height > 0 &&
    rect.width > 0 &&
    rect.height > 0;
  const latestRuntimeIssue = runtimeErrors?.[runtimeErrors.length - 1];
  const showRuntimeError =
    shown &&
    typeof latestRuntimeIssue === 'object' &&
    dismissedRuntimeSignature !== runtimeErrorSignature;
  const wrapStyle: CSSProperties = {
    position: 'fixed',
    left: visibleViewport?.left ?? 0,
    top: visibleViewport?.top ?? 0,
    width: visibleViewport?.width ?? 0,
    height: visibleViewport?.height ?? 0,
    overflow: 'hidden',
    borderRadius: '0.5rem',
    zIndex: 1,
    visibility: shown ? 'visible' : 'hidden',
    pointerEvents: shown ? 'auto' : 'none',
  };
  const iframeStyle: CSSProperties = {
    position: 'absolute',
    left: viewport && visibleViewport ? viewport.box.left - visibleViewport.left : 0,
    top: viewport && visibleViewport ? viewport.box.top - visibleViewport.top : 0,
    width: GENUI_LOGICAL_WIDTH,
    height: GENUI_LOGICAL_HEIGHT,
    border: 0,
    transform: `scale(${viewport?.scale ?? 0})`,
    transformOrigin: 'top left',
  };

  return (
    <div style={wrapStyle}>
      <iframe
        key={`${sceneId}-${iframeRetryNonce}`}
        ref={iframeRef}
        srcDoc={observation.html}
        onLoad={() => {
          observationSession.current?.dispose();
          observationSession.current =
            iframeRef.current && observation.identity
              ? createObservationSession(iframeRef.current, observation.identity)
              : null;
          markIframeReady(sceneId);
          iframeRef.current?.contentWindow?.postMessage(
            { __maicInteractivePlaybackSpeed: true, rate: playbackRateRef.current },
            '*',
          );
        }}
        src={entry.srcDoc ? undefined : entry.src}
        style={iframeStyle}
        title={`Interactive Scene ${sceneId}`}
        sandbox="allow-scripts allow-forms allow-popups"
      />
      {showRuntimeError && latestRuntimeIssue ? (
        <InteractiveRuntimeErrorBanner
          issue={latestRuntimeIssue}
          onDismiss={() => setDismissedRuntimeSignature(runtimeErrorSignature)}
          onRetry={() => {
            if (latestRuntimeIssue.kind !== 'dependency') return;
            useSceneRuntimeErrors.getState().clearScene(sceneId);
            setDismissedRuntimeSignature(null);
            if (entry.srcDoc) {
              iframeRef.current?.contentWindow?.postMessage({ __maicRetryDependency: true }, '*');
            } else if (entry.src) {
              // URL-backed iframes cannot receive our inline retry shim. A
              // deliberate retry remounts that iframe to repeat its request.
              setIframeRetryNonce((nonce) => nonce + 1);
            }
          }}
        />
      ) : null}
      {playbackArmed && (
        <div
          data-testid="interactive-element-pick-instruction"
          className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-gray-950/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          {t('chat.elementReference.instruction')}
        </div>
      )}
      {layoutEditing && shown && (
        <div
          data-testid="interactive-layout-edit-instruction"
          className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-gray-950/80 px-3 py-1.5 text-xs font-medium text-white shadow-lg"
        >
          拖动页面元素调整位置 · 按 Esc 取消
        </div>
      )}
    </div>
  );
}
