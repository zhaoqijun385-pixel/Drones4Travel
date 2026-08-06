export const DEMO_AUTO_SPEED_MPS = 8;
export const DEMO_GROUND_HEIGHT = 0.12;

export function advanceManualFlight(drone, deltaMs, altitudeOrigin = 0) {
  if (!drone || !Number.isFinite(Number(drone.autoTargetZ))) return null;
  const target = Number(drone.autoTargetZ);
  const current = Number(drone.z || 0);
  const deltaZ = target - current;
  const maxStep = DEMO_AUTO_SPEED_MPS * (Math.max(0, Number(deltaMs) || 0) / 1000);
  const complete = Math.abs(deltaZ) <= Math.max(0.02, maxStep);
  const z = complete ? target : current + Math.sign(deltaZ) * maxStep;
  const landing = drone.autoAction === 'land';
  return {
    z,
    alt: Number(altitudeOrigin || 0) + z,
    phase: complete ? (landing ? 'parked' : 'holding') : (deltaZ > 0 ? 'takeoff' : 'landing'),
    autoTargetZ: complete ? null : target,
    autoAction: complete ? '' : drone.autoAction,
    complete,
  };
}

// Apply one operator-controlled ENU step to a remote demo aircraft.  This is
// deliberately separate from the local altitude gate: a remote aircraft must
// never be snapped to the local drone's sampled ground surface.
export function applyManualFlightMove(drone, enuMove = {}, altitudeOrigin = 0, yawDelta = 0) {
  if (!drone) return null;
  const x = Number(drone.x || 0) + Number(enuMove.x || 0);
  const y = Number(drone.y || 0) + Number(enuMove.y || 0);
  const z = Math.max(DEMO_GROUND_HEIGHT, Number(drone.z || DEMO_GROUND_HEIGHT) + Number(enuMove.z || 0));
  const currentYaw = Number(drone.yaw ?? drone.heading ?? 0);
  const yaw = ((currentYaw + Number(yawDelta || 0)) % 360 + 360) % 360;
  return {
    x,
    y,
    z,
    alt: Number(altitudeOrigin || 0) + z,
    yaw,
    phase: z <= DEMO_GROUND_HEIGHT + 0.001 ? 'parked' : 'holding',
    autoTargetZ: null,
    autoAction: '',
  };
}
