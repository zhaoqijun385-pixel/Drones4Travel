import { computed, reactive, ref, watch } from 'vue';
import { useAppSettings } from './useAppSettings.js';
import { useAuth } from './useAuth.js';
import {
  MISSION_PRESETS,
  advanceMission,
  parkingPose,
  planGatherMission,
  planMission,
  planNavigateMission,
  routePolyline,
} from './fleetMissionPlanner.js';
import { advanceManualFlight, applyManualFlightMove } from './fleetManualFlight.js';

// The fleet layer is deliberately opt-in. The existing single-drone aerial
// view keeps its original render path unless the URL contains ?fleet=demo.
const DEMO_INTERVAL_MS = 100;
const ROOM_ID = 'local-flight-room';
const LOCAL_DRONE_ID = 'local-drone';
const PROFILE_STORAGE_KEY = 'drone-navigation:fleet-profiles:v2';
const LIVE_INTERPOLATION_MS = 120;
const LIVE_RENDER_INTERVAL_MS = 50;
const LIVE_HEARTBEAT_MS = 5000;
const LIVE_LEASE_RENEW_MS = 2000;
const LIVE_RECONNECT_MAX_MS = 15000;

const { settings } = useAppSettings();
const { token } = useAuth();
const demoEnabled = ref(false);
const fleetMode = ref('off'); // off | demo | live
const selectedDroneId = ref(LOCAL_DRONE_ID);
const followSelected = ref(false);
const sharedTarget = ref(null);
const activeMission = ref(null);
const drones = reactive({});
const leases = reactive({});
const liveConnection = reactive({
  status: 'idle', // idle | connecting | connected | reconnecting | auth_required | error
  roomId: ROOM_ID,
  clientId: '',
  latencyMs: null,
  lastSnapshotAt: 0,
  lastMessageAt: 0,
  reconnects: 0,
  error: '',
});
let demoTimer = null;
let demoMissionLastTickAt = 0;
let liveSocket = null;
let liveReconnectTimer = null;
let liveReconnectDelay = 1000;
let liveRenderTimer = null;
let liveHeartbeatTimer = null;
let liveLeaseTimer = null;
let liveClosedIntentionally = false;
let lastPingAt = 0;
const liveTargets = new Map();
let fleetAltitudeOrigin = Number(settings.defaultAlt) || 0;

function browserClientId() {
  if (typeof window === 'undefined') return `web-${Math.random().toString(36).slice(2, 10)}`;
  const key = 'drone-navigation:fleet-client-id:v1';
  let value = window.sessionStorage.getItem(key);
  if (!value) {
    value = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(key, value);
  }
  return value;
}

liveConnection.clientId = browserClientId();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createDrone({
  droneId,
  name,
  color,
  x = 0,
  y = 0,
  z = 0.12,
  local = false,
  type = 'demo',
  agentId = '',
  agentStatus = 'not_created',
  takeoffAltitude = Number(settings.takeoffAltitude) || 100,
}) {
  return {
    droneId,
    roomId: ROOM_ID,
    name,
    color,
    ownerId: local ? 'local-user' : `operator-${droneId}`,
    controlOwnerId: local ? 'local-user' : undefined,
    x,
    y,
    z,
    homeX: x,
    homeY: y,
    homeZ: z,
    lat: settings.defaultLat,
    lon: settings.defaultLon,
    alt: fleetAltitudeOrigin + z,
    roll: 0,
    pitch: 0,
    yaw: 0,
    battery: local ? 100 : clamp(96 - Number(droneId.split('-').pop() || 0) * 1.3, 35, 100),
    online: true,
    sequence: 0,
    timestamp: Date.now(),
    local,
    type,
    phase: 'parked',
    missionProgress: 0,
    missionTarget: '',
    route: [],
    autoTargetZ: null,
    autoAction: '',
    // Each aircraft keeps its own target height. This prevents changing the
    // selected aircraft from silently reusing another aircraft's setting.
    takeoffAltitude: clamp(Number(takeoffAltitude) || Number(settings.takeoffAltitude) || 100, 20, 10000),
    agentId,
    agentStatus,
  };
}

