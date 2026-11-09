import type { ManifestScene, ManifestStage } from '@/lib/export/classroom-zip-types';

export type AnnotationTool = 'pen' | 'eraser';

export interface AnnotationPoint {
  x: number;
  y: number;
}

export interface AnnotationStroke {
  tool: AnnotationTool;
  color: string;
  width: number;
  points: AnnotationPoint[];
}

export type SceneAnnotations = Record<string, AnnotationStroke[]>;

export interface AnnotationDocument {
  format: 'openmaic-annotations';
  version: 1;
  fingerprint: string;
  courseName: string;
  sceneKeys: string[];
  annotations: SceneAnnotations;
}

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_IMPORTED_STROKES = 10_000;
const MAX_IMPORTED_POINTS = 500_000;

export function annotationSceneKey(scene: ManifestScene): string {
  return `${scene.order}:${scene.type}:${scene.title}`;
}

/** Stable across re-exports of the same course; the export timestamp is ignored. */
export function annotationFingerprint(
  stage: ManifestStage,
  scenes: readonly ManifestScene[],
): string {
  const source = JSON.stringify({
    name: stage.name,
    createdAt: stage.createdAt,
    updatedAt: stage.updatedAt,
    scenes: scenes.map((scene) => ({
      order: scene.order,
      type: scene.type,
      title: scene.title,
    })),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function annotationStorageKey(fingerprint: string): string {
  return `openmaic-annotations-v1:${fingerprint}`;
}

export function createAnnotationDocument(
  fingerprint: string,
  courseName: string,
  sceneKeys: string[],
  annotations: SceneAnnotations,
): AnnotationDocument {
  return {
    format: 'openmaic-annotations',
    version: 1,
    fingerprint,
    courseName,
    sceneKeys,
    annotations,
  };
}

export type AnnotationDocumentParseResult =
  | { status: 'ok'; annotations: SceneAnnotations }
  | { status: 'invalid' }
  | { status: 'course-mismatch' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate imported files before drawing or storing any of their content. */
export function parseAnnotationDocument(
  value: unknown,
  fingerprint: string,
  allowedSceneKeys: readonly string[],
): AnnotationDocumentParseResult {
  if (!isRecord(value) || value.format !== 'openmaic-annotations' || value.version !== 1) {
    return { status: 'invalid' };
  }
  if (value.fingerprint !== fingerprint) return { status: 'course-mismatch' };
  if (!isRecord(value.annotations)) return { status: 'invalid' };

  const allowed = new Set(allowedSceneKeys);
  const annotations: SceneAnnotations = {};
  let strokeCount = 0;
  let pointCount = 0;

  for (const [sceneKey, rawStrokes] of Object.entries(value.annotations)) {
    if (!allowed.has(sceneKey) || !Array.isArray(rawStrokes)) return { status: 'invalid' };
    const strokes: AnnotationStroke[] = [];

    for (const rawStroke of rawStrokes) {
      if (!isRecord(rawStroke)) return { status: 'invalid' };
      const { tool, color, width, points } = rawStroke;
      if (
        (tool !== 'pen' && tool !== 'eraser') ||
        typeof color !== 'string' ||
        !/^#[\da-f]{3,8}$/i.test(color) ||
        typeof width !== 'number' ||
        !Number.isFinite(width) ||
        width < 1 ||
        width > 24 ||
        !Array.isArray(points) ||
        points.length === 0
      ) {
        return { status: 'invalid' };
      }

      const parsedPoints: AnnotationPoint[] = [];
      for (const point of points) {
        if (
          !isRecord(point) ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number' ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.x > 1 ||
          point.y < 0 ||
          point.y > 1
        ) {
          return { status: 'invalid' };
        }
        parsedPoints.push({ x: point.x, y: point.y });
      }

      strokeCount += 1;
      pointCount += parsedPoints.length;
      if (strokeCount > MAX_IMPORTED_STROKES || pointCount > MAX_IMPORTED_POINTS) {
        return { status: 'invalid' };
      }
      strokes.push({ tool, color, width, points: parsedPoints });
    }

    annotations[sceneKey] = strokes;
  }

  return { status: 'ok', annotations };
}

export function maxAnnotationImportBytes(): number {
  return MAX_IMPORT_BYTES;
}
