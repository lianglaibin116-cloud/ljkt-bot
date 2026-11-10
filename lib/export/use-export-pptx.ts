'use client';

import { useState, useCallback, useRef } from 'react';
import pptxgen from 'pptxgenjs';
import tinycolor from 'tinycolor2';
import { saveAs } from 'file-saver';
import { toast } from 'sonner';

import { useStageStore } from '@/lib/store';
import { useCanvasStore } from '@/lib/store/canvas';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  enumerateAssetManifest,
  slideMediaSlotDescriptors,
  type Slide,
  type SchoolCourseProfile,
  type PPTElementOutline,
  type PPTElementShadow,
  type PPTElementLink,
  type TableCell,
} from '@ljkt/dsl';
import type { Scene, SlideContent } from '@/lib/types/stage';
import type { SpeechAction } from '@/lib/types/action';
import {
  getElementRange,
  getLineElementPath,
  getRenderableLineWidth,
  getTableSubThemeColor,
} from '@/lib/utils/element';
import { type AST, toAST } from '@/lib/export/html-parser';
import { type SvgPoints, toPoints, getSvgPathRange } from '@/lib/export/svg-path-parser';
import { svg2Base64 } from '@/lib/export/svg2base64';
import { latexToOmml } from '@/lib/export/latex-to-omml';
import { createLogger } from '@/lib/logger';
import { collectSpeechText } from './narration';
import { inlineHtmlAssets, createAssetFetcher } from './inline-assets';
import type { FetchAsset } from './inline-assets';
import { createProxiedFetch } from './proxied-fetch';
import { buildOfflineLesson, OfflinePlayerError } from './offline-player/build';
import { buildOfflinePlayerHtml } from './offline-player/html';
import type { AssetUrlLeaseState } from '@/lib/media/use-asset-url';
import { resolveStoredBytes } from '@/lib/media/resolve-stored-bytes';
import {
  MISSING_ASSET_LEASE,
  isConcreteMediaAddress,
  renderableMediaUrl,
  resolveMediaRef,
  type MediaTaskState,
} from '@/lib/media/resolve-media-ref';
import { lookupMediaTask, resolveVideoMediaForElement } from '@/lib/media/media-task-resolution';
import { auditSchoolCourse, type CourseAuditReport } from '@/lib/course-quality/audit';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

const log = createLogger('ExportPPTX');

const DEFAULT_FONT_SIZE = 16;
const DEFAULT_FONT_FAMILY = 'Microsoft YaHei';

// ── Color formatting ──

function formatColor(_color: string) {
  if (!_color) {
    return { alpha: 0, color: '#000000' };
  }
  const c = tinycolor(_color);
  const alpha = c.getAlpha();
  const color = alpha === 0 ? '#ffffff' : c.setAlpha(1).toHexString();
  return { alpha, color };
}

type FormatColor = ReturnType<typeof formatColor>;