function storedProfiles() {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(PROFILE_STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function persistProfiles() {
  if (typeof window === 'undefined') return;
  const value = Object.values(drones)
    .filter((drone) => !drone.local)
    .map((drone) => ({
      droneId: drone.droneId,
      name: drone.name,
      color: drone.color,
      type: drone.type || 'demo',
      homeX: Number(drone.homeX || 0),
      homeY: Number(drone.homeY || 0),
      homeZ: Number(drone.homeZ || 0.12),
      agentId: drone.agentId || '',
      agentStatus: drone.agentStatus || 'not_created',
      takeoffAltitude: Number(drone.takeoffAltitude) || Number(settings.takeoffAltitude) || 100,
    }));
  window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(value));
}

function metresToGeo(x, y) {
  const latitudeScale = 111_320;
  const longitudeScale = latitudeScale * Math.max(0.2, Math.cos((settings.defaultLat * Math.PI) / 180));
  return {
    lat: settings.defaultLat + y / latitudeScale,
    lon: settings.defaultLon + x / longitudeScale,
  };
}

function ensureLocalDrone() {
  if (!drones[LOCAL_DRONE_ID]) {
    const home = parkingPose(0);
    drones[LOCAL_DRONE_ID] = createDrone({
      droneId: LOCAL_DRONE_ID,
      name: 'You',
      color: '#63e6be',
      ...home,
      local: true,
      type: 'local',
    });
  }
  return drones[LOCAL_DRONE_ID];
}

function restoreProfiles() {
  ensureLocalDrone();
  storedProfiles().forEach((profile, profileIndex) => {
    if (!profile?.droneId || drones[profile.droneId]) return;
    const fallback = parkingPose(profileIndex + 1);
    const home = {
      x: Number(profile.homeX ?? fallback.x),
      y: Number(profile.homeY ?? fallback.y),
      z: Number(profile.homeZ ?? fallback.z),
    };
    const restored = createDrone({
      ...profile,
      ...home,
      z: home.z,
      color: profile.color || '#6dc7e8',
      takeoffAltitude: profile.takeoffAltitude,
    });
    Object.assign(restored, metresToGeo(home.x, home.y));
    drones[profile.droneId] = restored;
  });
}

function seedDemoFleet(count = 4) {
  ensureLocalDrone();
  const existingRemote = Object.values(drones).filter((drone) => !drone.local).length;
  for (let index = existingRemote + 1; index <= count; index += 1) {
    const droneId = `demo-${String(index).padStart(2, '0')}`;
    const home = parkingPose(index);
    drones[droneId] = createDrone({
      droneId,
      name: `Scout ${String(index).padStart(2, '0')}`,
      color: index % 3 === 0 ? '#f6c453' : '#53b7ff',
      ...home,
    });
    Object.assign(drones[droneId], metresToGeo(home.x, home.y));
  }
  persistProfiles();
}

function tickDemoFleet() {
  if (!demoEnabled.value) return;
  const now = Date.now();
  const delta = demoMissionLastTickAt ? now - demoMissionLastTickAt : DEMO_INTERVAL_MS;
  demoMissionLastTickAt = now;

  // Manual takeoff/landing uses the same 8 m/s vertical rate as the original
  // single-drone altitude gate. It continues while another drone is selected.
  Object.values(drones).forEach((drone) => {
    if (drone.local) return;
    const next = advanceManualFlight(drone, delta, fleetAltitudeOrigin);
    if (!next) return;
    Object.assign(drone, next);
    drone.battery = Math.max(30, drone.battery - 0.002);
    drone.sequence += 1;
    drone.timestamp = now;
  });

  const mission = activeMission.value;
  if (!mission) return;
  let completeCount = 0;
  advanceMission(mission, Object.values(drones), delta).forEach((next) => {
    const drone = drones[next.droneId];
    if (!drone) return;
    const dx = next.x - drone.x;
    const dy = next.y - drone.y;
    if (Math.hypot(dx, dy) > 0.001) drone.yaw = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    drone.x = next.x;
    drone.y = next.y;
    drone.z = next.z;
    drone.alt = fleetAltitudeOrigin + next.z;
    drone.phase = next.phase;
    drone.missionProgress = next.progress;
    drone.battery = Math.max(30, drone.battery - 0.0012);
    Object.assign(drone, metresToGeo(drone.x, drone.y));
    drone.sequence += 1;
    drone.timestamp = Date.now();
    if (next.complete) completeCount += 1;
  });
  if (mission.routes.length && completeCount === mission.routes.length) {
    mission.routes.forEach((route) => {
      const drone = drones[route.droneId];
      if (drone) drone.route = [];
    });
    activeMission.value = null;
  }
}

function setDemoEnabled(enabled, { seedCount = 0 } = {}) {
  const next = Boolean(enabled);
  if (demoEnabled.value === next) return;
  if (next) disconnectLive();
  demoEnabled.value = next;
  if (next) fleetMode.value = 'demo';
  else if (fleetMode.value === 'demo') fleetMode.value = 'off';
  if (next) {
    restoreProfiles();
    if (seedCount > 0) seedDemoFleet(seedCount);
    demoMissionLastTickAt = Date.now();
    demoTimer = setInterval(tickDemoFleet, DEMO_INTERVAL_MS);
  } else {
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
    demoMissionLastTickAt = 0;
    selectedDroneId.value = LOCAL_DRONE_ID;
    followSelected.value = false;
    sharedTarget.value = null;
    activeMission.value = null;
  }
}

function liveWsBase() {
  if (typeof window === 'undefined') return '';
  if (import.meta.env.DEV) return 'ws://localhost:8000/api/fleet/ws';
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/api/fleet/ws`;
}

function clearRemoteDrones() {
  Object.keys(drones).forEach((id) => delete drones[id]);
  Object.keys(leases).forEach((id) => delete leases[id]);
  liveTargets.clear();
  selectedDroneId.value = LOCAL_DRONE_ID;
  followSelected.value = false;
}

function normalizeLiveState(raw) {
  if (!raw?.droneId) return null;
  const previous = drones[raw.droneId] || {};
  const x = Number(raw.x ?? previous.x ?? 0);
  const y = Number(raw.y ?? previous.y ?? 0);
  const z = Number(raw.z ?? previous.z ?? 0);
  const localGeo = metresToGeo(x, y);
  return {
    ...previous,
    ...raw,
    droneId: String(raw.droneId),
    roomId: String(raw.roomId || liveConnection.roomId),
    name: String(raw.name || previous.name || raw.droneId),
    color: String(raw.color || previous.color || '#53b7ff'),
    lat: Number(raw.lat ?? (raw.x != null || raw.y != null ? localGeo.lat : previous.lat ?? localGeo.lat)),
    lon: Number(raw.lon ?? (raw.x != null || raw.y != null ? localGeo.lon : previous.lon ?? localGeo.lon)),
    alt: Number(raw.alt ?? (raw.z != null ? settings.defaultAlt + z : previous.alt ?? settings.defaultAlt + z)),
    x,
    y,
    z,
    roll: Number(raw.roll ?? previous.roll ?? 0),
    pitch: Number(raw.pitch ?? previous.pitch ?? 0),
    yaw: Number(raw.yaw ?? previous.yaw ?? 0),
    battery: Number(raw.battery ?? previous.battery ?? 0),
    sequence: Number(raw.sequence ?? previous.sequence ?? 0),
    timestamp: Number(raw.timestamp || Date.now()),
    online: raw.online !== false,
    linkState: raw.linkState || (raw.online === false ? 'offline' : 'online'),
    local: Boolean(raw.ownerId && raw.ownerId === liveConnection.clientId),
  };
}

function ingestLiveState(raw, immediate = false) {
  const next = normalizeLiveState(raw);
  if (!next) return false;
  const current = drones[next.droneId];
  if (current && Number(next.sequence) < Number(current.sequence) && !immediate) return false;
  if (
    current
    && Number(next.sequence) === Number(current.sequence)
    && next.linkState === current.linkState
    && next.controlOwnerId === current.controlOwnerId
    && !immediate
  ) return false;
  if (!current || immediate) {
    drones[next.droneId] = next;
    liveTargets.delete(next.droneId);
    return true;
  }
  liveTargets.set(next.droneId, {
    from: { ...current },
    to: next,
    startedAt: performance.now(),
  });
  Object.assign(current, {
    online: next.online,
    linkState: next.linkState,
    controlOwnerId: next.controlOwnerId,
    sequence: next.sequence,
    timestamp: next.timestamp,
  });
  return true;
}

function interpolateAngle(from, to, progress) {
  const delta = ((to - from + 540) % 360) - 180;
  return from + delta * progress;
}

function renderLiveTargets() {
  const now = performance.now();
  const linearFields = ['x', 'y', 'z', 'lat', 'lon', 'alt', 'roll', 'pitch', 'battery'];
  liveTargets.forEach((target, droneId) => {
    const drone = drones[droneId];
    if (!drone) {
      liveTargets.delete(droneId);
      return;
    }
    const progress = Math.min(1, (now - target.startedAt) / LIVE_INTERPOLATION_MS);
    linearFields.forEach((field) => {
      const from = Number(target.from[field]);
      const to = Number(target.to[field]);
      if (Number.isFinite(from) && Number.isFinite(to)) drone[field] = from + (to - from) * progress;
    });
    drone.yaw = interpolateAngle(Number(target.from.yaw || 0), Number(target.to.yaw || 0), progress);
    if (progress >= 1) {
      Object.assign(drone, target.to);
      liveTargets.delete(droneId);
    }
  });
}

function sendLive(frame) {
  if (!liveSocket || liveSocket.readyState !== WebSocket.OPEN) return false;
  liveSocket.send(JSON.stringify(frame));
  return true;
}

function applyLiveSnapshot(frame) {
  const incoming = new Set();
  (Array.isArray(frame.drones) ? frame.drones : []).forEach((state) => {
    incoming.add(state.droneId);
    ingestLiveState(state, true);
  });
  Object.keys(drones).forEach((id) => {
    if (!incoming.has(id)) delete drones[id];
  });
  Object.keys(leases).forEach((id) => delete leases[id]);
  (Array.isArray(frame.leases) ? frame.leases : []).forEach((lease) => {
    leases[lease.droneId] = lease;
  });
  sharedTarget.value = frame.sharedTarget || null;
  liveConnection.lastSnapshotAt = Date.now();
  if (!drones[selectedDroneId.value]) {
    selectedDroneId.value = Object.keys(drones)[0] || LOCAL_DRONE_ID;
  }
}

function handleLiveMessage(event) {
  let frame;
  try { frame = JSON.parse(event.data); } catch { return; }
  liveConnection.lastMessageAt = Date.now();
  if (frame.type === 'room_snapshot') {
    applyLiveSnapshot(frame);
  } else if (frame.type === 'drone_update' || frame.type === 'drone_online' || frame.type === 'drone_offline') {
    ingestLiveState(frame);
  } else if (frame.type === 'control_result' && frame.droneId) {
    if (['released', 'lease_expired', 'client_disconnected', 'not_owner'].includes(frame.reason)) {
      delete leases[frame.droneId];
    } else if (frame.leaseId) {
      leases[frame.droneId] = frame;
    }
  } else if (frame.type === 'shared_target') {
    sharedTarget.value = frame.data || null;
  } else if (frame.type === 'pong' && lastPingAt) {
    liveConnection.latencyMs = Date.now() - lastPingAt;
  } else if (frame.type === 'error' || (frame.type === 'command_result' && !frame.ok)) {
    liveConnection.error = frame.reason || 'fleet_error';
  }
}

function stopLiveTimers() {
  if (liveRenderTimer) clearInterval(liveRenderTimer);
  if (liveHeartbeatTimer) clearInterval(liveHeartbeatTimer);
  if (liveLeaseTimer) clearInterval(liveLeaseTimer);
  liveRenderTimer = null;
  liveHeartbeatTimer = null;
  liveLeaseTimer = null;
}

function startLiveTimers() {
  stopLiveTimers();
  liveRenderTimer = setInterval(renderLiveTargets, LIVE_RENDER_INTERVAL_MS);
  liveHeartbeatTimer = setInterval(() => {
    lastPingAt = Date.now();
    sendLive({ type: 'ping', timestamp: lastPingAt });
  }, LIVE_HEARTBEAT_MS);
  liveLeaseTimer = setInterval(() => {
    Object.values(leases).forEach((lease) => {
      if (lease.ownerClientId === liveConnection.clientId) {
        sendLive({
          type: 'renew_control',
          droneId: lease.droneId,
          leaseId: lease.leaseId,
        });
      }
    });
  }, LIVE_LEASE_RENEW_MS);
}

function scheduleLiveReconnect() {
  if (liveClosedIntentionally || fleetMode.value !== 'live' || liveReconnectTimer) return;
  liveConnection.status = 'reconnecting';
  liveReconnectTimer = setTimeout(() => {
    liveReconnectTimer = null;
    liveConnection.reconnects += 1;
    connectLive(liveConnection.roomId);
  }, liveReconnectDelay);
  liveReconnectDelay = Math.min(LIVE_RECONNECT_MAX_MS, liveReconnectDelay * 2);
}

function connectLive(roomId = ROOM_ID) {
  setDemoEnabled(false);
  fleetMode.value = 'live';
  if (!token.value) {
    liveConnection.status = 'auth_required';
    liveConnection.error = 'login_required';
    return false;
  }
  liveClosedIntentionally = false;
  liveConnection.roomId = String(roomId || ROOM_ID);
  liveConnection.status = liveConnection.reconnects ? 'reconnecting' : 'connecting';
  liveConnection.error = '';
  if (liveSocket) {
    try { liveSocket.close(); } catch { /* noop */ }
    liveSocket = null;
  }
  const query = new URLSearchParams({
    roomId: liveConnection.roomId,
    clientId: liveConnection.clientId,
    token: token.value,
  });
  try {
    liveSocket = new WebSocket(`${liveWsBase()}?${query.toString()}`);
  } catch (error) {
    liveConnection.error = error.message || 'connect_failed';
    liveConnection.status = 'error';
    scheduleLiveReconnect();
    return false;
  }
  liveSocket.onopen = () => {
    liveConnection.status = 'connected';
    liveReconnectDelay = 1000;
    startLiveTimers();
  };
  liveSocket.onmessage = handleLiveMessage;
  liveSocket.onerror = () => {
    liveConnection.error = 'websocket_error';
  };
  liveSocket.onclose = (event) => {
    liveSocket = null;
    stopLiveTimers();
    if (event.code === 4401) {
      liveConnection.status = 'auth_required';
      liveConnection.error = 'login_required';
      return;
    }
    if (!liveClosedIntentionally) scheduleLiveReconnect();
  };
  return true;
}

function disconnectLive({ clear = true } = {}) {
  liveClosedIntentionally = true;
  if (liveReconnectTimer) clearTimeout(liveReconnectTimer);
  liveReconnectTimer = null;
  stopLiveTimers();
  if (liveSocket) {
    const socket = liveSocket;
    liveSocket = null;
    try { socket.close(); } catch { /* noop */ }
  }
  if (fleetMode.value === 'live') fleetMode.value = 'off';
  liveConnection.status = 'idle';
  liveConnection.latencyMs = null;
  liveConnection.error = '';
  if (clear) clearRemoteDrones();
}

function setFleetMode(mode, options = {}) {
  if (mode === 'demo') {
    setDemoEnabled(true);
    return true;
  }
  if (mode === 'live') return connectLive(options.roomId || liveConnection.roomId);
  setDemoEnabled(false);
  disconnectLive();
  return true;
}

function claimControl(droneId) {
  return sendLive({ type: 'claim_control', droneId });
}

function releaseControl(droneId) {
  const lease = leases[droneId];
  if (!lease) return false;
  return sendLive({ type: 'release_control', droneId, leaseId: lease.leaseId });
}

function sendLiveCommand(droneId, command) {
  const lease = leases[droneId];
  if (!lease || lease.ownerClientId !== liveConnection.clientId) return false;
  return sendLive({
    type: 'drone_command',
    droneId,
    leaseId: lease.leaseId,
    command,
  });
}

function setAltitudeOrigin(originAlt) {
  const next = Number(originAlt);
  if (!Number.isFinite(next) || Math.abs(next - fleetAltitudeOrigin) < 0.05) return;
  fleetAltitudeOrigin = next;
  Object.values(drones).forEach((item) => {
    if (item.local) return;
    item.alt = fleetAltitudeOrigin + Number(item.z || 0);
    item.route = (item.route || []).map((point) => ({
      ...point,
      alt: fleetAltitudeOrigin + Number(point.z || 0),
    }));
    item.sequence += 1;
  });
}

function syncLocalDrone(drone, originAlt = fleetAltitudeOrigin) {
  if (!drone) return;
  const local = ensureLocalDrone();
  const lat = Number(drone.lat) || settings.defaultLat;
  const lon = Number(drone.lon) || settings.defaultLon;
  const alt = Number(drone.alt) || settings.defaultAlt;
  const yaw = Number(drone.heading) || 0;
  const changed = Math.abs(local.lat - lat) > 1e-8
    || Math.abs(local.lon - lon) > 1e-8
    || Math.abs(local.alt - alt) > 0.001
    || Math.abs(local.yaw - yaw) > 0.01;
  if (!changed) return;
  local.lat = lat;
  local.lon = lon;
  local.alt = alt;
  local.z = Math.max(0.12, local.alt - Number(originAlt || 0));
  local.yaw = yaw;
  local.sequence += 1;
  local.timestamp = Date.now();
}

function selectDrone(droneId) {
  if (drones[droneId]) selectedDroneId.value = droneId;
}

function nextDemoId() {
  let index = 1;
  while (drones[`demo-${String(index).padStart(2, '0')}`]) index += 1;
  return `demo-${String(index).padStart(2, '0')}`;
}

function addDrone({ name = '', type = 'demo' } = {}) {
  if (fleetMode.value !== 'demo') setDemoEnabled(true);
  const droneId = nextDemoId();
  const remoteCount = Object.values(drones).filter((drone) => !drone.local).length;
  const home = parkingPose(remoteCount + 1);
  const drone = createDrone({
    droneId,
    name: String(name || `Scout ${String(remoteCount + 1).padStart(2, '0')}`).slice(0, 40),
    color: remoteCount % 3 === 2 ? '#f2b84b' : '#6dc7e8',
    type: type === 'live' ? 'live' : 'demo',
    ...home,
  });
  Object.assign(drone, metresToGeo(home.x, home.y));
  drones[droneId] = drone;
  selectedDroneId.value = droneId;
  persistProfiles();
  return drone;
}

function removeDrone(droneId) {
  const drone = drones[droneId];
  if (!drone || drone.local) return false;
  delete drones[droneId];
  if (selectedDroneId.value === droneId) selectedDroneId.value = LOCAL_DRONE_ID;
  if (activeMission.value) {
    activeMission.value = {
      ...activeMission.value,
      routes: activeMission.value.routes.filter((route) => route.droneId !== droneId),
    };
  }
  persistProfiles();
  return true;
}

function updateDroneAgent(droneId, patch = {}) {
  const drone = drones[droneId];
  if (!drone || drone.local) return false;
  if (patch.agentId !== undefined) drone.agentId = String(patch.agentId || '');
  if (patch.agentStatus !== undefined) drone.agentStatus = String(patch.agentStatus || 'not_created');
  persistProfiles();
  return true;
}

function startDemoMission(presetId = 'inspection') {
  if (!demoEnabled.value) setDemoEnabled(true);
  const mission = planMission(Object.values(drones), presetId);
  if (!mission.routes.length) return false;
  mission.routes.forEach((route) => {
    const drone = drones[route.droneId];
    if (!drone) return;
    drone.autoTargetZ = null;
    drone.autoAction = '';
    drone.route = routePolyline(route).map((point) => ({
      ...point,
      ...metresToGeo(point.x, point.y),
      alt: fleetAltitudeOrigin + point.z,
    }));
    drone.phase = 'queued';
    drone.missionProgress = 0;
    drone.missionTarget = route.targetLabel;
    drone.sequence += 1;
  });
  activeMission.value = mission;
  mission.routes.forEach((route) => { route.elapsedMs = 0; });
  demoMissionLastTickAt = Date.now();
  return true;
}

function activatePlannedMission(mission) {
  if (!mission?.routes?.length) return false;
  Object.values(drones).forEach((drone) => {
    if (drone.local) return;
    drone.autoTargetZ = null;
    drone.autoAction = '';
    drone.route = [];
    drone.missionProgress = 0;
    drone.missionTarget = '';
    if (drone.phase !== 'parked') drone.phase = 'holding';
  });
  mission.routes.forEach((route) => {
    const drone = drones[route.droneId];
    if (!drone) return;
    drone.route = routePolyline(route).map((point) => ({
      ...point,
      ...metresToGeo(point.x, point.y),
      alt: fleetAltitudeOrigin + point.z,
    }));
    drone.phase = 'queued';
    drone.missionProgress = 0;
    drone.missionTarget = route.targetLabel;
    drone.sequence += 1;
    route.elapsedMs = 0;
  });
  activeMission.value = mission;
  demoMissionLastTickAt = Date.now();
  return true;
}

function navigateDroneTo(droneId, targetDroneId) {
  if (!demoEnabled.value) setDemoEnabled(true);
  return activatePlannedMission(planNavigateMission(Object.values(drones), droneId, targetDroneId));
}

function gatherAt(anchorDroneId = LOCAL_DRONE_ID) {
  if (!demoEnabled.value) setDemoEnabled(true);
  return activatePlannedMission(planGatherMission(Object.values(drones), anchorDroneId));
}

function stopDemoMission() {
  activeMission.value = null;
  Object.values(drones).forEach((drone) => {
    if (drone.local) return;
    drone.phase = drone.z <= 0.2 ? 'parked' : 'holding';
    drone.route = [];
    drone.missionProgress = 0;
    drone.sequence += 1;
  });
}

function setSharedTarget(target) {
  if (!target) {
    sharedTarget.value = null;
    return;
  }
  sharedTarget.value = {
    lat: Number(target.lat),
    lon: Number(target.lon),
    alt: Number(target.alt || 0),
    label: String(target.label || 'Shared target').slice(0, 80),
    timestamp: Date.now(),
  };
  if (fleetMode.value === 'live') {
    sendLive({ type: 'shared_target', data: sharedTarget.value });
  }
}

// Demo-only command executor. Real drone commands deliberately do not enter
// this function: they need the future room/lease service and the existing
// server-side command whitelist before a physical radio can receive them.
function applyDemoCommand(droneId, action) {
  if (!demoEnabled.value || droneId === LOCAL_DRONE_ID) return false;
  const drone = drones[droneId];
  if (!drone || !drone.online) return false;
  if (action === 'takeoff') {
    const targetZ = Math.max(0.12, Number(drone.takeoffAltitude) || Number(settings.takeoffAltitude) || 100);
    if (drone.z >= targetZ - 0.2) return false;
    drone.autoTargetZ = targetZ;
    drone.autoAction = 'takeoff';
    drone.phase = 'takeoff';
  } else if (action === 'hover' || action === 'stop') {
    drone.autoTargetZ = null;
    drone.autoAction = '';
    drone.phase = drone.z <= 0.2 ? 'parked' : 'holding';
  } else if (action === 'forward') {
    Object.assign(drone, applyManualFlightMove(drone, { y: 2 }, fleetAltitudeOrigin));
  } else if (action === 'left') {
    Object.assign(drone, applyManualFlightMove(drone, { x: -2 }, fleetAltitudeOrigin));
  } else if (action === 'up') {
    Object.assign(drone, applyManualFlightMove(drone, { z: 1 }, fleetAltitudeOrigin));
  } else if (action === 'land') {
    if (drone.z <= 0.2) return false;
    drone.autoTargetZ = 0.12;
    drone.autoAction = 'land';
    drone.online = true;
    drone.phase = 'landing';
  } else {
    return false;
  }
  Object.assign(drone, metresToGeo(drone.x, drone.y));
  drone.alt = fleetAltitudeOrigin + drone.z;
  drone.sequence += 1;
  drone.timestamp = Date.now();
  return true;
}

// Route the shared flight disk/keyboard to the selected remote demo aircraft.
// The local altitude gate is intentionally not involved in this path.
function applyDemoMove(droneId, enuMove, { yawDelta = 0 } = {}) {
  if (!demoEnabled.value || droneId === LOCAL_DRONE_ID) return false;
  const drone = drones[droneId];
  if (!drone || !drone.online) return false;
  const next = applyManualFlightMove(drone, enuMove, fleetAltitudeOrigin, yawDelta);
  if (!next) return false;
  Object.assign(drone, next, metresToGeo(next.x, next.y));
  drone.battery = Math.max(30, drone.battery - 0.001);
  drone.sequence += 1;
  drone.timestamp = Date.now();
  return true;
}

function setDroneTakeoffAltitude(droneId, value) {
  const drone = drones[droneId];
  if (!drone) return false;
  const next = clamp(Number(value) || Number(settings.takeoffAltitude) || 100, 20, 10000);
  drone.takeoffAltitude = next;
  persistProfiles();
  return true;
}

function getRenderStates() {
  return Object.values(drones).map((drone) => ({ ...drone }));
}

function buildOpenClawContext() {
  const list = getRenderStates().map((drone) => ({
    droneId: drone.droneId,
    name: drone.name,
    local: drone.local,
    online: drone.online,
    lat: Number(drone.lat.toFixed(6)),
    lon: Number(drone.lon.toFixed(6)),
    alt: Number(drone.alt.toFixed(2)),
    battery: Number(drone.battery.toFixed(1)),
    controlOwnerId: drone.controlOwnerId || null,
    phase: drone.phase || 'unknown',
    missionProgress: Number(drone.missionProgress || 0),
    missionTarget: drone.missionTarget || null,
    agentId: drone.agentId || null,
  }));
  return {
    roomId: ROOM_ID,
    localDroneId: LOCAL_DRONE_ID,
    selectedDroneId: selectedDroneId.value,
    sharedTarget: sharedTarget.value,
    activeMissionId: activeMission.value?.id || null,
    drones: list,
  };
}

watch(token, (value) => {
  if (!value && fleetMode.value === 'live') {
    disconnectLive();
  }
});

export function useDroneFleet() {
  ensureLocalDrone();
  restoreProfiles();
  if (demoEnabled.value && !demoTimer) demoTimer = setInterval(tickDemoFleet, DEMO_INTERVAL_MS);
  return {
    demoEnabled: computed(() => demoEnabled.value),
    mode: computed(() => fleetMode.value),
    liveEnabled: computed(() => fleetMode.value === 'live'),
    liveConnection,
    leases,
    drones: computed(() => Object.values(drones)),
    selectedDroneId,
    selectedDrone: computed(() => drones[selectedDroneId.value] || null),
    followSelected,
    sharedTarget,
    activeMission,
    missionPresets: MISSION_PRESETS,
    localDroneId: LOCAL_DRONE_ID,
    setDemoEnabled,
    setMode: setFleetMode,
    connectLive,
    disconnectLive,
    claimControl,
    releaseControl,
    sendLiveCommand,
    setAltitudeOrigin,
    syncLocalDrone,
    selectDrone,
    addDrone,
    removeDrone,
    updateDroneAgent,
    setDroneTakeoffAltitude,
    startDemoMission,
    navigateDroneTo,
    gatherAt,
    stopDemoMission,
    setSharedTarget,
    applyDemoCommand,
    applyDemoMove,
    getRenderStates,
    buildOpenClawContext,
  };
}

export function isFleetDemoRequested() {
  if (typeof window === 'undefined') return false;
  // The flight deck is now the default experience. `?fleet=off` remains as a
  // lightweight escape hatch for single-drone/GPU troubleshooting.
  return new URLSearchParams(window.location.search).get('fleet') !== 'off';
}
