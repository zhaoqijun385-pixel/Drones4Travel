export const GROUND_ENTER_THRESHOLD = 0.2;
export const GROUND_EXIT_THRESHOLD = 0.45;

export function groundContactFromRelative(relativeAlt, current = true) {
  const relative = Number(relativeAlt);
  if (!Number.isFinite(relative)) return Boolean(current);
  if (relative <= GROUND_ENTER_THRESHOLD) return true;
  if (relative >= GROUND_EXIT_THRESHOLD) return false;
  return Boolean(current);
}

export function clampDescentToSurface(currentAlt, surfaceAlt, deltaAlt, hasSurfaceSample = true) {
  const delta = Number(deltaAlt);
  if (!hasSurfaceSample || !Number.isFinite(delta) || delta >= 0) return delta;
  const floorDelta = Number(surfaceAlt) - Number(currentAlt);
  if (!Number.isFinite(floorDelta)) return delta;
  return Math.max(floorDelta, delta);
}
