<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, h } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ViewComposer from '@shared/_ViewComposer.vue';
import CollisionWarning from '@shared/CollisionWarning.vue';
import StreetViewPane from '@shared/StreetViewPane.vue';
import { useDrone } from '@shared-composables/useDrone.js';
import { useAltitudeGate, PHASES, DESCEND_THRESHOLD, ASCEND_THRESHOLD } from '@shared-composables/useAltitudeGate.js';
import { useFlightCommands } from '@shared-composables/useFlightCommands.js';
import { useCameraCommands } from '@shared-composables/useCameraCommands.js';
import { useFlightPhysics } from '@shared-composables/useFlightPhysics.js';
import { useCameraPhysics } from '@shared-composables/useCameraPhysics.js';
import { useDockRegistry } from '@shared-composables/useDockRegistry.js';
import { usePageRegistry } from '@shared-composables/usePageRegistry.js';
import { useTilesetSource } from '@shared-composables/useTilesetSource.js';
import { useScreenCapture } from '@shared-composables/useScreenCapture.js';
import { useAppSettings } from '@shared-composables/useAppSettings.js';
import { useAuth } from '@shared-composables/useAuth.js';
import { useConnectionStatus, checkGoogleConnection, checkCesiumConnection } from '@shared-composables/useConnectionStatus.js';
import DockMenuButton from '@shared/DockMenuButton.vue';
import ConnectionError from '@shared/ConnectionError.vue';
import OpenClawFlightPanel from '@shared/OpenClawFlightPanel.vue';
import DroneSituationPanel from '@shared/DroneSituationPanel.vue';
import { useDroneFleet, isFleetDemoRequested } from '@shared-composables/useDroneFleet.js';
import { useOpenClaw } from '@shared-composables/useOpenClaw.js';

const { t } = useI18n();

const router = useRouter();

const { drone, gimbal } = useDrone();

// Multi-drone workbench. It is intentionally opt-in so the original single
// drone experience keeps the same scene graph and animation cost by default.
const fleet = useDroneFleet();
const fleetDemoRequested = isFleetDemoRequested();
fleet.setDemoEnabled(fleetDemoRequested);
const fleetDemoEnabled = fleet.demoEnabled;
const fleetEnabled = computed(() => fleet.mode.value !== 'off');
const fleetLiveEnabled = fleet.liveEnabled;
const fleetDroneRows = computed(() => fleet.drones.value.map((item) => {
  const latScale = 111_320;
  const lonScale = latScale * Math.max(0.2, Math.cos((drone.lat * Math.PI) / 180));
  const dx = (item.lon - drone.lon) * lonScale;
  const dy = (item.lat - drone.lat) * latScale;
  const dz = (item.alt || 0) - (drone.alt || 0);
  return { ...item, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) };
}));
const localSituationDrone = computed(() => ({
  droneId: fleet.localDroneId,
  name: t('aerialview.situation_local_drone'),
  color: '#63e6be',
  lat: drone.lat,
  lon: drone.lon,
  alt: drone.alt,
  yaw: drone.heading,
  battery: 100,
  online: true,
  local: true,
}));
const situationDrones = computed(() => (fleetEnabled.value ? fleetDroneRows.value : [localSituationDrone.value]));
const situationSelectedDroneId = computed(() => (fleetEnabled.value ? fleet.selectedDroneId.value : fleet.localDroneId));
const situationSelectedDrone = computed(() =>
  situationDrones.value.find((item) => item.droneId === situationSelectedDroneId.value) || situationDrones.value[0] || null,
);
const fleetPerformance = reactive({ fps: 0, objects: 0, visible: 0 });
const openClawSyncState = ref('');
const openClawPanelOpen = ref(false);
const situationPanelOpen = ref(false);
const situationMode = ref('map');
const pendingDroneCommand = ref(null);
const openClawCommandNotice = ref('');
const {
  status: openClawStatus,
  isConnected: openClawConnected,
  messages: openClawMessages,
  sendMessage: sendOpenClawMessage,
  sendFleetContext,
  connect: connectOpenClaw,
  close: closeOpenClaw,
} = useOpenClaw({
  // OpenClaw is user-triggered from the floating panel. A missing local
  // gateway must not make fleet mode look like it is permanently loading.
  autoConnect: false,
  autoReconnect: false,
  clientId: 'drone-navigation-fleet-deck',
});

async function syncFleetToOpenClaw() {
  if (!fleetEnabled.value) return;
  if (!openClawConnected.value) {
    openClawSyncState.value = 'unavailable';
    return;
  }
  openClawSyncState.value = 'syncing';
  try {
    await sendFleetContext(fleet.buildOpenClawContext());
    openClawSyncState.value = 'sent';
    setTimeout(() => {
      if (openClawSyncState.value === 'sent') openClawSyncState.value = '';
    }, 3000);
  } catch (error) {
    console.warn('[Fleet] OpenClaw context sync failed:', error);
    openClawSyncState.value = 'unavailable';
  }
}

function selectFleetDrone(droneId) {
  fleet.selectDrone(droneId);
}

function selectSituationDrone(droneId) {
  if (fleetEnabled.value) selectFleetDrone(droneId);
}

function syncSituationPanelItem() {
  const item = leftItems.find((entry) => entry.id === 'situation-toggle');
  if (!item) return;
  item.active = situationPanelOpen.value;
  item.titleKey = situationPanelOpen.value
    ? 'aerialview.situation_close'
    : 'aerialview.situation_open';
}

function toggleSituationPanel() {
  situationPanelOpen.value = !situationPanelOpen.value;
  syncSituationPanelItem();
}

function closeSituationPanel() {
  situationPanelOpen.value = false;
  syncSituationPanelItem();
}

function setSituationMode(mode) {
  if (mode === 'map' || mode === 'video') situationMode.value = mode;
}

function toggleFleetFollow() {
  fleet.followSelected.value = !fleet.followSelected.value;
}

function syncFleetToggleItem() {
  const item = leftItems.find((entry) => entry.id === 'fleet-toggle');
  if (!item) return;
  item.active = fleetEnabled.value;
  item.titleKey = fleetEnabled.value
    ? 'aerialview.fleet_disable'
    : 'aerialview.fleet_enable';
}

function toggleFleetMode() {
  const enabled = !fleetEnabled.value;
  fleet.setMode(enabled ? 'demo' : 'off');
  if (!enabled) {
    closeOpenClaw();
    fleet.followSelected.value = false;
    if (typeof window.clearDroneFleet === 'function') window.clearDroneFleet();
  }
  syncFleetToggleItem();
}

function activateDemoFleet() {
  fleet.setMode('demo');
  syncFleetToggleItem();
}

function activateLiveFleet() {
  fleet.setMode('live', { roomId: fleet.liveConnection.roomId || 'local-flight-room' });
  syncFleetToggleItem();
}

const selectedFleetLease = computed(() => fleet.leases[fleet.selectedDroneId.value] || null);
const ownsSelectedFleetLease = computed(() => (
  selectedFleetLease.value?.ownerClientId === fleet.liveConnection.clientId
));

function toggleSelectedControlLease() {
  const droneId = fleet.selectedDroneId.value;
  if (!droneId) return;
  if (ownsSelectedFleetLease.value) fleet.releaseControl(droneId);
  else fleet.claimControl(droneId);
}

const commandLabelKeys = {
  hover: 'aerialview.command_hover',
  forward: 'aerialview.command_forward',
  left: 'aerialview.command_left',
  up: 'aerialview.command_up',
  land: 'aerialview.command_land',
};

function toggleOpenClawPanel() {
  openClawPanelOpen.value = !openClawPanelOpen.value;
  if (openClawPanelOpen.value && !openClawConnected.value) connectOpenClaw();
}

