import { computed, reactive, ref } from 'vue';
import { useAppSettings } from './useAppSettings.js';

// The fleet layer is deliberately opt-in. The existing single-drone aerial
// view keeps its original render path unless the URL contains ?fleet=demo.
const DEMO_DRONE_COUNT = 20;
const DEMO_INTERVAL_MS = 100;
const ROOM_ID = 'local-flight-room';
const LOCAL_DRONE_ID = 'local-drone';

const { settings } = useAppSettings();
const demoEnabled = ref(false);
const selectedDroneId = ref(LOCAL_DRONE_ID);
const followSelected = ref(false);
const sharedTarget = ref(null);
const drones = reactive({});
let demoTimer = null;
let demoTick = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createDrone({ droneId, name, color, x = 0, y = 0, z = 4, local = false }) {
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
    lat: settings.defaultLat,
    lon: settings.defaultLon,
    alt: settings.defaultAlt,
    roll: 0,
    pitch: 0,
    yaw: 0,
    battery: local ? 100 : clamp(96 - Number(droneId.split('-').pop() || 0) * 1.3, 35, 100),
    online: true,
    sequence: 0,
    timestamp: Date.now(),
    local,
  };
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
    drones[LOCAL_DRONE_ID] = createDrone({
      droneId: LOCAL_DRONE_ID,
      name: 'You',
      color: '#63e6be',
      local: true,
    });
  }
  return drones[LOCAL_DRONE_ID];
}

function seedDemoFleet() {
  ensureLocalDrone();
  for (let index = 1; index <= DEMO_DRONE_COUNT; index += 1) {
    const angle = (index / DEMO_DRONE_COUNT) * Math.PI * 2;
    const radius = 18 + (index % 5) * 8;
    const droneId = `demo-${String(index).padStart(2, '0')}`;
    drones[droneId] = createDrone({
      droneId,
      name: `Scout ${String(index).padStart(2, '0')}`,
      color: index % 3 === 0 ? '#f6c453' : '#53b7ff',
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: 3.5 + (index % 4) * 1.3,
    });
  }
}

function tickDemoFleet() {
  if (!demoEnabled.value) return;
  demoTick += 1;
  Object.values(drones).forEach((drone, index) => {
    if (drone.local) return;
    const phase = demoTick * 0.035 + index * 0.61;
    const orbit = 16 + (index % 5) * 8;
    drone.x = Math.cos(phase) * orbit + Math.sin(phase * 0.7) * 4;
    drone.y = Math.sin(phase) * orbit + Math.cos(phase * 0.6) * 4;
    drone.z = 3.5 + (index % 4) * 1.3 + Math.sin(phase * 1.3) * 0.35;
    drone.yaw = ((phase * 57.3 + 90) % 360 + 360) % 360;
    drone.battery = Math.max(30, drone.battery - 0.0007);
    Object.assign(drone, metresToGeo(drone.x, drone.y));
    drone.sequence += 1;
    drone.timestamp = Date.now();
  });
}

function setDemoEnabled(enabled) {
  const next = Boolean(enabled);
  if (demoEnabled.value === next) return;
  demoEnabled.value = next;
  if (next) {
    seedDemoFleet();
    demoTimer = setInterval(tickDemoFleet, DEMO_INTERVAL_MS);
  } else {
    if (demoTimer) clearInterval(demoTimer);
    demoTimer = null;
    Object.keys(drones).forEach((id) => {
      if (id !== LOCAL_DRONE_ID) delete drones[id];
    });
    selectedDroneId.value = LOCAL_DRONE_ID;
    followSelected.value = false;
    sharedTarget.value = null;
  }
}

function syncLocalDrone(drone) {
  if (!demoEnabled.value || !drone) return;
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
  local.z = local.alt;
  local.yaw = yaw;
  local.sequence += 1;
  local.timestamp = Date.now();
}

function selectDrone(droneId) {
  if (drones[droneId]) selectedDroneId.value = droneId;
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
}

// Demo-only command executor. Real drone commands deliberately do not enter
// this function: they need the future room/lease service and the existing
// server-side command whitelist before a physical radio can receive them.
function applyDemoCommand(droneId, action) {
  if (!demoEnabled.value || droneId === LOCAL_DRONE_ID) return false;
  const drone = drones[droneId];
  if (!drone || !drone.online) return false;
  if (action === 'hover') {
    // Holding position is represented by leaving the simulated trajectory
    // untouched until its next tick.
  } else if (action === 'forward') {
    drone.y += 2;
  } else if (action === 'left') {
    drone.x -= 2;
  } else if (action === 'up') {
    drone.z = Math.min(12, drone.z + 1);
  } else if (action === 'land') {
    drone.z = 0.5;
    drone.online = true;
  } else {
    return false;
  }
  Object.assign(drone, metresToGeo(drone.x, drone.y));
  drone.sequence += 1;
  drone.timestamp = Date.now();
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
  }));
  return {
    roomId: ROOM_ID,
    localDroneId: LOCAL_DRONE_ID,
    selectedDroneId: selectedDroneId.value,
    sharedTarget: sharedTarget.value,
    drones: list,
  };
}

export function useDroneFleet() {
  if (demoEnabled.value && !demoTimer) seedDemoFleet();
  return {
    demoEnabled: computed(() => demoEnabled.value),
    drones: computed(() => Object.values(drones)),
    selectedDroneId,
    selectedDrone: computed(() => drones[selectedDroneId.value] || null),
    followSelected,
    sharedTarget,
    localDroneId: LOCAL_DRONE_ID,
    setDemoEnabled,
    syncLocalDrone,
    selectDrone,
    setSharedTarget,
    applyDemoCommand,
    getRenderStates,
    buildOpenClawContext,
  };
}

export function isFleetDemoRequested() {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('fleet') === 'demo';
}
