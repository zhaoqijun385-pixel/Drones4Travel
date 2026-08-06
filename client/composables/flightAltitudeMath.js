export const GROUND_ENTER_THRESHOLD = 0.2;
export const GROUND_EXIT_THRESHOLD = 0.45;
export const ALTITUDE_INPUT_DEADZONE = 0.08;
export const ALTITUDE_MIN_SPEED_MPS = 0.15;
export const ALTITUDE_MAX_SPEED_MPS = 3;
export const ALTITUDE_DESCENT_MIN_SPEED_MPS = 0.3;
export const ALTITUDE_DESCENT_MAX_SPEED_MPS = 8;

// Convert the H-mode joystick displacement into an actual vertical speed.
// The center deadzone removes touch/trackpad noise, while the curve gives
// fine control near the center. Descent intentionally has a separate, higher
// limit so returning from altitude is responsive instead of feeling stalled.
// Keyboard values (currently +/-3) are clamped to the same endpoints.
export function altitudeSpeedFromInput(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.min(1, Math.abs(value));
  if (magnitude <= ALTITUDE_INPUT_DEADZONE) return 0;
  const normalized = (magnitude - ALTITUDE_INPUT_DEADZONE) / (1 - ALTITUDE_INPUT_DEADZONE);
  const curved = Math.pow(normalized, 1.6);
  const descending = value < 0;
  const minSpeed = descending ? ALTITUDE_DESCENT_MIN_SPEED_MPS : ALTITUDE_MIN_SPEED_MPS;
  const maxSpeed = descending ? ALTITUDE_DESCENT_MAX_SPEED_MPS : ALTITUDE_MAX_SPEED_MPS;
  const speed = minSpeed + (maxSpeed - minSpeed) * curved;
  return Math.sign(value) * speed;
}

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