function prepareDroneCommand(action) {
  const selected = fleet.selectedDrone.value;
  if (!fleetEnabled.value || !selected) {
    openClawCommandNotice.value = t('aerialview.openclaw_enable_fleet_first');
    return;
  }
  if (selected.local) {
    openClawCommandNotice.value = t('aerialview.openclaw_remote_only');
    return;
  }
  if (fleetLiveEnabled.value && !ownsSelectedFleetLease.value) {
    fleet.claimControl(selected.droneId);
    openClawCommandNotice.value = t('aerialview.fleet_control_requesting');
    return;
  }
  pendingDroneCommand.value = {
    droneId: selected.droneId,
    droneName: selected.name,
    action,
    label: t(commandLabelKeys[action] || 'aerialview.command_hover'),
  };
  openClawCommandNotice.value = '';
}

function confirmDroneCommand() {
  const command = pendingDroneCommand.value;
  if (!command) return;
  const liveCommands = {
    hover: { action: 'move', vx: 0, vy: 0, vz: 0, yawrate: 0 },
    forward: { action: 'forward', distance: 0.2 },
    left: { action: 'left', distance: 0.2 },
    up: { action: 'up', distance: 0.2 },
    land: { action: 'land' },
  };
  const applied = fleetLiveEnabled.value
    ? fleet.sendLiveCommand(command.droneId, liveCommands[command.action])
    : fleet.applyDemoCommand(command.droneId, command.action);
  pendingDroneCommand.value = null;
  openClawCommandNotice.value = applied
    ? t('aerialview.openclaw_demo_command_sent', { drone: command.droneName, command: command.label })
    : t('aerialview.openclaw_command_blocked');
}

function cancelDroneCommand() {
  pendingDroneCommand.value = null;
}

