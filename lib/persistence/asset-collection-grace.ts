import { DEFAULT_ASSET_COLLECTION_GRACE_MS } from '@ljkt/storage';

/** Course history may restore media references from edits made up to 45 minutes ago. */
export const MIN_ASSET_COLLECTION_GRACE_MS = 45 * 60 * 1000;

/**
 * The reclamation grace this process runs with.
 *
 * Two components need it and must agree: the collector, which deletes
 * unreferenced bytes once it has elapsed, and the persistence route, which has
 * to declare it to enable indirect byte egress so the handler can check that a
 * signed URL expires long before the object it names can be collected. Two
 * parsers of one variable could disagree about what an invalid value means, and
 * the handler would then validate its lifetime against a grace nothing
 * enforces, so the parse lives here once.
 *
 * An unset, empty, invalid, or too-short value resolves to the package default
 * rather than failing. Course-level undo can restore media references from edits
 * made up to 45 minutes ago, so a lower collector grace could delete live media.
 */
export function resolveAssetCollectionGraceMs(): number {
  const raw = process.env.ASSET_COLLECTION_GRACE_MS?.trim();
  if (!raw) return DEFAULT_ASSET_COLLECTION_GRACE_MS;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < MIN_ASSET_COLLECTION_GRACE_MS) {
    console.warn(
      `ASSET_COLLECTION_GRACE_MS=${raw} is not an integer of at least ${MIN_ASSET_COLLECTION_GRACE_MS} milliseconds; ` +
        `using ${DEFAULT_ASSET_COLLECTION_GRACE_MS}`,
    );
    return DEFAULT_ASSET_COLLECTION_GRACE_MS;
  }
  return parsed;
}