function isRuntimeTableCell(value: unknown): value is TableCell {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Generated or legacy courses can contain a one-dimensional table payload even
 * though the DSL expects rows. The classroom renderer accepts those cells as
 * one-cell rows, so PPTX export must use the same recovery instead of passing an
 * empty table to PptxGenJS.
 */
export function normalizeRuntimeTableData(data: unknown): TableCell[][] {
  if (!Array.isArray(data)) return [];

  return data
    .map((row) => (Array.isArray(row) ? row : [row]).filter(isRuntimeTableCell))
    .filter((row) => row.length > 0);
}

// ── HTML → pptxgenjs TextProps ──

function formatHTML(html: string, ratioPx2Pt: number) {
  const ast = toAST(html);
  let bulletFlag = false;
  let indent = 0;

  const slices: pptxgen.TextProps[] = [];

  const parse = (obj: AST[], baseStyleObj: Record<string, string> = {}) => {
    for (const item of obj) {
      const isBlockTag = 'tagName' in item && ['div', 'li', 'p'].includes(item.tagName);

      if (isBlockTag && slices.length) {
        const lastSlice = slices[slices.length - 1];
        if (!lastSlice.options) lastSlice.options = {};
        lastSlice.options.breakLine = true;
      }

      const styleObj = { ...baseStyleObj };
      const styleAttr =
        'attributes' in item ? item.attributes.find((attr) => attr.key === 'style') : null;
      if (styleAttr && styleAttr.value) {
        const styleArr = styleAttr.value.split(';');
        for (const styleItem of styleArr) {
          const match = styleItem.match(/([^:]+):\s*(.+)/);
          if (match) {
            const [key, value] = [match[1].trim(), match[2].trim()];
            if (key && value) styleObj[key] = value;
          }
        }
      }

      if ('tagName' in item) {
        if (item.tagName === 'em') styleObj['font-style'] = 'italic';
        if (item.tagName === 'strong') styleObj['font-weight'] = 'bold';
        if (item.tagName === 'sup') styleObj['vertical-align'] = 'super';
        if (item.tagName === 'sub') styleObj['vertical-align'] = 'sub';
        if (item.tagName === 'a') {
          const attr = item.attributes.find((a) => a.key === 'href');
          styleObj['href'] = attr?.value || '';
        }
        if (item.tagName === 'ul') styleObj['list-type'] = 'ul';
        if (item.tagName === 'ol') styleObj['list-type'] = 'ol';
        if (item.tagName === 'li') bulletFlag = true;
        if (item.tagName === 'p') {
          if ('attributes' in item) {
            const dataIndentAttr = item.attributes.find((a) => a.key === 'data-indent');
            if (dataIndentAttr && dataIndentAttr.value) indent = +dataIndentAttr.value;
          }
        }
      }

      if ('tagName' in item && item.tagName === 'br') {
        slices.push({ text: '', options: { breakLine: true } });
      } else if ('content' in item) {
        const text = item.content
          .replace(/&nbsp;/g, ' ')
          .replace(/&gt;/g, '>')
          .replace(/&lt;/g, '<')
          .replace(/&amp;/g, '&')
          .replace(/\n/g, '');
        const options: pptxgen.TextPropsOptions = {};

        if (styleObj['font-size']) {
          options.fontSize = parseInt(styleObj['font-size']) / ratioPx2Pt;
        }
        if (styleObj['color']) {
          options.color = formatColor(styleObj['color']).color;
        }
        if (styleObj['background-color']) {
          options.highlight = formatColor(styleObj['background-color']).color;
        }
        if (styleObj['text-decoration-line']) {
          if (styleObj['text-decoration-line'].indexOf('underline') !== -1) {
            options.underline = {
              color: options.color || '#000000',
              style: 'sng',
            };
          }
          if (styleObj['text-decoration-line'].indexOf('line-through') !== -1) {
            options.strike = 'sngStrike';
          }
        }
        if (styleObj['text-decoration']) {
          if (styleObj['text-decoration'].indexOf('underline') !== -1) {
            options.underline = {
              color: options.color || '#000000',
              style: 'sng',
            };
          }
          if (styleObj['text-decoration'].indexOf('line-through') !== -1) {
            options.strike = 'sngStrike';
          }
        }
        if (styleObj['vertical-align']) {
          if (styleObj['vertical-align'] === 'super') options.superscript = true;
          if (styleObj['vertical-align'] === 'sub') options.subscript = true;
        }
        if (styleObj['text-align']) options.align = styleObj['text-align'] as pptxgen.HAlign;
        if (styleObj['font-weight']) options.bold = styleObj['font-weight'] === 'bold';
        if (styleObj['font-style']) options.italic = styleObj['font-style'] === 'italic';
        if (styleObj['font-family']) options.fontFace = styleObj['font-family'];
        if (styleObj['href']) options.hyperlink = { url: styleObj['href'] };

        if (bulletFlag && styleObj['list-type'] === 'ol') {
          options.bullet = {
            type: 'number',
            indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25,
          };
          options.paraSpaceBefore = 0.1;
          bulletFlag = false;
        }
        if (bulletFlag && styleObj['list-type'] === 'ul') {
          options.bullet = {
            indent: (options.fontSize || DEFAULT_FONT_SIZE) * 1.25,
          };
          options.paraSpaceBefore = 0.1;
          bulletFlag = false;
        }
        if (indent) {
          options.indentLevel = indent;
          indent = 0;
        }

        slices.push({ text, options });
      } else if ('children' in item) parse(item.children, styleObj);
    }
  };
  parse(ast);
  return slices;
}

// ── SVG path → pptxgenjs points ──

type Points = Array<
  | { x: number; y: number; moveTo?: boolean }
  | {
      x: number;
      y: number;
      curve: {
        type: 'arc';
        hR: number;
        wR: number;
        stAng: number;
        swAng: number;
      };
    }
  | {
      x: number;
      y: number;
      curve: { type: 'quadratic'; x1: number; y1: number };
    }
  | {
      x: number;
      y: number;
      curve: { type: 'cubic'; x1: number; y1: number; x2: number; y2: number };
    }
  | { close: true }
>;

function formatPoints(
  points: SvgPoints,
  ratioPx2Inch: number,
  scale = { x: 1, y: 1 },
  origin = { x: 0, y: 0 },
): Points {
  return points.map((point) => {
    if (point.close !== undefined) {
      return { close: true };
    } else if (point.type === 'M') {
      return {
        x: (((point.x as number) - origin.x) / ratioPx2Inch) * scale.x,
        y: (((point.y as number) - origin.y) / ratioPx2Inch) * scale.y,
        moveTo: true,
      };
    } else if (point.curve) {
      if (point.curve.type === 'cubic') {
        return {
          x: (((point.x as number) - origin.x) / ratioPx2Inch) * scale.x,
          y: (((point.y as number) - origin.y) / ratioPx2Inch) * scale.y,
          curve: {
            type: 'cubic' as const,
            x1: (((point.curve.x1 as number) - origin.x) / ratioPx2Inch) * scale.x,
            y1: (((point.curve.y1 as number) - origin.y) / ratioPx2Inch) * scale.y,
            x2: (((point.curve.x2 as number) - origin.x) / ratioPx2Inch) * scale.x,
            y2: (((point.curve.y2 as number) - origin.y) / ratioPx2Inch) * scale.y,
          },
        };
      } else if (point.curve.type === 'quadratic') {
        return {
          x: (((point.x as number) - origin.x) / ratioPx2Inch) * scale.x,
          y: (((point.y as number) - origin.y) / ratioPx2Inch) * scale.y,
          curve: {
            type: 'quadratic' as const,
            x1: (((point.curve.x1 as number) - origin.x) / ratioPx2Inch) * scale.x,
            y1: (((point.curve.y1 as number) - origin.y) / ratioPx2Inch) * scale.y,
          },
        };
      }
    }
    return {
      x: (((point.x as number) - origin.x) / ratioPx2Inch) * scale.x,
      y: (((point.y as number) - origin.y) / ratioPx2Inch) * scale.y,
    };
  });
}

// ── Shadow config ──

function getShadowOption(shadow: PPTElementShadow, ratioPx2Pt: number): pptxgen.ShadowProps {
  const c = formatColor(shadow.color);
  const { h, v } = shadow;

  let offset = 4;
  let angle = 45;

  if (h === 0 && v === 0) {
    offset = 4;
    angle = 45;
  } else if (h === 0) {
    if (v > 0) {
      offset = v;
      angle = 90;
    } else {
      offset = -v;
      angle = 270;
    }
  } else if (v === 0) {
    if (h > 0) {
      offset = h;
      angle = 1;
    } else {
      offset = -h;
      angle = 180;
    }
  } else if (h > 0 && v > 0) {
    offset = Math.max(h, v);
    angle = 45;
  } else if (h > 0 && v < 0) {
    offset = Math.max(h, -v);
    angle = 315;
  } else if (h < 0 && v > 0) {
    offset = Math.max(-h, v);
    angle = 135;
  } else if (h < 0 && v < 0) {
    offset = Math.max(-h, -v);
    angle = 225;
  }

  return {
    type: 'outer',
    color: c.color.replace('#', ''),
    opacity: c.alpha,
    // pptxgenjs shadow blur AND offset are in points; the source model is in
    // pixels. blur was converted but offset was not, so shadows exported ~33%
    // too far at the default viewport (ratioPx2Pt = 96/72 × viewportSize/960).
    blur: shadow.blur / ratioPx2Pt,
    offset: offset / ratioPx2Pt,
    angle,
  };
}

// ── Outline config ──

const dashTypeMap: Record<string, string> = {
  solid: 'solid',
  dashed: 'dash',
  dotted: 'sysDot',
};

function getOutlineOption(outline: PPTElementOutline, ratioPx2Pt: number): pptxgen.ShapeLineProps {
  const c = formatColor(outline?.color || '#000000');
  return {
    color: c.color,
    transparency: (1 - c.alpha) * 100,
    width: (outline.width || 1) / ratioPx2Pt,
    dashType: outline.style ? (dashTypeMap[outline.style] as 'solid' | 'dash' | 'sysDot') : 'solid',
  };
}

// ── Link config ──

function getLinkOption(link: PPTElementLink, slides: Slide[]): pptxgen.HyperlinkProps | null {
  const { type, target } = link;
  if (type === 'web') return { url: target };
  if (type === 'slide') {
    const index = slides.findIndex((slide) => slide.id === target);
    if (index !== -1) return { slide: index + 1 };
  }
  return null;
}

// ── Image helpers ──

function isBase64Image(url: string) {
  return /^data:image\/[^;]+;base64,/.test(url);
}

function isSVGImage(url: string) {
  return /^data:image\/svg\+xml;base64,/.test(url) || /\.svg$/.test(url);
}

// ── Main export hook ──

// ── Build PPTX blob (reused by single-export and resource pack) ──

/**
 * Extract speaker notes text from a scene's actions.
 * Concatenates speech text and action labels into plain text.
 */
/**
 * Speaker notes for one slide: the scene's speech text in action order.
 * Delegates to the shared narration walk in `./narration` (#1142) with its
 * historical options — whitespace-only speech is kept and parts are not
 * trimmed, matching the pre-refactor notes output.
 */
function buildSpeakerNotes(scene: Scene): string {
  return collectSpeechText(scene);
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function resolvePptxMediaBinding(
  ref: string | undefined,
  task: MediaTaskState | undefined,
  lease: AssetUrlLeaseState = MISSING_ASSET_LEASE,
  mediaGenerationDisabled = false,
) {
  const resolution = resolveMediaRef(ref, task, lease, mediaGenerationDisabled);
  return { resolution, src: renderableMediaUrl(resolution) ?? '' };
}

/**
 * Resolve one media ref to an embeddable PPTX source through the shared
 * resolver, so no export-element branch carries its own fallback chain.
 *
 * An opaque ref (allocated id or legacy placeholder) resolves pool-first via
 * {@link resolveStoredBytes} -- then the compatibility row, then the task's
 * resolved URL, every level gated on the media-resolution state machine -- and
 * embeds as a data URL. A concrete address resolves to itself through the
 * state machine and keeps the caller's legacy fetch path. Returns '' when no
 * level yields a renderable source; the caller skips the element.
 */
async function resolvePptxEmbeddableSrc(
  ref: string | undefined,
  task: MediaTaskState | undefined,
  stageId?: string,
): Promise<string> {
  if (!ref) return '';
  if (!isConcreteMediaAddress(ref)) {
    const stored = await resolveStoredBytes(ref, {
      stageId,
      resolutionGating: true,
      loadCompatRow: true,
      taskUrlFallback: true,
      fetchPolicy: { requireOk: true, requireNonEmpty: false },
    });
    if (stored) return blobToDataUrl(stored);
  }
  const tasks = useMediaGenerationStore.getState().tasks;
  const effectiveTask = task ?? lookupMediaTask(tasks, ref, stageId);
  return renderableMediaUrl(resolvePptxMediaBinding(ref, effectiveTask).resolution) ?? '';
}

/**
 * Derive the document-wide candidate set for PPTX media resolution through the
 * standard manifest. The PPTX document is the ordered slide list it renders;
 * speaker-note actions and non-rendered whiteboards are intentionally outside
 * this media scope.
 */
export function derivePptxMediaReferenceSet(slides: readonly Slide[]): ReadonlySet<string> {
  const scenes = slides.map(
    (slide, index) =>
      ({
        id: `pptx-slide-${index}`,
        stageId: 'pptx-export',
        type: 'slide',
        title: '',
        order: index,
        content: { type: 'slide', canvas: slide },
      }) as Scene,
  );
  return new Set(enumerateAssetManifest({ stage: {}, scenes }).entries.map(({ ref }) => ref));
}

/**
 * The manifest-guard predicate: is this ref foreign to the PPTX document's
 * asset manifest, with no task ownership that would legitimate it? A generated
 * task may supply concrete runtime URLs (its objectUrl, or the poster of an
 * element without one) that are runtime metadata rather than document refs;
 * every other ref the layout resolves must come from the manifest. Exported so
 * the guard's foreign-ref rejection stays directly testable.
 */
export function isPptxManifestForeignRef(
  ref: string | undefined,
  manifestRefs: ReadonlySet<string>,
  task: MediaTaskState | undefined,
): boolean {
  return !!ref && !manifestRefs.has(ref) && task?.objectUrl !== ref;
}

/**
 * Pin the manifest and layout walks together. Element iteration remains
 * necessary for coordinates, z-order and video binding selection; it may not
 * introduce or omit a media role relative to the manifest.
 */
export function assertPptxMediaReferenceParity(
  slides: readonly Slide[],
  manifestRefs: ReadonlySet<string>,
): void {
  const layoutRefs = new Set<string>();
  for (const slide of slides) {
    for (const slot of slideMediaSlotDescriptors(slide)) {
      if (slot.ref) layoutRefs.add(slot.ref);
    }
  }
  const missingFromLayout = [...manifestRefs].filter((ref) => !layoutRefs.has(ref));
  const missingFromManifest = [...layoutRefs].filter((ref) => !manifestRefs.has(ref));
  if (missingFromLayout.length > 0 || missingFromManifest.length > 0) {
    throw new Error(
      `PPTX media manifest/layout mismatch: ` +
        `manifest-only=${JSON.stringify(missingFromLayout)}, ` +
        `layout-only=${JSON.stringify(missingFromManifest)}`,
    );
  }
}

// Exported for the round-trip integration test harness — the test wires its
// own slides + ratios in and inspects the resulting PPTX bytes via JSZip.
// The hook below is still the only intended runtime caller.
export async function buildPptxBlob(
  slides: Slide[],
  slideScenes: Scene[],
  viewportRatio: number,
  viewportSize: number,
  ratioPx2Inch: number,
  ratioPx2Pt: number,
  stageId?: string,
): Promise<Blob> {
  const pptx = new pptxgen();
  const documentElements = slides.flatMap((slide) => slide.elements);
  const manifestRefs = derivePptxMediaReferenceSet(slides);
  assertPptxMediaReferenceParity(slides, manifestRefs);
  const resolveManifestMedia = (
    ref: string | undefined,
    task: MediaTaskState | undefined,
  ): Promise<string> => {
    // A generated task may supply a concrete poster URL that is runtime
    // metadata rather than a document ref. Preserve that established fallback;
    // every document-owned ref must still come from the manifest.
    if (isPptxManifestForeignRef(ref, manifestRefs, task)) {
      throw new Error(`PPTX layout attempted to resolve a ref outside the asset manifest: ${ref}`);
    }
    return resolvePptxEmbeddableSrc(ref, task, stageId);
  };

  // Set layout based on aspect ratio
  if (viewportRatio === 0.625) pptx.layout = 'LAYOUT_16x10';
  else if (viewportRatio === 0.75) pptx.layout = 'LAYOUT_4x3';
  else pptx.layout = 'LAYOUT_16x9';

  for (let slideIdx = 0; slideIdx < slides.length; slideIdx++) {
    const slide = slides[slideIdx];
    const pptxSlide = pptx.addSlide();

    // ── Speaker Notes ──
    const scene = slideScenes[slideIdx];
    if (scene) {
      const notes = buildSpeakerNotes(scene);
      if (notes) pptxSlide.addNotes(notes);
    }

    // ── Background ──
    if (slide.background) {
      const bg = slide.background;
      if (bg.type === 'image' && bg.image) {
        const resolvedSrc = await resolveManifestMedia(bg.image.src, undefined);
        if (!resolvedSrc) {
          // Missing generated backgrounds stay empty instead of leaking an opaque ref to pptxgen.
        } else if (isSVGImage(resolvedSrc)) {
          pptxSlide.addImage({
            data: resolvedSrc,
            x: 0,
            y: 0,
            w: viewportSize / ratioPx2Inch,
            h: (viewportSize * viewportRatio) / ratioPx2Inch,
          });
        } else if (isBase64Image(resolvedSrc)) {
          pptxSlide.background = { data: resolvedSrc };
        } else {
          pptxSlide.background = { path: resolvedSrc };
        }
      } else if (bg.type === 'solid' && bg.color) {
        const c = formatColor(bg.color);
        pptxSlide.background = {
          color: c.color,
          transparency: (1 - c.alpha) * 100,
        };
      } else if (bg.type === 'gradient' && bg.gradient) {
        const colors = bg.gradient.colors;
        const color1 = colors[0].color;
        const color2 = colors[colors.length - 1].color;
        const mixed = tinycolor.mix(color1, color2).toHexString();
        const c = formatColor(mixed);
        pptxSlide.background = {
          color: c.color,
          transparency: (1 - c.alpha) * 100,
        };
      }
    }

    if (!slide.elements) continue;

    // ── Elements ──
    for (const el of slide.elements) {
      // ── TEXT ──
      if (el.type === 'text') {
        const textProps = formatHTML(el.content, ratioPx2Pt);
        const options: pptxgen.TextPropsOptions = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
          fontFace: el.defaultFontName || DEFAULT_FONT_FAMILY,
          color: '#000000',
          valign: 'top',
          margin: 10 / ratioPx2Pt,
          paraSpaceBefore: 5 / ratioPx2Pt,
          lineSpacingMultiple: 1.5 / 1.25,
          autoFit: true,
        };
        if (el.rotate) options.rotate = el.rotate;
        if (el.wordSpace) options.charSpacing = el.wordSpace / ratioPx2Pt;
        if (el.lineHeight) options.lineSpacingMultiple = el.lineHeight / 1.25;
        if (el.fill) {
          const c = formatColor(el.fill);
          const opacity = el.opacity === undefined ? 1 : el.opacity;
          options.fill = {
            color: c.color,
            transparency: (1 - c.alpha * opacity) * 100,
          };
        }
        if (el.defaultColor) options.color = formatColor(el.defaultColor).color;
        if (el.defaultFontName) options.fontFace = el.defaultFontName;
        if (el.shadow) options.shadow = getShadowOption(el.shadow, ratioPx2Pt);
        if (el.outline?.width) options.line = getOutlineOption(el.outline, ratioPx2Pt);
        if (el.opacity !== undefined) options.transparency = (1 - el.opacity) * 100;
        if (el.paragraphSpace !== undefined)
          options.paraSpaceBefore = el.paragraphSpace / ratioPx2Pt;
        if (el.vertical) options.vert = 'eaVert';

        pptxSlide.addText(textProps, options);
      }

      // ── IMAGE ──
      else if (el.type === 'image') {
        // Resolve the src through the shared stored-bytes resolver (opaque
        // refs embed as data URLs; concrete addresses keep the fetch below).
        let resolvedSrc = await resolveManifestMedia(el.src, undefined);
        if (!resolvedSrc) continue;

        // Fetch and convert to base64 for embedding in PPTX
        // (blob: URLs and remote URLs won't work in offline PPTX)
        if (!isBase64Image(resolvedSrc)) {
          try {
            const resp = await fetch(resolvedSrc);
            if (!resp.ok) {
              log.warn(
                `Failed to fetch image (HTTP ${resp.status}), skipping element: ${resolvedSrc}`,
              );
              continue;
            }
            resolvedSrc = await blobToDataUrl(await resp.blob());
          } catch {
            log.warn('Failed to convert image to base64, skipping element');
            continue;
          }
        }

        const options: pptxgen.ImageProps = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
        };
        if (isBase64Image(resolvedSrc)) options.data = resolvedSrc;
        else options.path = resolvedSrc;

        if (el.flipH) options.flipH = el.flipH;
        if (el.flipV) options.flipV = el.flipV;
        if (el.rotate) options.rotate = el.rotate;
        if (el.link) {
          const linkOption = getLinkOption(el.link, slides);
          if (linkOption) options.hyperlink = linkOption;
        }
        if (el.filters?.opacity) options.transparency = 100 - parseInt(el.filters.opacity);
        if (el.clip) {
          if (el.clip.shape === 'ellipse') options.rounding = true;

          const [start, end] = el.clip.range;
          const [startX, startY] = start;
          const [endX, endY] = end;

          const originW = el.width / ((endX - startX) / ratioPx2Inch);
          const originH = el.height / ((endY - startY) / ratioPx2Inch);

          options.w = originW / ratioPx2Inch;
          options.h = originH / ratioPx2Inch;

          options.sizing = {
            type: 'crop',
            x: ((startX / ratioPx2Inch) * originW) / ratioPx2Inch,
            y: ((startY / ratioPx2Inch) * originH) / ratioPx2Inch,
            w: (((endX - startX) / ratioPx2Inch) * originW) / ratioPx2Inch,
            h: (((endY - startY) / ratioPx2Inch) * originH) / ratioPx2Inch,
          };
        }

        pptxSlide.addImage(options);
      }

      // ── SHAPE ──
      else if (el.type === 'shape') {
        if (el.special) {
          // Special shapes: render as SVG image
          // Create a temporary SVG element from the path
          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('xmlns', svgNS);
          svg.setAttribute('viewBox', `0 0 ${el.viewBox[0]} ${el.viewBox[1]}`);
          svg.setAttribute('width', String(el.width));
          svg.setAttribute('height', String(el.height));

          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', el.path);
          path.setAttribute('fill', el.fill || 'none');
          if (el.outline?.color) {
            path.setAttribute('stroke', el.outline.color);
            path.setAttribute('stroke-width', String(el.outline.width || 1));
          }
          svg.appendChild(path);

          const base64SVG = svg2Base64(svg);

          const imgOptions: pptxgen.ImageProps = {
            data: base64SVG,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          if (el.rotate) imgOptions.rotate = el.rotate;
          if (el.flipH) imgOptions.flipH = el.flipH;
          if (el.flipV) imgOptions.flipV = el.flipV;
          if (el.link) {
            const linkOption = getLinkOption(el.link, slides);
            if (linkOption) imgOptions.hyperlink = linkOption;
          }
          pptxSlide.addImage(imgOptions);
        } else {
          const scale = {
            x: el.width / el.viewBox[0],
            y: el.height / el.viewBox[1],
          };
          const rawPoints = toPoints(el.path);
          if (!rawPoints.length) continue; // Malformed path — toPoints already logged.
          const points = formatPoints(rawPoints, ratioPx2Inch, scale);

          let fillColor = formatColor(el.fill);
          if (el.gradient) {
            const colors = el.gradient.colors;
            const color1 = colors[0].color;
            const color2 = colors[colors.length - 1].color;
            const mixed = tinycolor.mix(color1, color2).toHexString();
            fillColor = formatColor(mixed);
          }
          if (el.pattern) fillColor = formatColor('#00000000');
          const opacity = el.opacity === undefined ? 1 : el.opacity;

          const shapeOptions: pptxgen.ShapeProps = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fill: {
              color: fillColor.color,
              transparency: (1 - fillColor.alpha * opacity) * 100,
            },
            points,
          };
          if (el.flipH) shapeOptions.flipH = el.flipH;
          if (el.flipV) shapeOptions.flipV = el.flipV;
          if (el.shadow) shapeOptions.shadow = getShadowOption(el.shadow, ratioPx2Pt);
          if (el.outline?.width) shapeOptions.line = getOutlineOption(el.outline, ratioPx2Pt);
          if (el.rotate) shapeOptions.rotate = el.rotate;
          if (el.link) {
            const linkOption = getLinkOption(el.link, slides);
            if (linkOption) shapeOptions.hyperlink = linkOption;
          }

          pptxSlide.addShape('custGeom' as pptxgen.ShapeType, shapeOptions);
        }

        // Shape text overlay
        if (el.text) {
          const textProps = formatHTML(el.text.content, ratioPx2Pt);
          const textOptions: pptxgen.TextPropsOptions = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fontSize: DEFAULT_FONT_SIZE / ratioPx2Pt,
            fontFace: DEFAULT_FONT_FAMILY,
            color: '#000000',
            paraSpaceBefore: 5 / ratioPx2Pt,
            valign: el.text.align,
          };
          if (el.rotate) textOptions.rotate = el.rotate;
          if (el.text.defaultColor) textOptions.color = formatColor(el.text.defaultColor).color;
          if (el.text.defaultFontName) textOptions.fontFace = el.text.defaultFontName;

          pptxSlide.addText(textProps, textOptions);
        }

        // Pattern overlay
        if (el.pattern) {
          const patternOptions: pptxgen.ImageProps = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          if (isBase64Image(el.pattern)) patternOptions.data = el.pattern;
          else patternOptions.path = el.pattern;

          if (el.flipH) patternOptions.flipH = el.flipH;
          if (el.flipV) patternOptions.flipV = el.flipV;
          if (el.rotate) patternOptions.rotate = el.rotate;
          if (el.link) {
            const linkOption = getLinkOption(el.link, slides);
            if (linkOption) patternOptions.hyperlink = linkOption;
          }
          pptxSlide.addImage(patternOptions);
        }
      }

      // ── LINE ──
      else if (el.type === 'line') {
        const path = getLineElementPath(el);
        const { minX, maxX, minY, maxY } = getElementRange(el);
        // Custom geometry points are relative to its bounding box, which need
        // not begin at the element origin (negative controls / offset endpoints).
        const points = formatPoints(toPoints(path), ratioPx2Inch, undefined, {
          x: minX - el.left,
          y: minY - el.top,
        });
        const c = formatColor(el.color);

        const lineOptions: pptxgen.ShapeProps = {
          x: minX / ratioPx2Inch,
          y: minY / ratioPx2Inch,
          w: (maxX - minX) / ratioPx2Inch,
          h: (maxY - minY) / ratioPx2Inch,
          line: {
            color: c.color,
            transparency: (1 - c.alpha) * 100,
            width: getRenderableLineWidth(el.width) / ratioPx2Pt,
            dashType: dashTypeMap[el.style] as 'solid' | 'dash' | 'sysDot',
            beginArrowType: el.points[0] ? 'arrow' : 'none',
            endArrowType: el.points[1] ? 'arrow' : 'none',
          },
          points,
        };
        if (el.shadow) lineOptions.shadow = getShadowOption(el.shadow, ratioPx2Pt);

        pptxSlide.addShape('custGeom' as pptxgen.ShapeType, lineOptions);
      }

      // ── CHART ──
      else if (el.type === 'chart') {
        const chartData = [];
        for (let i = 0; i < el.data.series.length; i++) {
          const item = el.data.series[i];
          chartData.push({
            name: `Series ${i + 1}`,
            labels: el.data.labels,
            values: item,
          });
        }

        let chartColors: string[] = [];
        if (el.themeColors.length === 10) {
          chartColors = el.themeColors.map((c) => formatColor(c).color);
        } else if (el.themeColors.length === 1) {
          chartColors = tinycolor(el.themeColors[0])
            .analogous(10)
            .map((c) => formatColor(c.toHexString()).color);
        } else {
          const len = el.themeColors.length;
          const supplement = tinycolor(el.themeColors[len - 1])
            .analogous(10 + 1 - len)
            .map((c) => c.toHexString());
          chartColors = [...el.themeColors.slice(0, len - 1), ...supplement].map(
            (c) => formatColor(c).color,
          );
        }

        const chartOptions: pptxgen.IChartOpts = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
          chartColors:
            el.chartType === 'pie' || el.chartType === 'ring'
              ? chartColors
              : chartColors.slice(0, el.data.series.length),
        };

        const textColor = formatColor(el.textColor || '#000000').color;
        chartOptions.catAxisLabelColor = textColor;
        chartOptions.valAxisLabelColor = textColor;

        const fontSize = 14 / ratioPx2Pt;
        chartOptions.catAxisLabelFontSize = fontSize;
        chartOptions.valAxisLabelFontSize = fontSize;

        if (el.fill || el.outline) {
          const plotArea: pptxgen.IChartPropsFillLine = {};
          if (el.fill) plotArea.fill = { color: formatColor(el.fill).color };
          if (el.outline) {
            plotArea.border = {
              pt: el.outline.width! / ratioPx2Pt,
              color: formatColor(el.outline.color!).color,
            };
          }
          chartOptions.plotArea = plotArea;
        }

        if (
          (el.data.series.length > 1 && el.chartType !== 'scatter') ||
          el.chartType === 'pie' ||
          el.chartType === 'ring'
        ) {
          chartOptions.showLegend = true;
          chartOptions.legendPos = 'b';
          chartOptions.legendColor = textColor;
          chartOptions.legendFontSize = fontSize;
        }

        let type = pptx.ChartType.bar;
        if (el.chartType === 'bar') {
          type = pptx.ChartType.bar;
          chartOptions.barDir = 'col';
          if (el.options?.stack) chartOptions.barGrouping = 'stacked';
        } else if (el.chartType === 'column') {
          type = pptx.ChartType.bar;
          chartOptions.barDir = 'bar';
          if (el.options?.stack) chartOptions.barGrouping = 'stacked';
        } else if (el.chartType === 'line') {
          type = pptx.ChartType.line;
          if (el.options?.lineSmooth) chartOptions.lineSmooth = true;
        } else if (el.chartType === 'area') {
          type = pptx.ChartType.area;
        } else if (el.chartType === 'radar') {
          type = pptx.ChartType.radar;
        } else if (el.chartType === 'scatter') {
          type = pptx.ChartType.scatter;
          chartOptions.lineSize = 0;
        } else if (el.chartType === 'pie') {
          type = pptx.ChartType.pie;
        } else if (el.chartType === 'ring') {
          type = pptx.ChartType.doughnut;
          chartOptions.holeSize = 60;
        }

        pptxSlide.addChart(type, chartData, chartOptions);
      }

      // ── TABLE ──
      else if (el.type === 'table') {
        const rows = normalizeRuntimeTableData(el.data);
        if (rows.length === 0) continue;

        const hiddenCells: string[] = [];
        for (let i = 0; i < rows.length; i++) {
          const rowData = rows[i];
          for (let j = 0; j < rowData.length; j++) {
            const cell = rowData[j];
            if (cell.colspan > 1 || cell.rowspan > 1) {
              for (let row = i; row < i + cell.rowspan; row++) {
                for (let col = row === i ? j + 1 : j; col < j + cell.colspan; col++) {
                  hiddenCells.push(`${row}_${col}`);
                }
              }
            }
          }
        }

        const tableData: pptxgen.TableRow[] = [];

        const theme = el.theme;
        let themeColor: FormatColor | null = null;
        let subThemeColors: FormatColor[] = [];
        if (theme) {
          themeColor = formatColor(theme.color);
          subThemeColors = getTableSubThemeColor(theme.color).map((item) => formatColor(item));
        }

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const _row: pptxgen.TableCell[] = [];

          for (let j = 0; j < row.length; j++) {
            const cell = row[j];
            const cellOptions: pptxgen.TableCellProps = {
              colspan: cell.colspan,
              rowspan: cell.rowspan,
              bold: cell.style?.bold || false,
              italic: cell.style?.em || false,
              underline: { style: cell.style?.underline ? 'sng' : 'none' },
              align: cell.style?.align || 'left',
              valign: 'middle',
              fontFace: cell.style?.fontname || DEFAULT_FONT_FAMILY,
              fontSize: (cell.style?.fontsize ? parseInt(cell.style.fontsize) : 14) / ratioPx2Pt,
            };
            if (theme && themeColor) {
              let c: FormatColor;
              if (i % 2 === 0) c = subThemeColors[1];
              else c = subThemeColors[0];

              if (theme.rowHeader && i === 0) c = themeColor;
              else if (theme.rowFooter && i === rows.length - 1) c = themeColor;
              else if (theme.colHeader && j === 0) c = themeColor;
              else if (theme.colFooter && j === row.length - 1) c = themeColor;

              cellOptions.fill = {
                color: c.color,
                transparency: (1 - c.alpha) * 100,
              };
            }
            if (cell.style?.backcolor) {
              const c = formatColor(cell.style.backcolor);
              cellOptions.fill = {
                color: c.color,
                transparency: (1 - c.alpha) * 100,
              };
            }
            if (cell.style?.color) cellOptions.color = formatColor(cell.style.color).color;

            if (!hiddenCells.includes(`${i}_${j}`)) {
              _row.push({ text: cell.text, options: cellOptions });
            }
          }
          if (_row.length) tableData.push(_row);
        }

        const tableOptions: pptxgen.TableProps = {
          x: el.left / ratioPx2Inch,
          y: el.top / ratioPx2Inch,
          w: el.width / ratioPx2Inch,
          h: el.height / ratioPx2Inch,
        };
        const colWidths = Array.isArray(el.colWidths)
          ? el.colWidths.filter((item) => Number.isFinite(item) && item > 0)
          : [];
        if (colWidths.length > 0) {
          tableOptions.colW = colWidths.map((item) => (el.width * item) / ratioPx2Inch);
        }
        if (el.theme) tableOptions.fill = { color: '#ffffff' };
        if (el.outline.width && el.outline.color) {
          tableOptions.border = {
            type: el.outline.style === 'solid' ? 'solid' : 'dash',
            pt: el.outline.width / ratioPx2Pt,
            color: formatColor(el.outline.color).color,
          };
        }

        pptxSlide.addTable(tableData, tableOptions);
      }

      // ── LATEX ──
      else if (el.type === 'latex') {
        // Try native OMML formula first (editable in PowerPoint)
        // Estimate line count from \\ line breaks to compute a fitting font size.
        // Formula rendered height ≈ lines * 1.5 * fontSize, so fontSize ≈ boxHeight / (lines * 1.5)
        const lineBreaks = (el.latex?.match(/\\\\/g) || []).length;
        const lines = lineBreaks + 1;
        const boxHeightPt = el.height / ratioPx2Pt;
        const fontSize = Math.round(boxHeightPt / (lines * 3));
        const omml = el.latex ? latexToOmml(el.latex, fontSize) : null;

        if (omml) {
          pptxSlide.addFormula({
            omml,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            fontSize,
            align: el.align,
          });
        } else if (el.path) {
          // Fallback: render as SVG image (non-editable)
          const range = getSvgPathRange(el.path);
          const sw = el.strokeWidth || 0;
          const vbX = range.minX - sw;
          const vbY = range.minY - sw;
          const vbW = range.maxX - range.minX + sw * 2;
          const vbH = range.maxY - range.minY + sw * 2;

          const svgNS = 'http://www.w3.org/2000/svg';
          const svg = document.createElementNS(svgNS, 'svg');
          svg.setAttribute('xmlns', svgNS);
          svg.setAttribute('width', String(el.width));
          svg.setAttribute('height', String(el.height));
          svg.setAttribute('viewBox', `${vbX} ${vbY} ${vbW} ${vbH}`);
          svg.setAttribute('stroke', el.color || '#000000');
          svg.setAttribute('stroke-width', String(sw));
          svg.setAttribute('fill', 'none');
          svg.setAttribute('stroke-linecap', 'round');
          svg.setAttribute('stroke-linejoin', 'round');

          const path = document.createElementNS(svgNS, 'path');
          path.setAttribute('d', el.path);
          svg.appendChild(path);

          const base64SVG = svg2Base64(svg);
          if (!base64SVG) continue;

          const latexOptions: pptxgen.ImageProps = {
            data: base64SVG,
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
          };
          if (el.link) {
            const linkOption = getLinkOption(el.link, slides);
            if (linkOption) latexOptions.hyperlink = linkOption;
          }

          pptxSlide.addImage(latexOptions);
        }
      }

      // ── VIDEO / AUDIO ──
      else if (el.type === 'video' || el.type === 'audio') {
        const videoBinding =
          el.type === 'video'
            ? resolveVideoMediaForElement(
                useMediaGenerationStore.getState().tasks,
                el,
                stageId,
                documentElements,
              )
            : undefined;
        const sourceRef = videoBinding?.sourceRef ?? el.src;
        const resolvedSrc = await resolveManifestMedia(sourceRef, videoBinding?.task);

        if (!resolvedSrc) continue;

        // Fetch blob and convert to base64 for embedding in PPTX
        // (blob: URLs and remote URLs won't work in offline PPTX)
        try {
          const base64 = isBase64Image(resolvedSrc)
            ? resolvedSrc
            : await (async () => {
                const resp = await fetch(resolvedSrc);
                if (!resp.ok) {
                  throw new Error(`Failed to fetch media (HTTP ${resp.status}): ${resolvedSrc}`);
                }
                return blobToDataUrl(await resp.blob());
              })();

          const mediaOptions: pptxgen.MediaProps = {
            x: el.left / ratioPx2Inch,
            y: el.top / ratioPx2Inch,
            w: el.width / ratioPx2Inch,
            h: el.height / ratioPx2Inch,
            data: base64,
            type: el.type,
          };

          // Determine file extension
          const extMatch = resolvedSrc.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
          if (extMatch && extMatch[1]) mediaOptions.extn = extMatch[1];
          else if (el.ext) mediaOptions.extn = el.ext;
          else mediaOptions.extn = el.type === 'video' ? 'mp4' : 'mp3';

          // Generate cover image for video
          if (el.type === 'video') {
            let coverBase64: string | undefined;

            // 1. Try the poster the element (or its generation task) names,
            // resolved through the same shared chain as the media itself.
            const posterSrc = await resolveManifestMedia(
              videoBinding?.posterRef,
              videoBinding?.posterTask,
            );
            if (posterSrc) {
              if (isBase64Image(posterSrc)) {
                coverBase64 = posterSrc;
              } else {
                try {
                  const posterResp = await fetch(posterSrc);
                  if (!posterResp.ok) {
                    log.warn(`Failed to fetch poster (HTTP ${posterResp.status}), skipping`);
                  } else {
                    coverBase64 = await blobToDataUrl(await posterResp.blob());
                  }
                } catch {
                  // Poster fetch failed, fall through to video frame capture
                }
              }
            }

            // 2. Fallback: capture first frame from video via canvas
            if (!coverBase64) {
              try {
                coverBase64 = await new Promise<string>((resolve, reject) => {
                  const video = document.createElement('video');
                  video.crossOrigin = 'anonymous';
                  video.muted = true;
                  video.preload = 'auto';
                  video.onloadeddata = () => {
                    video.currentTime = 0;
                  };
                  video.onseeked = () => {
                    try {
                      const canvas = document.createElement('canvas');
                      canvas.width = video.videoWidth || el.width;
                      canvas.height = video.videoHeight || el.height;
                      const ctx = canvas.getContext('2d');
                      if (ctx) {
                        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                        resolve(canvas.toDataURL('image/png'));
                      } else {
                        reject(new Error('No canvas context'));
                      }
                      video.src = ''; // Release
                    } catch (e) {
                      reject(e);
                    }
                  };
                  video.onerror = () => reject(new Error('Video load failed'));
                  // Timeout to avoid hanging
                  setTimeout(() => reject(new Error('Video frame capture timeout')), 10000);
                  video.src = resolvedSrc;
                });
              } catch {
                // Frame capture also failed, video will use default play button
              }
            }

            if (coverBase64) mediaOptions.cover = coverBase64;
          }

          pptxSlide.addMedia(mediaOptions);
        } catch (err) {
          log.warn(`Failed to embed ${el.type} element:`, err);
        }
      }
    }
  }

  return (await pptx.write({ outputType: 'blob' })) as Blob;
}