function detectDroneCommand(text) {
  const normalized = String(text || '').toLowerCase();
  if (/(不要|别|禁止|don't|do not|not)\s*(降落|land)/i.test(normalized)) return null;
  if (/(悬停|hover|停在原地)/i.test(normalized)) return 'hover';
  if (/(前进|向前|forward)/i.test(normalized)) return 'forward';
  if (/(左移|向左|left)/i.test(normalized)) return 'left';
  if (/(上升|升高|up|ascend)/i.test(normalized)) return 'up';
  if (/(降落|着陆|land)/i.test(normalized)) return 'land';
  return null;
}

function handleOpenClawMessage(text) {
  const action = detectDroneCommand(text);
  if (action) prepareDroneCommand(action);
  sendOpenClawMessage(text);
}

// 3D data source of the shared Cesium viewer. The 3D Aerial / 3D Mesh
// subpages differ ONLY in this source (Google tiles vs OSM Buildings); every
// control (disks, sidebars, physics) is identical between them.
const { activeSource, isSwitching, setSource, getActiveTileset } = useTilesetSource();
const altitudeGate = useAltitudeGate(drone);

const {
  flight,
  flightCmd,
  activeFlightMode,
  showFlight,
  toggleFlight,
  onFlightMove,
  onFlightStop,
  onFlightModeChange,
  startKeyboard: startFlightKeyboard,
  stopKeyboard: stopFlightKeyboard,
} = useFlightCommands();

const {
  camera,
  cameraCmd,
  activeCameraMode,
  showCamera,
  toggleCamera,
  onCameraMove,
  onCameraStop,
  onCameraModeChange,
  startKeyboard: startCameraKeyboard,
  stopKeyboard: stopCameraKeyboard,
} = useCameraCommands();

const { computeDesiredEnuMove, applyEnuMove, updateTelemetry: updateFlightTelemetry } = useFlightPhysics();
const { step: stepCameraPhysics } = useCameraPhysics();
const { leftItems, rightItems, registerLeft, registerRight, clear } = useDockRegistry();
const { pages, registerPage, unregisterPage } = usePageRegistry();
const { recorderState, replayProgress, replayPov, captureScreenshot, sampleFrame, toggleRecorder, resetRecorder } = useScreenCapture();
const { isAuthenticated } = useAuth();
const { settings } = useAppSettings();

// Login gate for Screenshot / Screen Recording (the 3D Aerial and 3D Mesh
// subpages share this right dock): anonymous users get a green top-center
// reminder instead of the capture action.
const captureAuthNotice = ref(''); // '' | 'screenshot' | 'recording'
let captureAuthTimer = null;
function flashCaptureAuth(action) {
  captureAuthNotice.value = action;
  clearTimeout(captureAuthTimer);
  captureAuthTimer = setTimeout(() => { captureAuthNotice.value = ''; }, 6000);
}
function guardedScreenshot() {
  if (isAuthenticated.value) return captureScreenshot();
  flashCaptureAuth('screenshot');
}
function guardedToggleRecorder() {
  // Never trap an ACTIVE recording: toggling off is always allowed.
  if (isAuthenticated.value || recorderState.value !== 'idle') return toggleRecorder();
  flashCaptureAuth('recording');
}
const isRecorderActive = computed(() => recorderState.value !== 'idle');
let savedDiskVisibility = null;

// Active subpage of the 3D Exploration page: 'aerial' (default) or 'mesh'.
const activeSubpage = ref('aerial');

// Progress bar shown at the top center while a subpage switch streams and
// renders the new 3D assets (Google tiles <-> OSM Buildings).
const assetLoading = ref(false);
const assetLoadProgress = ref(0); // 0..1
let loadStartTs = 0;
let loadToken = 0; // guards against overlapping switches: latest one wins

// ── Splash-clip cover during subpage asset switches ──
// While the 3D data source is being swapped (progress bar visible), a muted,
// looping splash clip covers the scene so its half-loaded state is never
// visible. Reuses the auto-generated /splash/playlist.json manifest with a
// shuffled, no-back-to-back-repeat queue, mirroring the splash screen.
const switchVideoUrl = ref('');
let allSwitchClips = [];
let switchQueue = [];
let lastSwitchClip = '';
let warmVideo = null; // off-DOM element used to pre-buffer the next clip

function shuffleArray(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function refillSwitchQueue(avoidClip) {
  switchQueue = shuffleArray(allSwitchClips);
  if (switchQueue.length > 1 && switchQueue[0] === avoidClip) {
    const i = switchQueue.findIndex((c) => c !== avoidClip);
    [switchQueue[0], switchQueue[i]] = [switchQueue[i], switchQueue[0]];
  }
}

function peekSwitchClip() {
  if (!allSwitchClips.length) return '';
  if (!switchQueue.length) refillSwitchQueue(lastSwitchClip);
  return switchQueue[0];
}

function nextSwitchClip() {
  const clip = peekSwitchClip();
  if (!clip) return '';
  switchQueue.shift();
  lastSwitchClip = clip;
  return clip;
}

/** Extract the bare file name from a clip URL, for logging (like splash.js). */
function clipName(url) {
  return String(url).split('/').pop();
}

// Fetch the splash clip manifest, then warm the first queued clip. The splash
// screen's opening clip (firstClip, video_00.mp4) is EXCLUDED: the subpage
// switch cover should never replay the exact video the user already watched
// at startup. Falls back to firstClip only if it is the sole clip available.
async function loadSwitchClips() {
  try {
    const res = await fetch('/splash/playlist.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allSwitchClips = [...(data.otherClips || [])].filter(Boolean);
    if (!allSwitchClips.length && data.firstClip) allSwitchClips = [data.firstClip];
  } catch (e) {
    console.warn('[switch-cover] splash playlist fetch failed; switch cover disabled:', e.message);
    allSwitchClips = [];
  }
  warmSwitchClip();
}

// Buffer the next queued clip in the background so a later switch starts
// instantly, without the download competing with an in-flight tile stream.
function warmSwitchClip() {
  const clip = peekSwitchClip();
  if (!clip) return;
  if (!warmVideo) {
    warmVideo = document.createElement('video');
    warmVideo.muted = true;
    warmVideo.preload = 'auto';
  }
  if (warmVideo.src.indexOf(clip) !== -1) return; // already warming this clip
  warmVideo.src = clip;
  warmVideo.load();
  // Permanent log, mirroring splash.js: report when this clip has buffered
  // enough to be shown without stalling. The src guard ignores stale events
  // from a warm-up that has been superseded.
  warmVideo.addEventListener('canplay', function onCanPlay() {
    warmVideo.removeEventListener('canplay', onCanPlay);
    if (warmVideo.src.indexOf(clip) !== -1) {
      console.log('[switch-cover] Cached & ready to display: ' + clipName(clip));
    }
  });
}

// Permanent log, mirroring splash.js: report the clip that is starting to be
// displayed. Fires per cover mount (the keyed video element is remounted per
// clip and unmounted when the cover hides).
function onSwitchVideoPlaying() {
  if (switchVideoUrl.value) {
    console.log('[switch-cover] Now playing: ' + clipName(switchVideoUrl.value));
  }
}

const isCollisionFrozen = ref(false);
const collisionSurfaceNormal = ref(null);
const MIN_SAFETY_BUFFER = 2.0; // meters
const LOOK_AHEAD_TIME = 2.0; // seconds

const { googleReady, cesiumReady, googleError, cesiumError } = useConnectionStatus();
const connectionMessage = computed(() => {
  if (!cesiumReady.value && !googleReady.value) {
    return cesiumError.value || googleError.value || 'Cannot connect to Cesium and Google.';
  }
  if (!cesiumReady.value) return cesiumError.value || 'Cannot connect to Cesium.';
  if (!googleReady.value) return googleError.value || 'Cannot connect to Google.';
  return '';
});
const showConnectionError = computed(() => !cesiumReady.value || !googleReady.value);
let connectionCheckInterval = null;

const cesiumContainer = ref(null);
const streetViewReady = ref(false);
const lockedMessage = ref('');
let lockedMessageTimer = null;

const isTakeoffLanding = computed(() => altitudeGate.isTransitioning.value);
const isPausedByCollision = computed(() => altitudeGate.isPausedByCollision.value);
const isAutoActive = computed(() => isTakeoffLanding.value && !isPausedByCollision.value);
const collisionPausedMessage = computed(() => {
  if (!isPausedByCollision.value) return '';
  const p = altitudeGate.flightPhase.value;
  if (p === PHASES.ASCENDING) return t('aerialview.obstacle_above');
  if (p === PHASES.DESCENDING) return t('aerialview.obstacle_below');
  return '';
});
const isPreCaching = computed(() => {
  const p = altitudeGate.flightPhase.value;
  return p === PHASES.PRE_TAKEOFF || p === PHASES.PRE_LANDING;
});
// Street View is only used on the 3D Aerial (Google tiles) subpage. On the
// 3D Mesh (OSM Buildings) subpage the drone renders OSM buildings all the way
// from airborne to ground, so no Street View switch-over happens. Loading
// Google Street View there would also spin up a second WebGL context that
// fights the Cesium context (the source of the uniform3fv warnings).
const streetViewEnabled = computed(() => activeSource.value !== 'osm');
const showStreetView = computed(() => streetViewEnabled.value && (drone.alt - altitudeGate.surfaceAlt.value) < ASCEND_THRESHOLD);
const shouldPrewarmSV = computed(() => {
  if (!streetViewEnabled.value) return false;
  const phase = altitudeGate.flightPhase.value;
  if (phase === PHASES.PRE_LANDING || phase === PHASES.DESCENDING) return true;
  return (drone.alt - altitudeGate.surfaceAlt.value) < 20;
});
const isTransitioning = computed(() => {
  const rel = drone.alt - altitudeGate.surfaceAlt.value;
  return rel >= DESCEND_THRESHOLD && rel < ASCEND_THRESHOLD;
});
const streetViewOpacity = computed(() => {
  if (!streetViewEnabled.value) return 0;
  const rel = drone.alt - altitudeGate.surfaceAlt.value;
  if (rel <= DESCEND_THRESHOLD) return 1;
  if (rel >= ASCEND_THRESHOLD) return 0;
  return 1 - (rel - DESCEND_THRESHOLD) / (ASCEND_THRESHOLD - DESCEND_THRESHOLD);
});
// Effective state bound to StreetViewPane: live flight values normally, the
// replayed trajectory while the recorder replays it. Without this the replay
// (and the recorded clip) would stick to the 3D tiles and never reproduce
// the aerial -> street view asset switch.
const svPaneState = computed(() => {
  if (recorderState.value === 'replaying' && replayPov.value) {
    const pov = replayPov.value;
    return {
      lat: pov.lat,
      lon: pov.lon,
      headingRad: pov.headingRad,
      pitchRad: pov.pitchRad,
      relativeAlt: pov.relativeAlt,
      visible: pov.showStreetView,
      opacity: pov.streetViewOpacity,
      transitioning: pov.relativeAlt >= DESCEND_THRESHOLD && pov.relativeAlt < ASCEND_THRESHOLD,
    };
  }
  const pov = getStreetViewPov();
  return {
    lat: drone.lat,
    lon: drone.lon,
    headingRad: pov.headingRad,
    pitchRad: pov.pitchRad,
    relativeAlt: pov.relativeAlt,
    visible: showStreetView.value,
    opacity: streetViewOpacity.value,
    transitioning: isTransitioning.value,
  };
});
const takeoffLandingLabel = computed(() => {
  const p = altitudeGate.flightPhase.value;
  if (p === PHASES.PRE_TAKEOFF) return t('aerialview.preparing_takeoff');
  if (p === PHASES.PRE_LANDING) return t('aerialview.scanning_landing');
  if (p === PHASES.ASCENDING) return t('aerialview.taking_off');
  if (p === PHASES.DESCENDING) return t('aerialview.landing_in_progress');
  return altitudeGate.isOnGround.value ? t('aerialview.takeoff') : t('aerialview.landing');
});

function hideAllDisks() {
  showFlight.value = false;
  showCamera.value = false;
}

// Opening the Pages menu leaves the recording context: abort any active
// screen recording (discard without saving) so it cannot be orphaned by a
// navigation away from this page.
function onPagesOpen() {
  hideAllDisks();
  if (recorderState.value !== 'idle') {
    resetRecorder();
  }
}

// Wait until the newly active tileset (and the globe in mesh mode) reports
// its view-dependent tiles as loaded, with guards so a tile failure can
// never trap the progress bar on screen. Like the splash dismissal, this
// polls `tilesLoaded` rather than counting tileLoadProgressEvent requests.
function waitForAssetsLoaded() {
  return new Promise((resolve) => {
    const viewer = window.cesiumViewer;
    if (!viewer) return resolve();
    const start = performance.now();
    const MIN_WAIT = 400; // ms: let Cesium issue the first tile requests
    const MAX_WAIT = 30000; // ms: never trap the UI on tile failures
    const check = () => {
      const elapsed = performance.now() - start;
      const tileset = getActiveTileset();
      const tilesetDone = !tileset || tileset.tilesLoaded;
      const globeDone = activeSource.value !== 'osm' || viewer.scene.globe.tilesLoaded;
      if ((elapsed >= MIN_WAIT && tilesetDone && globeDone) || elapsed >= MAX_WAIT) {
        resolve();
        return;
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

// Swap the 3D data source for the active subpage and show the top-center
// progress bar until the new assets are loaded and rendered.
async function swapSourceWithProgress(val) {
  const token = ++loadToken;
  assetLoading.value = true;
  assetLoadProgress.value = 0;
  loadStartTs = performance.now();
  // Lazy manifest fallback: AWAIT it so even the very first switch (clicked
  // before the mount-time warm-up has landed) still gets a cover clip.
  if (!allSwitchClips.length) await loadSwitchClips();
  switchVideoUrl.value = nextSwitchClip(); // '' only if the fetch failed
  // Serialize with any in-flight swap so rapid back-and-forth clicks queue
  // (last click wins) instead of being dropped by setSource's isSwitching
  // guard, which would leave the scene on the subpage the user clicked AWAY
  // from while this direction's cover hid early.
  while (isSwitching.value) {
    if (token !== loadToken) return; // superseded while queued
    await new Promise((r) => setTimeout(r, 100));
  }
  await setSource(val === 'mesh' ? 'osm' : 'google');
  await waitForAssetsLoaded();
  if (token !== loadToken) return; // a newer switch took over
  assetLoadProgress.value = 1;
  setTimeout(() => {
    if (token !== loadToken) return;
    assetLoading.value = false;
    switchVideoUrl.value = ''; // Transition fade-out keeps the last frame
    warmSwitchClip(); // pre-buffer the next queued clip for the next switch
  }, 500);
}

// ── Takeoff / Stop / Landing switcher ──
// The dock button is a 3-state switcher cycled ENTIRELY by the user:
//   takeoff -> stop -> landing -> stop -> takeoff -> ...
// It never judges whether the drone is on the ground or airborne:
// - 'takeoff' starts the auto takeoff sequence (climb to takeoffAltitude);
// - 'landing' starts the auto landing sequence (descend to the surface);
// - 'stop' aborts an in-progress sequence and holds the current altitude
//   (inside the bottom ground band the ground clamp settles the drone onto
//   the surface, so a low-altitude stop behaves like an early landing).
// The button stays ENABLED during takeoff/landing so the sequence can be
// interrupted mid-flight; the other buttons keep their original locking.
const SWITCH_SEQUENCE = ['takeoff', 'stop', 'landing', 'stop'];
const switchIndex = ref(0); // index of the action the button currently offers

function syncTakeoffSwitchItem() {
  const item = rightItems.find((i) => i.id === 'takeoff');
  if (!item) return;
  const action = SWITCH_SEQUENCE[switchIndex.value];
  item.icon = action === 'takeoff' ? 'MENU_TAKEOFF'
    : action === 'landing' ? 'MENU_LANDING'
    : 'MENU_STOP';
  item.titleKey = `aerialview.${action}`;
}

function toggleTakeoffLanding() {
  const viewer = window.cesiumViewer;
  const action = SWITCH_SEQUENCE[switchIndex.value];
  if (action === 'takeoff') {
    // startTakeoff returns false when the drone is already above the takeoff
    // altitude (settings.takeoffAltitude, default 100 m): no sequence starts,
    // the user just gets the green reminder below.
    //
    // The takeoff tile pre-warm teleports the Cesium camera to the target
    // altitude for a few frames. Only allow that while the Street View
    // overlay fully covers the (still rendering) Cesium canvas — mirrored
    // from the .cesium-hidden watcher below — otherwise the teleport shows
    // up as a visible tremble.
    const cesiumCovered = svPaneState.value.visible && !svPaneState.value.transitioning && streetViewReady.value;
    if (!altitudeGate.startTakeoff(viewer, { cameraPrewarm: cesiumCovered })) {
      flashTakeoffLimitNotice();
    }
  } else if (action === 'landing') {
    altitudeGate.startLanding(viewer);
  } else {
    altitudeGate.stopAuto();
  }
  switchIndex.value = (switchIndex.value + 1) % SWITCH_SEQUENCE.length;
  syncTakeoffSwitchItem();
}

// Green top-center reminder: 'takeoff' was clicked while the drone is already
// beyond the takeoff altitude. Auto-hides after a few seconds.
const takeoffLimitNotice = ref('');
let takeoffLimitTimer = null;
function flashTakeoffLimitNotice() {
  takeoffLimitNotice.value = t('aerialview.takeoff_above_limit', { alt: settings.takeoffAltitude });
  clearTimeout(takeoffLimitTimer);
  takeoffLimitTimer = setTimeout(() => { takeoffLimitNotice.value = ''; }, 5000);
}

watch(
  [() => svPaneState.value.visible, () => svPaneState.value.transitioning, streetViewReady],
  ([show, transitioning, svReady]) => {
    const viewer = window.cesiumViewer;
    if (viewer) {
      // In mesh (OSM) mode the globe must stay visible as ground context; in
      // aerial (Google) mode it is only shown during the street-view
      // transition crossfade.
      viewer.scene.globe.show = activeSource.value === 'osm' || (show && transitioning);
    }
    if (cesiumContainer.value) {
      // Only hide Cesium when Street View is fully loaded to prevent black flash
      cesiumContainer.value.classList.toggle('cesium-hidden', show && !transitioning && svReady);
    }
  },
  { immediate: true }
);

function getFlightCommandSpeed() {
  if (activeFlightMode.value === 'M') {
    const cmdMag = Math.hypot(flightCmd.vx, flightCmd.vy);
    return cmdMag * 0.0002 * 111320;
  }
  if (activeFlightMode.value === 'H') {
    return Math.abs(flightCmd.vz) * 20.0;
  }
  return 0;
}

function getFlightCommandDirection() {
  const viewer = window.cesiumViewer;
  if (!viewer) return null;

  const position = Cesium.Cartesian3.fromDegrees(drone.lon, drone.lat, drone.alt);
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(position);

  if (activeFlightMode.value === 'M') {
    const mag = Math.hypot(flightCmd.vx, flightCmd.vy) || 1;
    const headingRad = Cesium.Math.toRadians(drone.heading);
    const enuDir = new Cesium.Cartesian3(
      (flightCmd.vy * Math.sin(headingRad) + flightCmd.vx * Math.cos(headingRad)) / mag,
      (flightCmd.vy * Math.cos(headingRad) - flightCmd.vx * Math.sin(headingRad)) / mag,
      0
    );
    const worldDir = Cesium.Matrix4.multiplyByPointAsVector(enuTransform, enuDir, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(worldDir, worldDir);
  }

  if (activeFlightMode.value === 'H') {
    const enuUp = new Cesium.Cartesian3(0, 0, flightCmd.vz >= 0 ? 1 : -1);
    const worldDir = Cesium.Matrix4.multiplyByPointAsVector(enuTransform, enuUp, new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(worldDir, worldDir);
  }

  return null;
}

function checkCollisionAhead() {
  const viewer = window.cesiumViewer;
  const tileset = getActiveTileset();
  if (!viewer || !tileset || !showFlight.value) return null;

  const speed = getFlightCommandSpeed();
  if (speed <= 0) return null;

  const direction = getFlightCommandDirection();
  if (!direction) return null;

  const position = Cesium.Cartesian3.fromDegrees(drone.lon, drone.lat, drone.alt);
  const ray = new Cesium.Ray(position, direction);
  let result = null;
  try {
    result = viewer.scene.pickFromRay(ray);
  } catch {
    return null; // transient raycast failure while tiles stream — skip this frame
  }

  if (!result || !result.position) return null;

  const hitObject = result.object;
  const isTilesetHit =
    hitObject === tileset ||
    (hitObject && hitObject.tileset === tileset) ||
    (hitObject && hitObject.primitive === tileset);
  if (!isTilesetHit) return null;

  const distance = Cesium.Cartesian3.distance(position, result.position);
  const buffer = MIN_SAFETY_BUFFER + speed * LOOK_AHEAD_TIME;
  if (distance > buffer) return null;

  const normal = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.subtract(position, result.position, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );

  return { distance, position: result.position, normal };
}

function projectEnuMove(enuMove, collision) {
  const position = Cesium.Cartesian3.fromDegrees(drone.lon, drone.lat, drone.alt);
  const enuTransform = Cesium.Transforms.eastNorthUpToFixedFrame(position);
  const invTransform = Cesium.Matrix4.inverse(enuTransform, new Cesium.Matrix4());
  const enuNormal = Cesium.Matrix4.multiplyByPointAsVector(invTransform, collision.normal, new Cesium.Cartesian3());
  Cesium.Cartesian3.normalize(enuNormal, enuNormal);

  const dot = Cesium.Cartesian3.dot(enuMove, enuNormal);
  if (dot >= 0) return enuMove;

  const normalComponent = Cesium.Cartesian3.multiplyByScalar(enuNormal, dot, new Cesium.Cartesian3());
  return Cesium.Cartesian3.subtract(enuMove, normalComponent, new Cesium.Cartesian3());
}

const CAMERA_SYNC_INTERVAL_MS = 1000 / 30;
const CAMERA_POSITION_EPSILON = 0.005;
const CAMERA_ANGLE_EPSILON = 0.05;
let lastCesiumCameraSyncTs = 0;
let lastCesiumCameraState = null;

function angleDistance(a, b) {
  const delta = Math.abs((Number(a) - Number(b) + 540) % 360 - 180);
  return delta;
}

function syncCesiumCamera(now = performance.now()) {
  if (typeof window.updateCesiumCamera === 'function') {
    const selected = fleet.followSelected.value ? fleet.selectedDrone.value : null;
    const cameraDrone = selected || drone;
    const nextState = {
      lat: Number(cameraDrone.lat),
      lon: Number(cameraDrone.lon),
      alt: Number(cameraDrone.alt),
      heading: Number(cameraDrone.heading ?? cameraDrone.yaw ?? drone.heading),
      gimbalYaw: selected ? 0 : gimbal.yaw,
      gimbalPitch: selected ? 0 : gimbal.pitch,
      gimbalRoll: selected ? 0 : gimbal.roll,
    };
    const previous = lastCesiumCameraState;
    const changed = !previous
      || Math.abs(nextState.lat - previous.lat) > CAMERA_POSITION_EPSILON / 111_320
      || Math.abs(nextState.lon - previous.lon) > CAMERA_POSITION_EPSILON / 111_320
      || Math.abs(nextState.alt - previous.alt) > CAMERA_POSITION_EPSILON
      || angleDistance(nextState.heading, previous.heading) > CAMERA_ANGLE_EPSILON
      || angleDistance(nextState.gimbalYaw, previous.gimbalYaw) > CAMERA_ANGLE_EPSILON
      || Math.abs(nextState.gimbalPitch - previous.gimbalPitch) > CAMERA_ANGLE_EPSILON
      || Math.abs(nextState.gimbalRoll - previous.gimbalRoll) > CAMERA_ANGLE_EPSILON;
    if (!changed || now - lastCesiumCameraSyncTs < CAMERA_SYNC_INTERVAL_MS) return;
    lastCesiumCameraSyncTs = now;
    lastCesiumCameraState = nextState;
    window.updateCesiumCamera(nextState);
  }
}

function getStreetViewPov() {
  const headingRad = ((drone.heading + gimbal.yaw) * Math.PI) / 180;
  const pitchRad = (gimbal.pitch * Math.PI) / 180;
  const relativeAlt = Math.max(0, drone.alt - altitudeGate.surfaceAlt.value);
  return { headingRad, pitchRad, relativeAlt };
}

let rafId = null;
let fleetRenderTs = 0;
let fleetFrameCount = 0;
let fleetPerfTs = 0;
let fleetStateSignature = '';

function updateFleetLayer(now) {
  if (!fleetEnabled.value) return;
  fleetFrameCount += 1;
  if (now - fleetRenderTs < 50) return; // cap fleet writes at 20 Hz
  fleetRenderTs = now;
  fleet.syncLocalDrone(drone);
  const states = fleet.getRenderStates();
  const signature = `${fleet.selectedDroneId.value}|${states.map((state) => `${state.droneId}:${state.sequence}:${state.online ? 1 : 0}`).join(',')}`;
  if (signature === fleetStateSignature) return;
  fleetStateSignature = signature;
  if (typeof window.updateDroneFleet === 'function') {
    window.updateDroneFleet(states, {
      localDroneId: fleet.localDroneId,
      selectedDroneId: fleet.selectedDroneId.value,
      renderDistance: 500,
      labelDistance: 220,
    });
    const stats = typeof window.getDroneFleetStats === 'function'
      ? window.getDroneFleetStats()
      : { objects: states.length, visible: states.length };
    fleetPerformance.objects = stats.objects;
    fleetPerformance.visible = stats.visible;
  }
  if (!fleetPerfTs) fleetPerfTs = now;
  if (now - fleetPerfTs >= 500) {
    fleetPerformance.fps = Math.round((fleetFrameCount * 1000) / (now - fleetPerfTs));
    fleetFrameCount = 0;
    fleetPerfTs = now;
  }
}

function updateDroneState() {
  const dt = 1 / 60;
  const viewer = window.cesiumViewer;

  altitudeGate.update(viewer);

  if (isTakeoffLanding.value) {
    altitudeGate.stepAuto(dt, viewer);
    // During collision pause, allow manual flight/camera so user can reposition.
    // Only block manual input when the auto sequence is actively moving.
    if (!isPausedByCollision.value) {
      onFlightStop();
      onCameraStop();
      return;
    }
  }

  const allowAltitude = !altitudeGate.isOnGround.value || activeFlightMode.value === 'H';
  let enuMove = null;

  if (showFlight.value) {
    enuMove = computeDesiredEnuMove(dt, allowAltitude);
  }

  const collision = checkCollisionAhead();
  if (collision && enuMove) {
    enuMove = projectEnuMove(enuMove, collision);
    isCollisionFrozen.value = true;
    collisionSurfaceNormal.value = collision.normal;
  } else {
    isCollisionFrozen.value = false;
    collisionSurfaceNormal.value = null;
  }

  if (showFlight.value) {
    applyEnuMove(enuMove);
    updateFlightTelemetry(allowAltitude);
    // R-mode: rotate drone heading (3D view rotates accordingly)
    if (activeFlightMode.value === 'R') {
      drone.heading += flightCmd.yaw * 60.0 * dt;
    }
  }

  if (altitudeGate.isOnGround.value) {
    if (activeFlightMode.value === 'M') {
      // M-mode: clamp to ground, no vertical movement allowed
      altitudeGate.snapToGround();
      flightCmd.vz = 0;
    } else if (activeFlightMode.value === 'R') {
      // R-mode: allow rotation, clamp altitude to ground
      altitudeGate.snapToGround();
      flightCmd.vz = 0;
    }
    // H-mode: no ground clamp — user controls altitude freely
  }

  if (showCamera.value) {
    stepCameraPhysics(dt, { applyMovement: true });
  }
}

let loopErrorLogTs = 0;

function loop() {
  // A single bad frame (e.g., a Cesium raycast failing while tiles stream)
  // must never kill the loop: if it stops, the scene freezes and the disks
  // appear dead. Log throttled and keep animating.
  try {
    if (recorderState.value === 'recording') {
      sampleFrame(drone, gimbal, altitudeGate.surfaceAlt.value);
    }
    // Advance the asset-loading progress bar while a subpage switch streams
    // in (asymptotic to 90%; the last 10% completes on tilesLoaded).
    if (assetLoading.value && assetLoadProgress.value < 0.9) {
      const elapsedMs = performance.now() - loadStartTs;
      assetLoadProgress.value = Math.min(0.9, 0.9 * (1 - Math.exp(-elapsedMs / 1500)));
    }
    updateFleetLayer(performance.now());
    // During replay the replay engine owns the Cesium camera; skip the flight
    // physics, collision checks and camera sync so they cannot fight it.
    if (recorderState.value !== 'replaying') {
      updateDroneState();
      syncCesiumCamera();
    }
  } catch (err) {
    const now = performance.now();
    if (now - loopErrorLogTs > 2000) {
      loopErrorLogTs = now;
      console.error('[AerialView] Frame error (loop continues):', err);
    }
  }
  rafId = requestAnimationFrame(loop);
}

onMounted(() => {
  cesiumContainer.value = document.getElementById('cesiumContainer');
  startFlightKeyboard();
  startCameraKeyboard();
  syncCesiumCamera();

  // Initial connection check and periodic re-check.
  checkGoogleConnection();
  checkCesiumConnection();
  connectionCheckInterval = setInterval(() => {
    checkGoogleConnection();
    checkCesiumConnection();
  }, 10000);

  // Register pages for the router menu
  registerPage({ id: 'aerial', nameKey: 'aerialview.page_aerial', route: '/' });
  registerPage({ id: 'map', nameKey: 'aerialview.page_map', route: '/map' });
  registerPage({ id: 'realdrone', nameKey: 'aerialview.page_realdrone', route: '/real-drone' });
  registerPage({ id: 'extensions', nameKey: 'aerialview.page_extensions', route: '/extensions' });
  registerPage({ id: 'chat', nameKey: 'aerialview.page_chat', route: '/chat' });
  registerPage({ id: 'myspace', nameKey: 'aerialview.page_myspace', route: '/myspace' });

  registerLeft({
    id: 'router',
    render: () => h(DockMenuButton, {
      icon: 'MENU_ROUTER',
      titleKey: 'aerialview.pages',
      pages,
      onBeforeOpen: onPagesOpen,
    }),
  });
  registerLeft({
    id: 'camera',
    icon: 'MENU_CAMERA',
    titleKey: 'aerialview.camera',
    active: showCamera.value,
    onClick: toggleCamera,
  });
  registerLeft({
    id: 'subpage_aerial',
    icon: 'MENU_HELICOPTER',
    titleKey: 'aerialview.subpage_aerial',
    active: activeSubpage.value === 'aerial',
    onClick: () => {
      activeSubpage.value = 'aerial';
    },
  });
  registerLeft({
    id: 'subpage_mesh',
    icon: 'MENU_MESH',
    titleKey: 'aerialview.subpage_mesh',
    active: activeSubpage.value === 'mesh',
    onClick: () => {
      activeSubpage.value = 'mesh';
    },
  });
  registerLeft({
    id: 'fleet-toggle',
    icon: 'MENU_DRONE_PLUS',
    titleKey: fleetEnabled.value ? 'aerialview.fleet_disable' : 'aerialview.fleet_enable',
    active: fleetEnabled.value,
    onClick: toggleFleetMode,
  });
  registerLeft({
    id: 'openclaw-float',
    icon: 'MENU_OPENCLAW',
    titleKey: 'aerialview.openclaw_open',
    active: openClawPanelOpen.value,
    onClick: toggleOpenClawPanel,
  });
  registerLeft({
    id: 'situation-toggle',
    icon: 'MENU_MAP',
    titleKey: 'aerialview.situation_open',
    active: situationPanelOpen.value,
    onClick: toggleSituationPanel,
  });

  registerRight({
    id: 'steer',
    icon: 'MENU_CONTROL_STICK',
    titleKey: 'aerialview.steer',
    active: showFlight.value,
    onClick: toggleFlight,
  });
  // Takeoff/Stop/Landing switcher — always starts at 'takeoff'; its icon
  // and title are driven by switchIndex (see toggleTakeoffLanding), NOT by
  // the drone's altitude.
  registerRight({
    id: 'takeoff',
    icon: 'MENU_TAKEOFF',
    titleKey: 'aerialview.takeoff',
    onClick: toggleTakeoffLanding,
  });
  registerRight({
    id: 'screenshot',
    icon: 'MENU_PHOTO',
    titleKey: 'aerialview.screenshot',
    onClick: guardedScreenshot,
  });
  registerRight({
    id: 'recorder',
    icon: 'MENU_RECORDER',
    titleKey: 'aerialview.recorder',
    active: isRecorderActive,
    danger: true,
    onClick: guardedToggleRecorder,
  });

  // Sync dock button active states with toggle state
  watch(showFlight, (val) => {
    const item = rightItems.find((i) => i.id === 'steer');
    if (item) item.active = val;
  });
  watch(showCamera, (val) => {
    const item = leftItems.find((i) => i.id === 'camera');
    if (item) item.active = val;
  });
  watch(fleetEnabled, syncFleetToggleItem);
  watch(openClawPanelOpen, (val) => {
    const item = leftItems.find((entry) => entry.id === 'openclaw-float');
    if (item) item.active = val;
  });

  // Keep the subpage selector buttons in sync with the active subpage.
  watch(activeSubpage, (val) => {
    const aerialBtn = leftItems.find((i) => i.id === 'subpage_aerial');
    if (aerialBtn) aerialBtn.active = val === 'aerial';
    const meshBtn = leftItems.find((i) => i.id === 'subpage_mesh');
    if (meshBtn) meshBtn.active = val === 'mesh';
  
    // Swap the 3D data source to match the active subpage (with a top-center
    // progress bar while the new assets load and render).
    swapSourceWithProgress(val);
  });

  // Warm the splash-clip manifest + first cover clip in the background, well
  // after the initial tile load has settled so it cannot compete with it.
  setTimeout(loadSwitchClips, 8000);

  // React to recorder state transitions: update the dock button title, and
  // close the Flight/Gimbal disks during replay (restored when it ends).
  watch(recorderState, (state, prev) => {
    const item = rightItems.find((i) => i.id === 'recorder');
    if (item) {
      item.titleKey =
        state === 'recording' ? 'aerialview.recorder_stop'
        : state === 'replaying' ? 'aerialview.recorder_cancel'
        : 'aerialview.recorder';
    }
    // Lock the 3D Aerial / 3D Mesh source switch and the Screenshot button
    // while the recorder is active: swapping the 3D data source mid-recording
    // would corrupt the aerial/street-view asset tracking of the clip, and a
    // screenshot during capture is redundant.
    const assetLocked = state !== 'idle';
    for (const list of [leftItems, rightItems]) {
      for (const dockItem of list) {
        if (dockItem.id === 'subpage_aerial' || dockItem.id === 'subpage_mesh' || dockItem.id === 'screenshot') {
          dockItem.disabled = assetLocked;
        }
      }
    }
    if (state === 'replaying' && prev === 'recording') {
      savedDiskVisibility = { flight: showFlight.value, camera: showCamera.value };
      showFlight.value = false;
      showCamera.value = false;
    } else if (state === 'idle' && prev === 'replaying' && savedDiskVisibility) {
      showFlight.value = savedDiskVisibility.flight;
      showCamera.value = savedDiskVisibility.camera;
      savedDiskVisibility = null;
    }
  });

  // Disable non-navigation dock buttons during takeoff/landing transitions —
  // EXCEPT the takeoff/stop/landing switcher itself, which must stay clickable
  // so the user can interrupt the sequence mid-flight (its whole purpose).
  // During a collision pause the other buttons unlock so the user can
  // reposition. Pages (router) and Chat buttons remain enabled so the user
  // can navigate away.
  watch([isTakeoffLanding, isPausedByCollision], ([transitioning, paused]) => {
    const lockableIds = ['steer', 'camera', 'recorder'];
    for (const list of [leftItems, rightItems]) {
      for (const item of list) {
        if (lockableIds.includes(item.id)) {
          item.disabled = transitioning && !paused;
        }
      }
    }
  });

  rafId = requestAnimationFrame(loop);
});

onUnmounted(() => {
  resetRecorder();
  if (fleetEnabled.value) {
    fleet.setMode('off');
    if (typeof window.clearDroneFleet === 'function') window.clearDroneFleet();
  }
  stopFlightKeyboard();
  stopCameraKeyboard();
  if (rafId) cancelAnimationFrame(rafId);
  if (connectionCheckInterval) clearInterval(connectionCheckInterval);
  clear();
  unregisterPage('aerial');
  unregisterPage('realdrone');
  unregisterPage('map');
  unregisterPage('myspace');
  unregisterPage('chat');
  unregisterPage('extensions');
});
</script>

<template>
  <ViewComposer
    :left-items="leftItems"
    :right-items="rightItems"
    :show-flight="showFlight"
    :show-camera="showCamera"
    :show-hud="recorderState !== 'replaying'"
    :flight="flight"
    :camera="camera"
    :hud-avoid-right="openClawPanelOpen"
    :disabled="isAutoActive"
    @flightMove="onFlightMove"
    @flightStop="onFlightStop"
    @flightModeChange="onFlightModeChange"
    @cameraMove="onCameraMove"
    @cameraStop="onCameraStop"
    @cameraModeChange="onCameraModeChange"
  >
    <template #background>
      <StreetViewPane
        class="view-composer__background"
        :lat="svPaneState.lat"
        :lon="svPaneState.lon"
        :heading="svPaneState.headingRad"
        :pitch="svPaneState.pitchRad"
        :altitude="svPaneState.relativeAlt"
        :visible="svPaneState.visible"
        :prewarm="shouldPrewarmSV"
        :style="{ opacity: svPaneState.opacity }"
        @ready="streetViewReady = true"
      />
    </template>

    <template #top-overlay>
      <DroneSituationPanel
        :open="situationPanelOpen"
        :mode="situationMode"
        :drones="situationDrones"
        :selected-drone-id="situationSelectedDroneId"
        :selected-drone="situationSelectedDrone"
        @close="closeSituationPanel"
        @mode-change="setSituationMode"
        @select-drone="selectSituationDrone"
      />
      <ConnectionError :visible="showConnectionError" :message="connectionMessage" />
      <OpenClawFlightPanel
        :open="openClawPanelOpen"
        :status="openClawStatus"
        :is-connected="openClawConnected"
        :messages="openClawMessages"
        :drones="fleetDroneRows"
        :selected-drone-id="fleet.selectedDroneId.value"
        :selected-drone="fleet.selectedDrone.value"
        :fleet-enabled="fleetEnabled"
        :pending-command="pendingDroneCommand"
        :notice="openClawCommandNotice"
        @close="openClawPanelOpen = false"
        @connect="connectOpenClaw"
        @send="handleOpenClawMessage"
        @select-drone="selectFleetDrone"
        @prepare-command="prepareDroneCommand"
        @confirm-command="confirmDroneCommand"
        @cancel-command="cancelDroneCommand"
      />
      <section v-if="fleetEnabled" class="fleet-panel" aria-label="Multi-drone flight deck">
        <header class="fleet-panel__header">
          <div>
            <span class="fleet-panel__eyebrow">{{ t('aerialview.fleet_mode') }}</span>
            <strong>{{ t('aerialview.fleet_title') }}</strong>
          </div>
          <span class="fleet-panel__status" :class="`fleet-panel__status--${fleet.liveConnection.status}`">
            {{ fleetLiveEnabled ? t(`aerialview.fleet_live_${fleet.liveConnection.status}`) : t('aerialview.fleet_demo') }}
          </span>
        </header>
        <div class="fleet-panel__mode-switch">
          <button type="button" :class="{ 'is-active': fleetDemoEnabled }" @click="activateDemoFleet">
            {{ t('aerialview.fleet_demo') }}
          </button>
          <button type="button" :class="{ 'is-active': fleetLiveEnabled }" @click="activateLiveFleet">
            {{ t('aerialview.fleet_live') }}
          </button>
        </div>
        <div class="fleet-panel__metrics">
          <span><b>{{ fleetDroneRows.length }}</b> {{ t('aerialview.fleet_drones') }}</span>
          <span><b>{{ fleetPerformance.visible }}</b> {{ t('aerialview.fleet_visible') }}</span>
          <span><b>{{ fleetPerformance.fps || 0 }}</b> FPS</span>
          <span v-if="fleetLiveEnabled"><b>{{ fleet.liveConnection.latencyMs ?? '–' }}</b> ms</span>
        </div>
        <div class="fleet-panel__actions">
          <button type="button" @click="toggleFleetFollow">
            {{ fleet.followSelected.value ? t('aerialview.fleet_unfollow') : t('aerialview.fleet_follow') }}
          </button>
          <button type="button" :disabled="!openClawConnected || openClawSyncState === 'syncing'" @click="syncFleetToOpenClaw">
            {{ openClawSyncState === 'syncing' ? t('aerialview.openclaw_syncing') : t('aerialview.openclaw_sync') }}
          </button>
          <button v-if="fleetLiveEnabled && fleet.selectedDrone.value" type="button" @click="toggleSelectedControlLease">
            {{ ownsSelectedFleetLease ? t('aerialview.fleet_release_control') : t('aerialview.fleet_claim_control') }}
          </button>
        </div>
        <div class="fleet-panel__list">
          <button
            v-for="item in fleetDroneRows"
            :key="item.droneId"
            type="button"
            class="fleet-panel__drone"
            :class="{ 'fleet-panel__drone--selected': item.droneId === fleet.selectedDroneId.value, 'fleet-panel__drone--local': item.local }"
            @click="selectFleetDrone(item.droneId)"
          >
            <span class="fleet-panel__dot" :style="{ backgroundColor: item.color }" />
            <span class="fleet-panel__drone-name">{{ item.name }}</span>
            <span class="fleet-panel__drone-meta">{{ item.battery.toFixed(0) }}% · {{ item.distance.toFixed(0) }}m</span>
          </button>
        </div>
        <p class="fleet-panel__hint">
          {{ fleetLiveEnabled ? t('aerialview.fleet_live_hint') : t('aerialview.fleet_demo_hint') }}
        </p>
      </section>
      <CollisionWarning :visible="isCollisionFrozen" />
      <div v-if="collisionPausedMessage" class="top-center-message top-center-message--warning">
        {{ collisionPausedMessage }}
      </div>
      <div v-if="lockedMessage" class="top-center-message top-center-message--warning">
        {{ lockedMessage }}
      </div>
      <div v-if="takeoffLimitNotice" class="top-center-message top-center-message--success">
        {{ takeoffLimitNotice }}
      </div>
      <div
        v-if="isPreCaching"
        class="pre-cache-overlay"
      >
        <span class="pre-cache-overlay__text">{{ takeoffLandingLabel }}</span>
      </div>
      <div
        v-if="recorderState === 'replaying'"
        class="top-center-message replay-pill"
      >
        {{ t('aerialview.replaying', { pct: Math.round(replayProgress * 100) }) }}
      </div>
      <Transition name="switch-video">
        <div v-if="assetLoading && switchVideoUrl" class="switch-video-cover">
          <video
            :key="switchVideoUrl"
            class="switch-video-cover__video"
            :src="switchVideoUrl"
            autoplay
            muted
            loop
            playsinline
            preload="auto"
            @playing="onSwitchVideoPlaying"
          />
        </div>
      </Transition>
      <div
        v-if="captureAuthNotice"
        class="top-center-message top-center-message--auth"
      >
        {{ t(`aerialview.auth_notice_${captureAuthNotice}`) }}
      </div>
      <div
        v-if="assetLoading"
        class="top-center-message asset-loading"
      >
        <span>{{ t('aerialview.loading_assets') }}</span>
        <div class="asset-loading__track">
          <div class="asset-loading__fill" :style="{ width: (assetLoadProgress * 100).toFixed(1) + '%' }" />
        </div>
      </div>
    </template>
  </ViewComposer>
</template>

<style scoped>
:global(:root) {
  --fleet-cyan: #53b7ff;
  --fleet-mint: #63e6be;
  --fleet-panel: rgba(5, 16, 27, 0.82);
}

.fleet-panel {
  position: fixed;
  top: 24px;
  right: 94px;
  z-index: 60;
  width: min(360px, calc(100vw - 150px));
  padding: 14px;
  border: 1px solid rgba(83, 183, 255, 0.35);
  border-radius: 12px;
  background: var(--fleet-panel);
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.32), inset 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  color: rgba(239, 248, 255, 0.92);
  font-family: 'Courier New', Courier, monospace;
  pointer-events: auto;
}

.fleet-panel__header,
.fleet-panel__metrics,
.fleet-panel__actions,
.fleet-panel__drone {
  display: flex;
  align-items: center;
}

.fleet-panel__header {
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.fleet-panel__header strong,
.fleet-panel__eyebrow {
  display: block;
}

.fleet-panel__eyebrow {
  margin-bottom: 4px;
  color: var(--fleet-cyan);
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.fleet-panel__header strong {
  font-size: 0.85rem;
  letter-spacing: 0.04em;
}

.fleet-panel__status {
  flex-shrink: 0;
  padding: 4px 7px;
  border-radius: 999px;
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.16);
  font-size: 0.62rem;
  white-space: nowrap;
}

.fleet-panel__status--connecting,
.fleet-panel__status--reconnecting,
.fleet-panel__status--auth_required,
.fleet-panel__status--closed,
.fleet-panel__status--error,
.fleet-panel__status--idle {
  color: #f8d789;
  background: rgba(234, 179, 8, 0.14);
}

.fleet-panel__mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-top: 10px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}

.fleet-panel__mode-switch button {
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(206, 228, 242, 0.68);
  cursor: pointer;
  font: inherit;
  font-size: 0.66rem;
}

.fleet-panel__mode-switch button.is-active {
  background: rgba(83, 183, 255, 0.2);
  color: #e8f7ff;
}

.fleet-panel__metrics {
  justify-content: space-between;
  gap: 8px;
  padding: 10px 0;
  color: rgba(206, 228, 242, 0.68);
  font-size: 0.62rem;
}

.fleet-panel__metrics b {
  color: var(--fleet-mint);
  font-size: 0.82rem;
}

.fleet-panel__actions {
  gap: 7px;
  margin-bottom: 8px;
}

.fleet-panel__actions button {
  flex: 1;
  min-width: 0;
  padding: 7px 8px;
  border: 1px solid rgba(83, 183, 255, 0.32);
  border-radius: 7px;
  color: #dff4ff;
  background: rgba(83, 183, 255, 0.1);
  font: inherit;
  font-size: 0.64rem;
  cursor: pointer;
}

.fleet-panel__actions button:hover:not(:disabled),
.fleet-panel__actions button:focus-visible {
  border-color: var(--fleet-cyan);
  background: rgba(83, 183, 255, 0.22);
  outline: none;
}

.fleet-panel__actions button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.fleet-panel__list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  max-height: 230px;
  overflow-y: auto;
  padding-right: 2px;
}

.fleet-panel__drone {
  min-width: 0;
  gap: 6px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(239, 248, 255, 0.8);
  background: rgba(255, 255, 255, 0.04);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.fleet-panel__drone:hover,
.fleet-panel__drone--selected {
  border-color: rgba(83, 183, 255, 0.6);
  background: rgba(83, 183, 255, 0.16);
}

.fleet-panel__drone--local {
  border-color: rgba(99, 230, 190, 0.32);
}

.fleet-panel__dot {
  width: 7px;
  height: 7px;
  flex: 0 0 auto;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}

.fleet-panel__drone-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fleet-panel__drone-meta {
  color: rgba(206, 228, 242, 0.58);
  font-size: 0.58rem;
  white-space: nowrap;
}

.fleet-panel__hint {
  margin: 9px 0 0;
  color: rgba(206, 228, 242, 0.54);
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 0.68rem;
  line-height: 1.35;
}

@media (max-width: 768px) {
  .fleet-panel {
    top: 14px;
    right: 82px;
    width: min(300px, calc(100vw - 98px));
    padding: 10px;
  }

  .fleet-panel__list {
    max-height: 176px;
  }
}

:deep(.view-composer__background) {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

:deep(.view-composer__background.street-view-pane--visible) {
  pointer-events: auto;
}

.pre-cache-overlay {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  display: inline-flex;
  align-items: center;
  pointer-events: none;
}

.pre-cache-overlay__text {
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 0.77rem;
  font-weight: 700;
  color: #ffffff;
  padding: 12px 28px;
  border-radius: 8px;
  background: rgba(34, 197, 94, 0.88);
  letter-spacing: 0.02em;
  white-space: nowrap;
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.6);
  animation: scan-pulse 1.2s ease-in-out infinite;
}

.pre-cache-overlay--shake {
  animation: engine-shake 0.08s infinite alternate;
}

.pre-cache-overlay--scan .pre-cache-overlay__text {
  animation: scan-pulse 1.2s ease-in-out infinite;
}

@keyframes engine-shake {
  0%   { transform: translateX(-50%) translate(1px, -1px); }
  25%  { transform: translateX(-50%) translate(-1px, 2px); }
  50%  { transform: translateX(-50%) translate(2px, 0px); }
  75%  { transform: translateX(-50%) translate(-2px, -1px); }
  100% { transform: translateX(-50%) translate(1px, 1px); }
}

@keyframes scan-pulse {
  0%, 100% { opacity: 0.6; }
  50%      { opacity: 1; }
}

.top-center-message {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 100;
  padding: 12px 28px;
  border-radius: 8px;
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 0.77rem;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
  pointer-events: none;
  text-align: center;
  letter-spacing: 0.02em;
}

.top-center-message--warning {
  background: rgba(180, 100, 0, 0.9);
  box-shadow: 0 0 18px rgba(180, 100, 0, 0.6);
  animation: scan-pulse 1.2s ease-in-out infinite;
}

/* Green info reminder (e.g. takeoff clicked above the takeoff altitude). */
.top-center-message--success {
  background: rgba(34, 197, 94, 0.9);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.6);
}

.replay-pill {
  background: rgba(34, 197, 94, 0.88);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.6);
}

/* Login-gate reminder for Screenshot / Screen Recording */
.top-center-message--auth {
  background: rgba(34, 197, 94, 0.92);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.6);
}

.asset-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: rgba(34, 197, 94, 0.88);
  box-shadow: 0 0 18px rgba(34, 197, 94, 0.6);
}

.asset-loading__track {
  width: 240px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.3);
  overflow: hidden;
}

.asset-loading__fill {
  height: 100%;
  border-radius: 3px;
  background: #ffffff;
  transition: width 0.15s linear;
}

/* Splash-clip cover shown while a subpage switch loads and renders the new
   3D assets. Sits above the 3D background (z 0) but below the docks (z 10),
   HUD (z 50) and top-center messages (z 100). */
.switch-video-cover {
  position: fixed;
  inset: 0;
  z-index: 4;
  background: #000000;
  pointer-events: none;
}

.switch-video-cover__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.switch-video-enter-active,
.switch-video-leave-active {
  transition: opacity 0.35s ease;
}

.switch-video-enter-from,
.switch-video-leave-to {
  opacity: 0;
}
</style>
