const CRUISE_HEIGHT = 0.9;
const GROUND_HEIGHT = 0.12;
const DEFAULT_SPEED = 2.4;

export const DEMO_POINTS = Object.freeze([
  { id: 'alpha', label: 'A', x: -18, y: 16 },
  { id: 'bravo', label: 'B', x: 18, y: 16 },
  { id: 'charlie', label: 'C', x: 18, y: -16 },
  { id: 'delta', label: 'D', x: -18, y: -16 },
  { id: 'center', label: '中心', x: 0, y: 0 },
]);

export const MISSION_PRESETS = Object.freeze([
  {
    id: 'inspection',
    labelKey: 'inspection',
    pointIds: ['alpha', 'bravo', 'charlie', 'delta'],
  },
  {
    id: 'cross',
    labelKey: 'cross',
    pointIds: ['charlie', 'delta', 'alpha', 'bravo'],
  },
  {
    id: 'return',
    labelKey: 'return',
    pointIds: [],
  },
]);

export function parkingPose(index) {
  if (index <= 0) return { x: 0, y: 0, z: GROUND_HEIGHT };
  const slot = index - 1;
  const column = slot % 5;
  const row = Math.floor(slot / 5);
  return {
    x: -12 + column * 6,
    y: -8 - row * 6,
    z: GROUND_HEIGHT,
  };
}

function distance(a, b) {
  return Math.hypot(Number(a.x || 0) - Number(b.x || 0), Number(a.y || 0) - Number(b.y || 0));
}

function bestAssignment(drones, points) {
  const remaining = [...points];
  const assignment = new Map();
  [...drones]
    .sort((a, b) => {
      const aNearest = Math.min(...remaining.map((point) => distance(a, point)), Infinity);
      const bNearest = Math.min(...remaining.map((point) => distance(b, point)), Infinity);
      return aNearest - bNearest;
    })
    .forEach((drone) => {
      if (!remaining.length) return;
      let bestIndex = 0;
      let bestDistance = Infinity;
      remaining.forEach((point, index) => {
        const candidate = distance(drone, point);
        if (candidate < bestDistance) {
          bestDistance = candidate;
          bestIndex = index;
        }
      });
      assignment.set(drone.droneId, remaining.splice(bestIndex, 1)[0]);
    });
  return assignment;
}

function segment(from, to, speed = DEFAULT_SPEED, holdMs = 0, phase = 'enroute') {
  const metres = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  return {
    from,
    to,
    durationMs: Math.max(450, (metres / speed) * 1000),
    holdMs,
    phase,
  };
}

function buildRoute(drone, target, index, returnOnly = false) {
  const home = {
    x: Number(drone.homeX ?? drone.x ?? 0),
    y: Number(drone.homeY ?? drone.y ?? 0),
    z: GROUND_HEIGHT,
  };
  const cruiseHeight = CRUISE_HEIGHT + (index % 3) * 0.12;
  const airborneHome = { ...home, z: cruiseHeight };
  const destination = target
    ? { x: target.x, y: target.y, z: cruiseHeight }
    : airborneHome;
  const corridorY = home.y - 5 - index * 4;
  const exit = { x: home.x, y: corridorY, z: cruiseHeight };
  const ingress = { x: destination.x, y: corridorY, z: cruiseHeight };
  const current = {
    x: Number(drone.x || 0),
    y: Number(drone.y || 0),
    z: Math.max(GROUND_HEIGHT, Number(drone.z || GROUND_HEIGHT)),
  };
  const segments = [];

  if (returnOnly) {
    if (current.z < cruiseHeight - 0.05) segments.push(segment(current, { ...current, z: cruiseHeight }, 0.7, 0, 'takeoff'));
    segments.push(segment(segments.length ? segments.at(-1).to : current, airborneHome, DEFAULT_SPEED, 0, 'returning'));
    segments.push(segment(airborneHome, home, 0.6, 0, 'landing'));
  } else {
    segments.push(segment(current, airborneHome, 0.7, 0, 'takeoff'));
    segments.push(segment(airborneHome, exit, DEFAULT_SPEED, 0, 'enroute'));
    segments.push(segment(exit, ingress, DEFAULT_SPEED, 0, 'enroute'));
    segments.push(segment(ingress, destination, DEFAULT_SPEED, 1400, 'enroute'));
    segments.push(segment(destination, ingress, DEFAULT_SPEED, 0, 'returning'));
    segments.push(segment(ingress, exit, DEFAULT_SPEED, 0, 'returning'));
    segments.push(segment(exit, airborneHome, DEFAULT_SPEED, 0, 'returning'));
    segments.push(segment(airborneHome, home, 0.6, 0, 'landing'));
  }

  return {
    droneId: drone.droneId,
    targetId: target?.id || 'home',
    targetLabel: target?.label || 'HOME',
    delayMs: index * 650,
    totalMs: segments.reduce((sum, item) => sum + item.durationMs + item.holdMs, 0),
    segments,
  };
}