// ── Resource Pack assembly (PPTX + interactive HTML pages as ZIP) ──
// Pure/async builder extracted from the hook so the assembly logic — which
// scenes make it into the ZIP, whether the PPTX builder runs — is unit-testable
// without a React/jsdom harness. The hook stays the only runtime caller.
//
// Interactive scenes become native launch slides in the PPTX, so their place in
// the lesson is never lost. Returns `empty: true` (and a null blob) when there
// is nothing to ship.

export interface OfflineInteractivePage {
  scene: Scene;
  number: number;
  archivePath: string;
}

export interface OfflineResourcePackDeck {
  /** Slides in the same order as the source course, including interactive launch pages. */
  slides: Slide[];
  /** Source scene paired with each generated PPTX slide for speaker notes. */
  slideScenes: Scene[];
  interactivePages: OfflineInteractivePage[];
}

function escapeOfflineHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function interactiveArchivePath(number: number): string {
  return `interactive/scene-${String(number).padStart(2, '0')}.html`;
}

/** Build a native PPTX launch slide whose link remains relative after ZIP extraction. */
export function buildOfflineInteractiveSlide(
  scene: Scene,
  page: OfflineInteractivePage,
  viewportSize: number,
  viewportRatio: number,
): Slide {
  const width = viewportSize;
  const height = viewportSize * viewportRatio;
  const buttonWidth = width * 0.44;
  const buttonLeft = (width - buttonWidth) / 2;
  const buttonTop = height * 0.58;
  const buttonHeight = Math.max(64, height * 0.14);
  const href = page.archivePath;

  return {
    id: `offline-interactive-${scene.id}`,
    viewportSize,
    viewportRatio,
    theme: {
      backgroundColor: '#f7f8f5',
      themeColors: ['#315846', '#d5a545'],
      fontColor: '#20352b',
      fontName: DEFAULT_FONT_FAMILY,
    },
    background: { type: 'solid', color: '#f7f8f5' },
    elements: [
      {
        id: `offline-label-${scene.id}`,
        type: 'text',
        left: width * 0.08,
        top: height * 0.1,
        width: width * 0.84,
        height: height * 0.08,
        rotate: 0,
        content: `<span style="font-size:16px;color:#315846;font-weight:bold">互动环节 ${String(page.number).padStart(2, '0')}</span>`,
        defaultFontName: DEFAULT_FONT_FAMILY,
        defaultColor: '#315846',
      },
      {
        id: `offline-title-${scene.id}`,
        type: 'text',
        left: width * 0.08,
        top: height * 0.2,
        width: width * 0.84,
        height: height * 0.18,
        rotate: 0,
        content: `<span style="font-size:38px;color:#20352b;font-weight:bold">${escapeOfflineHtml(scene.title || '课堂互动')}</span>`,
        defaultFontName: DEFAULT_FONT_FAMILY,
        defaultColor: '#20352b',
      },
      {
        id: `offline-description-${scene.id}`,
        type: 'text',
        left: width * 0.08,
        top: height * 0.4,
        width: width * 0.84,
        height: height * 0.1,
        rotate: 0,
        content:
          '<span style="font-size:18px;color:#5d667d">点击下方按钮，在默认浏览器中打开本地互动页面。</span>',
        defaultFontName: DEFAULT_FONT_FAMILY,
        defaultColor: '#5d667d',
      },
      {
        id: `offline-button-${scene.id}`,
        type: 'shape',
        left: buttonLeft,
        top: buttonTop,
        width: buttonWidth,
        height: buttonHeight,
        rotate: 0,
        viewBox: [100, 100],
        path: 'M 0 0 L 100 0 L 100 100 L 0 100 Z',
        fixedRatio: false,
        fill: '#315846',
        outline: { color: '#244436', width: 1, style: 'solid' },
        link: { type: 'web', target: href },
      },
      {
        id: `offline-button-label-${scene.id}`,
        type: 'text',
        left: buttonLeft,
        top: buttonTop,
        width: buttonWidth,
        height: buttonHeight,
        rotate: 0,
        content: `<a href="${href}"><span style="font-size:22px;color:#ffffff;font-weight:bold;text-align:center">打开离线互动页面</span></a>`,
        defaultFontName: DEFAULT_FONT_FAMILY,
        defaultColor: '#ffffff',
      },
      {
        id: `offline-hint-${scene.id}`,
        type: 'text',
        left: width * 0.08,
        top: height * 0.82,
        width: width * 0.84,
        height: height * 0.08,
        rotate: 0,
        content:
          '<span style="font-size:15px;color:#7b8498">互动完成后，按 Alt + Tab 返回 PowerPoint 继续授课</span>',
        defaultFontName: DEFAULT_FONT_FAMILY,
        defaultColor: '#7b8498',
      },
    ],
  };
}

/** Interleave normal slides and offline interactive launch pages by source order. */
export function buildOfflineResourcePackDeck(
  scenes: Scene[],
  viewportSize: number,
  viewportRatio: number,
): OfflineResourcePackDeck {
  const slides: Slide[] = [];
  const slideScenes: Scene[] = [];
  const interactivePages: OfflineInteractivePage[] = [];
  const ordered = scenes
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => a.scene.order - b.scene.order || a.index - b.index)
    .map(({ scene }) => scene);

  for (const scene of ordered) {
    if (scene.content.type === 'slide') {
      slides.push(scene.content.canvas);
      slideScenes.push(scene);
      continue;
    }
    if (scene.content.type === 'interactive' && scene.content.html) {
      const page: OfflineInteractivePage = {
        scene,
        number: interactivePages.length + 1,
        archivePath: interactiveArchivePath(interactivePages.length + 1),
      };
      interactivePages.push(page);
      slides.push(buildOfflineInteractiveSlide(scene, page, viewportSize, viewportRatio));
      slideScenes.push(scene);
    }
  }

  return { slides, slideScenes, interactivePages };
}

function buildOfflineIndex(fileName: string, pages: OfflineInteractivePage[]): string {
  const links = pages
    .map(
      (page) =>
        `<a class="scene" href="${page.archivePath}"><span>${String(page.number).padStart(2, '0')}</span><strong>${escapeOfflineHtml(page.scene.title || '课堂互动')}</strong></a>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeOfflineHtml(fileName)} · ${escapeOfflineHtml(DEFAULT_BRAND.productName)} 离线互动入口</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:"Microsoft YaHei",system-ui,sans-serif;color:#20352b;background:radial-gradient(circle at 50% 0,#e8efe8 0,#f8f8f4 52%,#f2f1e9 100%);padding:64px 24px}.shell{width:min(760px,100%);margin:auto}.eyebrow{color:#315846;font-weight:700;letter-spacing:.08em}.title{font-size:38px;margin:12px 0 8px}.hint{color:#66736b;margin:0 0 28px}.list{display:grid;gap:12px}.scene{display:flex;align-items:center;gap:16px;padding:18px 20px;border:1px solid #d8e1d8;border-radius:16px;background:rgba(255,255,255,.92);box-shadow:0 12px 36px rgba(42,75,54,.08);color:#20352b;text-decoration:none;transition:.18s ease}.scene:hover{transform:translateY(-2px);border-color:#789783;box-shadow:0 16px 40px rgba(42,75,54,.14)}.scene span{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:#315846;color:#fff;font-weight:700}.scene strong{font-size:17px}.footer{margin-top:24px;color:#758178;font-size:13px}
</style>
</head>
<body><main class="shell"><div class="eyebrow">${escapeOfflineHtml(DEFAULT_BRAND.productName)} · 离线互动课件</div><h1 class="title">${escapeOfflineHtml(fileName)}</h1><p class="hint">请选择要打开的互动场景。互动完成后按 Alt + Tab 返回 PowerPoint。</p><div class="list">${links}</div><p class="footer">请保持 PPTX、START.html 与 interactive 文件夹的相对位置不变。</p></main></body>
</html>`;
}

function buildOfflineReadme(fileName: string, interactiveCount: number, unified = false): string {
  if (unified)
    return `\uFEFF${DEFAULT_BRAND.productName} · ${fileName} · U 盘离线授课包

1. 完整解压 ZIP，将解压后的文件夹复制到 U 盘；不要在压缩包内运行。
2. 在 Windows 电脑用 Edge 或 Chrome 双击“开始授课.html”（START.html 是相同的英文入口）。
3. 点击“开始上课”。无需联网、登录、安装 Node.js 或启动服务器。
4. 底部按钮或方向键翻页；课程目录可跳转。互动页内可用 PageUp / PageDown 翻页。
5. 测验选择后点击“确认答案”，查看反馈，再点击“下一题”；不用等倒计时。
6. 可暂停 / 重播本页、播放已有配音、查看讲稿与板书。进度仅保留到关闭窗口。

备用方案
- ${fileName}.pptx 为备用演示文件，不是完整交互播放器。
- 若使用备用 PPTX，互动通过本地链接打开，结束后 Alt + Tab 返回。
- “开始授课.cmd”是可选的 Windows 快捷入口；学校禁止脚本时直接打开 HTML 即可。

授课前必须在目标电脑断网试播，检查字体、画面、互动与声音。
普通课件页按高清静态画面呈现，原有逐元素入场 / 高亮动作不回放；HTML 互动动画保持可操作，音视频可手动播放。
已有配音嵌入包内；未生成配音的段落由教师讲解，不提供离线 AI 对话或实时生成。
自定义互动仍按其自身规则运行；暂停可冻结常见页面计时 / 动画，不能替代逐页试播。
`;
  return `\uFEFF${DEFAULT_BRAND.productName} · ${fileName} · Windows 离线演示包

使用步骤
1. 请先完整解压 ZIP，不要直接在压缩包中打开文件。
2. 双击“开始授课.cmd”；也可以使用 Microsoft PowerPoint 手动打开 ${fileName}.pptx。
3. 播放到“互动环节”页面时，点击“打开离线互动页面”。
4. 如 PowerPoint 首次显示安全提醒，请确认打开本地链接。
5. 互动结束后按 Alt + Tab 返回 PowerPoint。

备用入口
- 双击 START.html 可以查看全部 ${interactiveCount} 个互动页面。
- 请勿单独移动 PPTX、START.html 或 interactive 文件夹，否则本地链接会失效。

本课件为离线演示包，不需要联网，也不需要安装 Node.js。
`;
}

function buildWindowsLauncher(unified = false): string {
  return `@echo off\r
setlocal\r
cd /d "%~dp0"\r
${unified ? 'if exist "START.html" (\r\n  start "" "%~dp0START.html"\r\n  exit /b 0\r\n)\r\n' : ''}\
for %%F in (*.pptx) do (\r
  start "" "%%~fF"\r
  exit /b 0\r
)\r
if exist "START.html" start "" "%~dp0START.html"\r
echo No PowerPoint file was found.\r
pause\r
`;
}

const educationStageLabels: Record<SchoolCourseProfile['educationStage'], string> = {
  primary: '小学',
  junior: '初中',
  senior: '高中',
  vocational: '职业教育',
  higher: '高等教育',
  other: '其他',
};

const lessonTypeLabels: Record<SchoolCourseProfile['lessonType'], string> = {
  new: '新授课',
  review: '复习课',
  experiment: '实验课',
  practice: '练习课',
  project: '项目课',
  other: '其他',
};

function buildTeacherGuide(fileName: string, profile: SchoolCourseProfile): string {
  return `\uFEFF${fileName} · 教师授课指南

课程信息
- 学段：${educationStageLabels[profile.educationStage]}
- 年级：${profile.grade || '未填写'}
- 学科：${profile.subject || '未填写'}
- 教材：${[profile.textbookVersion, profile.volume, profile.unit].filter(Boolean).join(' · ') || '未填写'}
- 课型：${lessonTypeLabels[profile.lessonType]}
- 计划课时：${profile.durationMinutes}分钟

教学设计
- 学习目标：${profile.learningObjectives || '未填写'}
- 教学重点：${profile.keyPoints || '未填写'}
- 教学难点：${profile.difficultPoints || '未填写'}
- 学情分析：${profile.learnerProfile || '未填写'}
- 互动上限：${profile.interactionBudget}个

授课前检查
1. 提前在授课电脑完整解压，双击“开始授课.html”断网试播（旧资源包可试播 PPTX）。
2. 逐个打开互动页面，检查字体、动画、按钮、音视频和屏幕比例。
3. 任课教师核对知识准确性、实验安全、课堂用语及资料来源。
4. 准备无互动页面时的口头提问或板书备用方案。

资料依据
${profile.sourceReferences || '未填写；正式授课前必须补充并核验。'}
`;
}

function buildAuditReport(fileName: string, report: CourseAuditReport): string {
  const status =
    report.status === 'approved'
      ? '通过'
      : report.status === 'review-needed'
        ? '通过（有改进建议）'
        : '未通过';
  const issues =
    report.issues.length === 0
      ? '无'
      : report.issues
          .map(
            (item, index) =>
              `${index + 1}. [${item.severity === 'blocking' ? '阻断' : item.severity === 'warning' ? '建议' : '提示'}] ${item.title}${item.sceneTitle ? `（${item.sceneTitle}）` : ''}\n   ${item.detail}`,
          )
          .join('\n');
  return `\uFEFF${fileName} · 学校课件审核报告

审核结论：${status}
审核分：${report.score}
阻断项：${report.blockingCount}
建议项：${report.warningCount}
页面数：${report.stats.sceneCount}
互动数：${report.stats.interactiveCount}
测验数：${report.stats.quizCount}
预计授课时间：${report.stats.estimatedMinutes}分钟

检查明细
${issues}

说明：本报告来自规则自动检查，不能替代任课教师、教研组及学校的正式审核。
`;
}

export interface ResourcePackResult {
  /** Generated ZIP blob, or null when there is nothing to ship. */
  blob: Blob | null;
  /** Compatibility field; every non-empty offline deck now includes a PPTX. */
  skippedPptx: boolean;
  /** True when neither slides nor interactive pages could be exported. */
  empty: boolean;
  /** External asset URLs that could not be inlined into the HTML pages. */
  failedAssetUrls: string[];
}

export class OfflineResourcePackAssetError extends Error {
  constructor(readonly urls: string[]) {
    super(`Offline resource pack has ${urls.length} external asset(s) that could not be embedded`);
    this.name = 'OfflineResourcePackAssetError';
  }
}

export async function buildResourcePackZip(
  scenes: Scene[],
  slides: Slide[],
  slideScenes: Scene[],
  opts: {
    viewportRatio: number;
    viewportSize: number;
    ratioPx2Inch: number;
    ratioPx2Pt: number;
    fileName: string;
    /** Produces the PPTX from the interleaved offline deck. */
    getPptxBlob: (deck: OfflineResourcePackDeck) => Promise<Blob>;
    /** Passed through to `inlineHtmlAssets`; tests inject a no-op fetcher. */
    fetcher?: FetchAsset;
    /** Fail the export when any remote asset could not be embedded for offline use. */
    strictOffline?: boolean;
    /** Optional school profile used to generate the teacher-facing delivery guide. */
    schoolCourseProfile?: SchoolCourseProfile;
    /** Optional rule-based report captured at export time. */
    auditReport?: CourseAuditReport;
    /** Browser renderer produces the self-contained, unified classroom player. */
    getOfflinePlayer?: (htmlByScene: Map<string, string>) => Promise<string>;
  },
): Promise<ResourcePackResult> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const failedAssetUrls: string[] = [];

  if (slides.length !== slideScenes.length) {
    throw new Error('Resource pack slide/scene inputs are out of sync');
  }

  const deck = buildOfflineResourcePackDeck(scenes, opts.viewportSize, opts.viewportRatio);
  const htmlByScene = new Map<string, string>();

  // 1. Add self-contained interactive HTML pages.
  for (const page of deck.interactivePages) {
    const content = page.scene.content;
    if (content.type === 'interactive' && content.html) {
      const { html: inlinedHtml, report } = await inlineHtmlAssets(content.html, {
        fetcher: opts.fetcher,
        keepImportmapFallbacks: !opts.strictOffline,
      });
      for (const f of report.failed) {
        if (!failedAssetUrls.includes(f.url)) failedAssetUrls.push(f.url);
      }
      zip.file(page.archivePath, inlinedHtml);
      htmlByScene.set(page.scene.id, inlinedHtml);
    }
  }

  // Nothing to ship: no normal slides and no interactive pages.
  if (deck.slides.length === 0 && (!opts.getOfflinePlayer || scenes.length === 0)) {
    return { blob: null, skippedPptx: false, empty: true, failedAssetUrls };
  }

  if (opts.strictOffline && failedAssetUrls.length > 0) {
    throw new OfflineResourcePackAssetError(failedAssetUrls);
  }

  // 2. Generate one PPTX containing both normal slides and interactive launch pages.
  const playerHtml = opts.getOfflinePlayer ? await opts.getOfflinePlayer(htmlByScene) : undefined;
  const skippedPptx = deck.slides.length === 0;
  if (!skippedPptx) {
    const pptxBlob = await opts.getPptxBlob(deck);
    // Convert to ArrayBuffer so jszip stores a plain byte buffer rather than a
    // Blob (which it can't reliably round-trip outside the browser).
    zip.file(`${opts.fileName}.pptx`, await pptxBlob.arrayBuffer());
  }

  // 3. Human-friendly offline entry points.
  if (playerHtml) {
    zip.file('开始授课.html', playerHtml);
    zip.file('START.html', playerHtml);
  } else if (deck.interactivePages.length > 0) {
    zip.file('START.html', buildOfflineIndex(opts.fileName, deck.interactivePages));
  }
  zip.file(
    '使用说明.txt',
    buildOfflineReadme(opts.fileName, deck.interactivePages.length, !!playerHtml),
  );
  zip.file('开始授课.cmd', buildWindowsLauncher(!!playerHtml));
  if (opts.schoolCourseProfile?.enabled) {
    zip.file('教师授课指南.txt', buildTeacherGuide(opts.fileName, opts.schoolCourseProfile));
  }
  if (opts.auditReport && opts.auditReport.status !== 'not-enabled') {
    zip.file('课件审核报告.txt', buildAuditReport(opts.fileName, opts.auditReport));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return { blob, skippedPptx, empty: false, failedAssetUrls };
}

// ── Hook ──

export function useExportPPTX() {
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const { t } = useI18n();

  const scenes = useStageStore((s) => s.scenes);
  const stage = useStageStore((s) => s.stage);
  const outlines = useStageStore((s) => s.outlines);
  const viewportSize = useCanvasStore.use.viewportSize();
  const viewportRatio = useCanvasStore.use.viewportRatio();

  const ratioPx2Inch = 96 * (viewportSize / 960);
  const ratioPx2Pt = (96 / 72) * (viewportSize / 960);

  const slideScenes = scenes.filter((s) => s.content.type === 'slide');
  const slides = slideScenes.map((s) => (s.content as SlideContent).canvas);

  // Shared guard + state wrapper for export actions.
  // `requireSlides` controls whether the guard rejects a deck with no slide
  // scenes (PPTX export needs them; the resource pack can ship interactive
  // pages alone). When it rejects, callers get a toast instead of silence.
  const withExportGuard = useCallback(
    (action: () => Promise<void>, requireSlides = true) => {
      if (exportingRef.current) return;
      if (requireSlides && slides.length === 0) {
        toast.warning(t('export.noSlides'));
        return;
      }
      exportingRef.current = true;
      setExporting(true);
      setTimeout(async () => {
        try {
          await action();
        } catch (err) {
          log.error('Export failed:', err);
          if (err instanceof OfflineResourcePackAssetError) {
            const hosts = [
              ...new Set(
                err.urls.map((url) => {
                  try {
                    return new URL(url).host;
                  } catch {
                    return url;
                  }
                }),
              ),
            ];
            toast.error(t('export.offlineAssetsFailed', { count: err.urls.length }), {
              description: hosts.join(', '),
            });
          } else if (err instanceof OfflinePlayerError) {
            toast.error(t('export.exportFailed'), { description: err.message, duration: 12000 });
          } else {
            toast.error(t('export.exportFailed'));
          }
        } finally {
          exportingRef.current = false;
          setExporting(false);
        }
      }, 100);
    },
    [slides.length, t],
  );

  // ── Export PPTX only ──
  const exportPPTX = useCallback(() => {
    withExportGuard(async () => {
      const fileName = stage?.name || 'slides';
      const blob = await buildPptxBlob(
        slides,
        slideScenes,
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        stage?.id,
      );
      saveAs(blob, `${fileName}.pptx`);
      toast.success(t('export.exportSuccess'));
    });
  }, [
    withExportGuard,
    slides,
    slideScenes,
    stage,
    viewportSize,
    viewportRatio,
    ratioPx2Inch,
    ratioPx2Pt,
    t,
  ]);

  // ── Export Resource Pack (PPTX + interactive HTML pages as ZIP) ──
  // Interactive scenes are inserted into the PPTX at their original positions
  // as launch slides linked to their matching offline HTML pages.
  const exportResourcePack = useCallback(() => {
    withExportGuard(async () => {
      const fileName = stage?.name || 'slides';
      const sharedFetcher = createAssetFetcher({
        fetchImpl: createProxiedFetch({ crossOriginOnly: true }),
        maxAssetBytes: 128 * 1024 * 1024,
      });
      const { createOfflineCollector } = await import('./offline-player/collect');
      const collector = createOfflineCollector(sharedFetcher, viewportSize, viewportRatio);

      const result = await buildResourcePackZip(scenes, slides, slideScenes, {
        viewportRatio,
        viewportSize,
        ratioPx2Inch,
        ratioPx2Pt,
        fileName,
        fetcher: sharedFetcher,
        strictOffline: true,
        getOfflinePlayer: async (htmlByScene) =>
          buildOfflinePlayerHtml(
            await buildOfflineLesson(scenes, fileName, htmlByScene, collector),
          ),
        schoolCourseProfile: stage?.schoolCourseProfile,
        auditReport: auditSchoolCourse(stage, scenes, outlines),
        getPptxBlob: (deck) =>
          buildPptxBlob(
            deck.slides,
            deck.slideScenes,
            viewportRatio,
            viewportSize,
            ratioPx2Inch,
            ratioPx2Pt,
            stage?.id,
          ),
      });

      if (result.empty) {
        toast.warning(t('export.nothingToExport'));
        return;
      }
      saveAs(result.blob!, `${fileName}.zip`);
      toast.success(t('export.exportSuccess'));
    }, false);
  }, [
    withExportGuard,
    slides,
    slideScenes,
    scenes,
    stage,
    outlines,
    viewportSize,
    viewportRatio,
    ratioPx2Inch,
    ratioPx2Pt,
    t,
  ]);

  return { exporting, exportPPTX, exportResourcePack };
}