function staggerRoutes(routes, gapMs = 900) {
  let releaseAt = 0;
  routes.forEach((route) => {
    route.delayMs = releaseAt;
    releaseAt += gapMs;
  });
  return routes;
}

function buildDirectGatherRoute(drone, target, index) {
  const current = {
    x: Number(drone.x || 0),
    y: Number(drone.y || 0),
    z: Math.max(GROUND_HEIGHT, Number(drone.z || GROUND_HEIGHT)),
  };
  const cruiseHeight = CRUISE_HEIGHT + (index % 3) * 0.12;
  const airborneStart = { ...current, z: cruiseHeight };
  const airborneTarget = { x: target.x, y: target.y, z: cruiseHeight };
  const groundTarget = { x: target.x, y: target.y, z: GROUND_HEIGHT };
  const segments = [
    segment(current, airborneStart, 0.7, 0, 'takeoff'),
    segment(airborneStart, airborneTarget, DEFAULT_SPEED, 600, 'enroute'),
    segment(airborneTarget, groundTarget, 0.6, 0, 'landing'),
  ];
  return {
    droneId: drone.droneId,
    targetId: target.id,
    targetLabel: target.label,
    delayMs: index * 900,
    totalMs: segments.reduce((sum, item) => sum + item.durationMs + item.holdMs, 0),
    segments,
  };
}

function buildDirectNavigateRoute(drone, target) {
  const current = {
    x: Number(drone.x || 0),
    y: Number(drone.y || 0),
    z: Math.max(GROUND_HEIGHT, Number(drone.z || GROUND_HEIGHT)),
  };
  const transitHeight = 4.2;
  const meetingHeight = 1.1;
  const transitStart = { ...current, z: transitHeight };
  const transitTarget = { x: target.x, y: target.y, z: transitHeight };
  const meetingTarget = { x: target.x, y: target.y, z: meetingHeight };
  const segments = [
    segment(current, transitStart, 1.2, 0, 'takeoff'),
    segment(transitStart, transitTarget, DEFAULT_SPEED, 0, 'enroute'),
    segment(transitTarget, meetingTarget, 1.0, 800, 'onstation'),
  ];
  return {
    droneId: drone.droneId,
    targetId: target.id,
    targetLabel: target.label,
    delayMs: 0,
    totalMs: segments.reduce((sum, item) => sum + item.durationMs + item.holdMs, 0),
    completionPhase: 'onstation',
    segments,
  };
}

export function planMission(drones, presetId = 'inspection') {
  const active = drones.filter((drone) => !drone.local && drone.online !== false);
  const preset = MISSION_PRESETS.find((item) => item.id === presetId) || MISSION_PRESETS[0];
  const points = preset.pointIds
    .map((id) => DEMO_POINTS.find((point) => point.id === id))
    .filter(Boolean);
  const assignment = bestAssignment(active, points);
  const routes = active.map((drone, index) =>
    buildRoute(drone, assignment.get(drone.droneId), index, preset.id === 'return'));
  // Conservative first release: each low-altitude route owns the corridor
  // before the next drone departs. This trades throughput for a deterministic
  // three-metre separation guarantee and avoids pretending that a browser demo
  // has a certified multi-agent deconfliction system.
  let releaseAt = 0;
  routes.forEach((route) => {
    route.delayMs = releaseAt;
    releaseAt += route.totalMs + 1000;
  });
  return {
    id: `${preset.id}-${Date.now().toString(36)}`,
    presetId: preset.id,
    createdAt: Date.now(),
    routes,
  };
}

export function planNavigateMission(drones, droneId, targetDroneId) {
  const source = drones.find((drone) => drone.droneId === droneId && !drone.local && drone.online !== false);
  const targetDrone = drones.find((drone) => drone.droneId === targetDroneId && drone.online !== false);
  if (!source || !targetDrone || source.droneId === targetDrone.droneId) return null;
  const angle = [...String(source.droneId)].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360;
  const radians = (angle * Math.PI) / 180;
  const target = {
    id: `meet-${targetDrone.droneId}`,
    label: targetDrone.local ? 'ME' : targetDrone.name,
    x: Number(targetDrone.x || 0) + Math.cos(radians) * 4.5,
    y: Number(targetDrone.y || 0) + Math.sin(radians) * 4.5,
  };
  const route = buildDirectNavigateRoute(source, target);
  return {
    id: `navigate-${Date.now().toString(36)}`,
    presetId: 'navigate',
    createdAt: Date.now(),
    routes: [route],
  };
}

export function planGatherMission(drones, anchorDroneId) {
  const anchor = drones.find((drone) => drone.droneId === anchorDroneId && drone.online !== false);
  const active = drones.filter((drone) => !drone.local && drone.online !== false && drone.droneId !== anchorDroneId);
  if (!anchor || !active.length) return null;
  const slots = active.map((_, index) => {
    const row = Math.floor(index / 4);
    const column = index % 4;
    return {
      id: `gather-${index}`,
      label: '集合点',
      x: Number(anchor.x || 0) + (column - 1.5) * 6,
      y: Number(anchor.y || 0) - 7 - row * 6,
    };
  });
  const assignment = bestAssignment(active, slots);
  const routes = active.map((drone, index) =>
    buildDirectGatherRoute(drone, assignment.get(drone.droneId), index));
  staggerRoutes(routes);
  return {
    id: `gather-${Date.now().toString(36)}`,
    presetId: 'gather',
    createdAt: Date.now(),
    routes,
  };
}

export function sampleRoute(route, elapsedMs) {
  const delayed = elapsedMs - route.delayMs;
  if (delayed <= 0) {
    const first = route.segments[0]?.from || { x: 0, y: 0, z: GROUND_HEIGHT };
    return { ...first, phase: 'queued', progress: 0, complete: false };
  }
  let cursor = 0;
  for (const item of route.segments) {
    const segmentEnd = cursor + item.durationMs;
    if (delayed <= segmentEnd) {
      const progress = Math.max(0, Math.min(1, (delayed - cursor) / item.durationMs));
      return {
        x: item.from.x + (item.to.x - item.from.x) * progress,
        y: item.from.y + (item.to.y - item.from.y) * progress,
        z: item.from.z + (item.to.z - item.from.z) * progress,
        phase: item.phase,
        progress: Math.min(0.99, delayed / route.totalMs),
        complete: false,
      };
    }
    cursor = segmentEnd;
    if (delayed <= cursor + item.holdMs) {
      return {
        ...item.to,
        phase: item.phase === 'enroute' ? 'onstation' : item.phase,
        progress: Math.min(0.99, delayed / route.totalMs),
        complete: false,
      };
    }
    cursor += item.holdMs;
  }
  const last = route.segments.at(-1)?.to || { x: 0, y: 0, z: GROUND_HEIGHT };
  return { ...last, phase: route.completionPhase || 'parked', progress: 1, complete: true };
}

export function routePolyline(route) {
  const points = [];
  route.segments.forEach((item) => {
    if (!points.length) points.push({ ...item.from });
    points.push({ ...item.to });
  });
  return points;
}

export function advanceMission(mission, drones, deltaMs, safetyDistance = 3) {
  const currentById = new Map(
    drones.map((drone) => [
      drone.droneId,
      { x: Number(drone.x || 0), y: Number(drone.y || 0), z: Number(drone.z || 0) },
    ]),
  );
  const accepted = new Map();
  const states = [];
  mission.routes.forEach((route) => {
    const current = currentById.get(route.droneId);
    if (!current) return;
    const elapsed = Number(route.elapsedMs || 0);
    const proposedElapsed = elapsed + Math.max(0, Math.min(250, deltaMs));
    const proposed = sampleRoute(route, proposedElapsed);
    let blocked = false;
    currentById.forEach((otherCurrent, otherId) => {
      if (blocked || otherId === route.droneId) return;
      const other = accepted.get(otherId) || otherCurrent;
      const proposedDistance = Math.hypot(
        proposed.x - other.x,
        proposed.y - other.y,
        proposed.z - other.z,
      );
      const currentDistance = Math.hypot(
        current.x - other.x,
        current.y - other.y,
        current.z - other.z,
      );
      if (proposedDistance < safetyDistance && proposedDistance <= currentDistance) blocked = true;
    });
    if (blocked) {
      accepted.set(route.droneId, current);
      states.push({
        droneId: route.droneId,
        ...current,
        phase: 'holding',
        progress: Math.min(0.99, elapsed / route.totalMs),
        complete: false,
      });
      return;
    }
    route.elapsedMs = proposedElapsed;
    accepted.set(route.droneId, proposed);
    states.push({ droneId: route.droneId, ...proposed });
  });
  return states;
}
