<script setup>
import { ref, computed, onMounted, onUnmounted, watch, h } from 'vue';
import { useI18n } from 'vue-i18n';
import ViewComposer from '@shared/_ViewComposer.vue';
import TourismObservationPanel from '@shared/TourismObservationPanel.vue';
import StreetViewPane from '@shared/StreetViewPane.vue';
import DockMenuButton from '@shared/DockMenuButton.vue';
import ConnectionError from '@shared/ConnectionError.vue';
import TourismPlanMap from '@shared/TourismPlanMap.vue';
import { useDockRegistry } from '@shared-composables/useDockRegistry.js';
import { prewarmStreetView } from '@/3d_street/streetView.js';
import { usePageRegistry } from '@shared-composables/usePageRegistry.js';
import { useDroneFleet } from '@shared-composables/useDroneFleet.js';
import { useConnectionStatus, checkGoogleConnection } from '@shared-composables/useConnectionStatus.js';

const { t } = useI18n();
const fleet = useDroneFleet();
const { leftItems, registerLeft, clear } = useDockRegistry();
const { pages, registerPage, unregisterPage } = usePageRegistry();
const { googleReady, googleError } = useConnectionStatus();

const viewMode = ref('split');
const mapType = ref('roadmap');
const tourismOpen = ref(true);
const tourismError = ref('');
const tourismSelection = ref(null);
let connectionCheckInterval = null;

const mapViewRef = ref(null); // 引用 MapView 组件

const fleetRows = computed(() => fleet.getRenderStates());
const selected = computed(() => fleet.selectedDrone.value || fleetRows.value[0] || null);
const selectedDroneId = computed(() => fleet.selectedDroneId.value);
const mission = computed(() => fleet.activeMission.value);
// The panel only shows its stop button while isRunning is true. Completed
// tourism missions are kept in fleet.activeMission (completed: true) so the
// final progress stays visible; keeping isRunning true while the mission
// object exists lets the user stop/clear it and start a new observation.
const running = computed(() => Boolean(mission.value));
const tourismPhotos = ref([]);
const tourismPhotoTotal = ref(0);
let currentTourismMissionId = null;
let processedObservationKeys = new Set();

const observationPoints = computed(() => (mission.value?.routes || [])
  .map((route) => route.observation)
  .filter(Boolean));

const capturedPhotoCount = computed(() => tourismPhotos.value.length);

// Tourism Plan style selection list + observation plan shown on the 2D map.
const selectedPlaces = ref([]);

const observationPlan = computed(() => {
  if (!mission.value?.target) return [];
  const target = mission.value.target;
  const points = (mission.value.routes || [])
    .map((route) => route.observation)
    .filter(Boolean)
    .map((o) => ({
      latitude: Number(o.lat),
      longitude: Number(o.lon),
      altitude: Number(o.alt || 60),
      yaw: Number(o.bearingDeg || 0),
    }));
  if (!points.length) return [];
  return [{
    place: {
      name: String(target.name || 'Target'),
      latitude: Number(target.lat),
      longitude: Number(target.lon),
    },
    points,
  }];
});

// Street view preview window + 3D Cesium camera control for the tourism flow.
const streetViewActive = ref(false);
const streetViewPoint = ref({ lat: 0, lon: 0, heading: 0, pitch: 0, altitude: 0 });
const streetViewPaneRef = ref(null);
const streetViewState = ref('idle');
const streetViewFallback = ref('');
const streetViewUnavailable = ref(false);
const activePhotoId = ref(null);
let streetViewFailCount = 0;
let fleetSyncTimer = null;
let streetViewPipe = { stream: null, video: null, canvas: null };
let prewarmTimers = [];

watch(
  () => streetViewPaneRef.value?.state,
  (value) => {
    streetViewState.value = value || 'idle';
  },
);

// When the panorama is unavailable, give the preview a real 3D view of the
// location instead of leaving a black box. Generated once per failure state.
watch(streetViewState, async (value) => {
  if ((value === 'none' || value === 'error') && !streetViewFallback.value) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    let shot = null;
    if (mapViewRef.value && typeof mapViewRef.value.getCleanScreenshot === 'function') {
      try {
        shot = await mapViewRef.value.getCleanScreenshot(
          Number(streetViewPoint.value.lat),
          Number(streetViewPoint.value.lon),
        );
      } catch {
        shot = null;
      }
    }
    if (!shot) shot = captureCesiumViewer();
    if (shot && !(await isBlankDataUrl(shot))) {
      streetViewFallback.value = shot;
    }
  }
});

// Once the Street View backend proves unavailable (e.g. repeated HTTP 503),
// stop attempting street view for the rest of the mission: the preview shows
// the map/3D fallback and captures use the clean map directly.
watch(streetViewUnavailable, (value) => {
  if (value) {
    streetViewState.value = 'error';
  }
});

const mapCenter = computed(() => ({
  lat: selected.value?.lat ?? 31.24,
  lon: selected.value?.lon ?? 121.49,
}));

const mapAlt = computed(() => selected.value?.alt ?? 400);
const showMap = computed(() => viewMode.value !== '3d');
const showConnectionError = computed(() => !googleReady.value);
const connectionMessage = computed(() => googleError.value || 'Cannot connect to Google.');

// --- 任务控制 ---
function startTourism(payload) {
  tourismError.value = '';
  const ok = fleet.startTourismMission(payload.target, {
    radiusM: payload.radiusM,
    minAltM: payload.minAltM,
    photoCount: payload.photoCount,
  });
  if (!ok) {
    tourismError.value = t('multiviewdashboard.start_error');
    return;
  }
  flyToTourismTarget(payload.target);
  flyCesiumToTarget(payload.target, payload.radiusM);
  setStreetViewPoint(payload.target);
  startFleetSync();
  addTourismPlace({
    name: payload.target.name,
    address: payload.target.name,
    latitude: payload.target.lat,
    longitude: payload.target.lon,
  });
  syncMapsTo(payload.target.lat, payload.target.lon);
}

function stopTourism() {
  fleet.stopDemoMission();
}

function onTourismSelect(place) {
  tourismSelection.value = place;
  const lat = Number(place.lat ?? place.latitude);
  const lon = Number(place.lon ?? place.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    addTourismPlace({
      name: place.name,
      address: place.address || place.name,
      latitude: lat,
      longitude: lon,
    });
    syncMapsTo(lat, lon);
  }
}

function addTourismPlace(place) {
  if (!place || !Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return;
  const exists = selectedPlaces.value.some((p) => (
    Math.abs(Number(p.latitude) - Number(place.latitude)) < 1e-6
    && Math.abs(Number(p.longitude) - Number(place.longitude)) < 1e-6
  ));
  if (exists) return;
  selectedPlaces.value.push({
    name: String(place.name || 'Place'),
    address: String(place.address || ''),
    latitude: Number(place.latitude),
    longitude: Number(place.longitude),
  });
}

function removeTourismPlace(index) {
  selectedPlaces.value.splice(index, 1);
}

function clearTourismPlaces() {
  selectedPlaces.value = [];
}

// Click on the 2D map: reverse-geocode and add the place, then sync both maps.
async function onMapPick({ lat, lng }) {
  let name = `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`;
  try {
    const g = window.google?.maps;
    if (g?.Geocoder) {
      const response = await new g.Geocoder().geocode({ location: { lat, lng } });
      if (response?.results?.[0]?.formatted_address) {
        name = response.results[0].formatted_address;
      }
    }
  } catch {
    // keep the coordinate label
  }
  addTourismPlace({ name, address: name, latitude: lat, longitude: lng });
  syncMapsTo(lat, lng);
}

// Fly both the 2D map and the 3D (Cesium) camera to the same location.
function syncMapsTo(lat, lon, zoom = 15) {
  mapViewRef.value?.flyTo?.(Number(lat), Number(lon), zoom);
  flyCesiumToTarget({ lat, lon, alt: 120 }, 180);
}

function formatPhotoTime(timestamp) {
  const date = new Date(timestamp || Date.now());
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function flyMapToObservation(observation) {
  if (!observation || !showMap.value) return;
  // MapView exposes flyTo(lat, lon, zoom) when available; the optional call
  // keeps this view safe on maps that do not implement it yet.
  mapViewRef.value?.flyTo?.(observation.lat, observation.lon, 17);
}

// Mission start sequence: zoom out to the world view first (when the map
// supports flyToWorld), then fly to the chosen tourism target. Falls back to
// a plain flyTo when only that exists, and to no animation when neither does.
function flyToTourismTarget(target) {
  if (!target || !showMap.value || !mapViewRef.value) return;
  const map = mapViewRef.value;
  const hasWorld = typeof map.flyToWorld === 'function';
  const hasFly = typeof map.flyTo === 'function';
  if (!hasWorld && !hasFly) return;
  if (hasWorld) map.flyToWorld();
  if (hasFly) {
    const delay = hasWorld ? 900 : 0;
    window.setTimeout(() => {
      if (showMap.value) {
        map.flyTo(Number(target.lat), Number(target.lon), 17);
      }
    }, delay);
  }
}

// Fly the global 3D (Cesium) camera to the chosen tourism target so the 3D
// map actually jumps to the observation area instead of staying at the fleet
// home positions.
function flyCesiumToTarget(target, radiusM) {
  if (typeof window === 'undefined' || !target) return;
  window.flyFleetCamera?.({
    lat: Number(target.lat),
    lon: Number(target.lon),
    alt: Number(target.alt || 80),
    yaw: 0,
  }, {
    mode: 'top',
    range: Math.max(Number(radiusM || 180) * 2.4, 320),
    duration: 1.4,
  });
}

function flyCesiumToPoint(observation) {
  if (typeof window === 'undefined' || !observation) return;
  window.flyFleetCamera?.({
    lat: Number(observation.lat),
    lon: Number(observation.lon),
    alt: Number(observation.alt || 80),
    yaw: 0,
  }, {
    mode: 'top',
    range: 170,
    duration: 0.9,
  });
}

function setStreetViewPoint(point) {
  if (!point) return;
  streetViewPoint.value = {
    lat: Number(point.lat),
    lon: Number(point.lon),
    heading: Number(point.bearingToCenter ?? 0) * (Math.PI / 180),
    pitch: 0,
    altitude: 0,
  };
  streetViewActive.value = true;
}

// Preload Google Street View tiles for the upcoming observation points so
// the preview and the capture rarely hit a still-loading panorama.
function clearPrewarmTimers() {
  prewarmTimers.forEach((timer) => clearTimeout(timer));
  prewarmTimers = [];
}

function prewarmTourismPoints() {
  clearPrewarmTimers();
  if (streetViewUnavailable.value) return;
  const points = observationPoints.value;
  points.forEach((point, index) => {
    prewarmTimers.push(window.setTimeout(() => {
      prewarmStreetView(Number(point.lat), Number(point.lon));
    }, 600 + index * 1800));
  });
}

// Keep the 3D map's drone entities in sync while a mission is running so the
// simulated drone icons are visible at the target area in the 3D view too.
function syncFleetToCesium() {
  if (typeof window === 'undefined') return;
  window.updateDroneFleet?.(fleet.getRenderStates(), {
    localDroneId: fleet.localDroneId,
    selectedDroneId: fleet.selectedDroneId.value,
  });
}

function startFleetSync() {
  stopFleetSync();
  syncFleetToCesium();
  fleetSyncTimer = window.setInterval(syncFleetToCesium, 300);
}

function stopFleetSync() {
  if (fleetSyncTimer) {
    window.clearInterval(fleetSyncTimer);
    fleetSyncTimer = null;
  }
}

function teardownStreetViewPipe() {
  if (streetViewPipe.video) {
    streetViewPipe.video.pause();
    streetViewPipe.video.srcObject = null;
    streetViewPipe.video.remove();
  }
  if (streetViewPipe.stream) {
    streetViewPipe.stream.getTracks().forEach((track) => track.stop());
  }
  streetViewPipe = { stream: null, video: null, canvas: null };
}

// Keep one captureStream pipe attached to the street view canvas. The video
// element holds the last PRESENTED frame, which is the only reliable way to
// read a WebGL canvas that is cleared outside its render cycle.
function ensureStreetViewPipe() {
  const container = document.querySelector('.street-view-window__pane .street-view-container');
  if (!container) return null;
  let best = null;
  for (const canvas of container.querySelectorAll('canvas')) {
    if (canvas.width > 0 && canvas.height > 0 && (!best || canvas.width * canvas.height > best.width * best.height)) {
      best = canvas;
    }
  }
  if (!best || typeof best.captureStream !== 'function') return null;
  if (streetViewPipe.canvas === best) return streetViewPipe;
  teardownStreetViewPipe();
  const stream = best.captureStream(30);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  video.play().catch(() => {});
  streetViewPipe = { stream, video, canvas: best };
  return streetViewPipe;
}

// Read the Google Street View panorama rendered by StreetViewPane. Google's
// panorama is a WebGL canvas without preserveDrawingBuffer, so direct reads
// yield a cleared (black) buffer. Instead: wait for the panorama to be OK at
// the current position, force at least one render (resize + small POV nudge),
// then snapshot the last frame presented through the captureStream pipe.
// Returns null on failure so the caller can fall back to map/3D/placeholder.
async function captureStreetViewImage() {
  try {
    const pane = streetViewPaneRef.value?.streetView;
    const pano = pane?.panorama;
    if (!pano) return null;
    // Fail fast when the panorama is already known to be missing/broken.
    const paneState = streetViewPaneRef.value?.state;
    if (paneState === 'none' || paneState === 'error') return null;
    const pipe = ensureStreetViewPipe();
    if (!pipe) return null;

    // Wait up to 12s for the panorama at the current position, nudging the
    // POV periodically so a fresh render reaches the captureStream pipe.
    let statusOk = false;
    const startedAt = Date.now();
    while (!statusOk && Date.now() - startedAt < 12000) {
      try {
        statusOk = typeof pano.getStatus === 'function' && pano.getStatus() === 'OK';
      } catch {
        statusOk = false;
      }
      if (!statusOk) {
        try {
          const pov = pano.getPov();
          pano.setPov({ heading: pov.heading + 0.3, pitch: pov.pitch });
          pano.setPov({ heading: pov.heading, pitch: pov.pitch });
        } catch {
          // best-effort
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    if (!statusOk) return null;

    // Let the newly fetched panorama tiles settle before sampling, then keep
    // nudging renders until a FULLY PAINTED (non-blank) frame is available.
    // This waits for the panorama to actually finish loading instead of
    // capturing a still-blank canvas.
    await new Promise((resolve) => setTimeout(resolve, 800));
    for (let cycle = 0; cycle < 6; cycle += 1) {
      try {
        pane.setVisible(true);
      } catch {
        // best-effort resize trigger
      }
      try {
        const pov = pano.getPov();
        pano.setPov({ heading: pov.heading + 0.8, pitch: pov.pitch });
      } catch {
        // best-effort
      }
      await new Promise((resolve) => setTimeout(resolve, 550));
      try {
        const pov = pano.getPov();
        pano.setPov({ heading: pov.heading - 0.8, pitch: pov.pitch });
      } catch {
        // best-effort
      }
      await new Promise((resolve) => setTimeout(resolve, 550));
      if (pipe.video.readyState >= 2 && pipe.video.videoWidth > 0) {
        const shot = document.createElement('canvas');
        shot.width = pipe.video.videoWidth;
        shot.height = pipe.video.videoHeight;
        const ctx = shot.getContext('2d');
        if (ctx) {
          ctx.drawImage(pipe.video, 0, 0);
          const dataUrl = shot.toDataURL('image/png');
          if (!(await isBlankDataUrl(dataUrl))) {
            return dataUrl;
          }
        }
      }
    }
    return null;
  } catch (error) {
    console.warn('[MultiViewDashboard] Street View capture failed.', error);
    return null;
  }
}

// Reject near-blank screenshots (e.g. a cleared WebGL buffer that still
// produced a valid data URL) so the gallery never shows black placeholders.
function isBlankDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl) {
      resolve(true);
      return;
    }
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(true);
            return;
          }
          ctx.drawImage(img, 0, 0);
          const step = Math.max(4, Math.floor(Math.max(img.width, img.height) / 24));
          let min = 255;
          let max = 0;
          let count = 0;
          for (let y = 0; y < img.height; y += step) {
            for (let x = 0; x < img.width; x += step) {
              const d = ctx.getImageData(x, y, 1, 1).data;
              const lum = 0.299 * d[0] + 0.587 * d[1] + 0.114 * d[2];
              if (lum < min) min = lum;
              if (lum > max) max = lum;
              count += 1;
            }
          }
          resolve(count === 0 || max - min < 3);
        } catch {
          resolve(true);
        }
      };
      img.onerror = () => resolve(true);
      img.src = dataUrl;
    } catch {
      resolve(true);
    }
  });
}

function captureCesiumViewer() {
  try {
    const viewer = typeof window !== 'undefined' ? window.cesiumViewer : null;
    if (!viewer || !viewer.canvas || !viewer.canvas.width) return null;
    viewer.render();
    viewer.render(); // second pass for a fresh drawing buffer
    return viewer.canvas.toDataURL('image/png');
  } catch (error) {
    console.warn('[MultiViewDashboard] Cesium canvas is not readable.', error);
    return null;
  }
}

// Google Maps renders into a WebGL canvas, which is usually tainted by
// cross-origin tiles and cannot be read back. Capture what we can and fall
// back to a synthetic observation photo so the auto-screenshot always works.
function tryCaptureMapContainer() {
  try {
    const container = document.querySelector('.multiview-map-panel .tourism-plan-map__canvas')
      || document.querySelector('.multiview-map .map-container');
    const canvas = container?.querySelector('canvas');
    if (!canvas || !canvas.width || !canvas.height) return null;
    const shot = document.createElement('canvas');
    shot.width = canvas.width;
    shot.height = canvas.height;
    const ctx = shot.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    return shot.toDataURL('image/png');
  } catch (error) {
    console.warn('[MultiViewDashboard] Map canvas is not readable; using a synthetic observation photo.', error);
    return null;
  }
}

function makeSyntheticPhoto(observation) {
  const width = 480;
  const height = 300;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#0c2233');
  bg.addColorStop(0.55, '#12303f');
  bg.addColorStop(1, '#07131d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = 'rgba(99, 230, 190, 0.14)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  const cx = width - 128;
  const cy = height / 2;
  ctx.strokeStyle = 'rgba(83, 183, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, 34, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 44, cy);
  ctx.lineTo(cx + 44, cy);
  ctx.moveTo(cx, cy - 44);
  ctx.lineTo(cx, cy + 44);
  ctx.stroke();
  ctx.fillStyle = '#ffd166';
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(109, 199, 232, 0.85)';
  ctx.font = '700 15px "Segoe UI", Calibri, sans-serif';
  ctx.fillText('TOURISM OBSERVATION', 24, 38);
  ctx.fillStyle = '#e8f7ff';
  ctx.font = '700 30px "Segoe UI", Calibri, sans-serif';
  ctx.fillText(String(observation.label || 'Point'), 24, 76);
  ctx.fillStyle = 'rgba(239, 248, 255, 0.92)';
  ctx.font = '500 16px "Segoe UI", Calibri, sans-serif';
  ctx.fillText(`${Number(observation.lat).toFixed(5)}, ${Number(observation.lon).toFixed(5)}`, 24, 112);
  ctx.fillStyle = 'rgba(99, 230, 190, 0.95)';
  ctx.fillText(`ALT ${Math.round(Number(observation.alt) || 0)} m`, 24, 142);
  ctx.fillStyle = 'rgba(206, 228, 242, 0.62)';
  ctx.font = '500 13px "Segoe UI", Calibri, sans-serif';
  ctx.fillText(formatPhotoTime(observation.at || Date.now()), 24, 172);
  ctx.fillText('SIMULATED CAPTURE', 24, 194);

  return canvas.toDataURL('image/png');
}

async function captureTourismPhoto(observation) {
  // Priority: street view panorama -> clean 2D map view -> 3D viewer ->
  // synthetic. The clean map capture hides the planning arrows so photos are
  // never full of overlay markers.
  let real = null;
  const reasons = [];
  if (!streetViewUnavailable.value) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    real = await captureStreetViewImage();
    if (!real) {
      // Preload this exact point and retry once — loading failures are often
      // just a slow panorama fetch.
      reasons.push('streetview-unavailable');
      prewarmStreetView(Number(observation.lat), Number(observation.lon));
      await new Promise((resolve) => setTimeout(resolve, 1800));
      real = await captureStreetViewImage();
    }
    if (real) {
      streetViewFailCount = 0;
      streetViewUnavailable.value = false;
    } else {
      streetViewFailCount += 1;
      if (streetViewFailCount >= 2) {
        streetViewUnavailable.value = true;
        reasons.push('streetview-service-down');
      }
    }
  } else {
    reasons.push('streetview-skipped');
  }
  if (real && (await isBlankDataUrl(real))) real = null;
  if (!real) {
    reasons.push('streetview-blank');
    if (mapViewRef.value && typeof mapViewRef.value.getCleanScreenshot === 'function') {
      try {
        real = await mapViewRef.value.getCleanScreenshot(
          Number(observation.lat),
          Number(observation.lon),
        );
        if (real && (await isBlankDataUrl(real))) real = null;
      } catch (error) {
        console.warn('[MultiViewDashboard] Clean map screenshot failed.', error);
        real = null;
      }
    }
  }
  if (!real) {
    reasons.push('map-blank');
    // Let the 3D camera settle at this observation point before sampling.
    await new Promise((resolve) => setTimeout(resolve, 700));
    real = captureCesiumViewer();
  }
  if (real && (await isBlankDataUrl(real))) real = null;
  if (!real) reasons.push('all-failed');
  if (reasons.length) {
    console.info(`[MultiViewDashboard] photo fallback for ${observation.label || observation.routeId}: ${reasons.join(' > ')}`);
  }
  return {
    id: `photo-${observation.routeId || observation.observationId || Date.now().toString(36)}`,
    label: observation.label || 'Point',
    lat: Number(observation.lat),
    lon: Number(observation.lon),
    alt: Number(observation.alt) || 0,
    at: observation.at || Date.now(),
    headingDeg: Number(observation.bearingToCenter ?? 0),
    dataUrl: real || makeSyntheticPhoto(observation),
    synthetic: !real,
  };
}

async function handleObservationCaptured(observation) {
  flyMapToObservation(observation);
  flyCesiumToPoint(observation);
  setStreetViewPoint(observation);
  const photo = await captureTourismPhoto(observation);
  tourismPhotos.value.push(photo);
  streetViewFallback.value = photo.dataUrl;
}

// Clicking a captured photo switches the street view preview (and both maps)
// to that observation point.
function onPhotoClick(photo) {
  if (!photo) return;
  activePhotoId.value = photo.id;
  setStreetViewPoint({
    lat: Number(photo.lat),
    lon: Number(photo.lon),
    bearingToCenter: Number(photo.headingDeg || 0),
  });
  streetViewActive.value = true;
  streetViewFallback.value = photo.dataUrl;
  syncMapsTo(Number(photo.lat), Number(photo.lon), 16);
}

watch(
  () => mission.value?.id,
  (id) => {
    if (!id) {
      stopFleetSync();
      return;
    }
    if (id === currentTourismMissionId) return;
    currentTourismMissionId = id;
    processedObservationKeys = new Set();
    tourismPhotos.value = [];
    tourismPhotoTotal.value = observationPoints.value.length || mission.value?.photoCount || 0;
    streetViewFallback.value = '';
    streetViewState.value = 'idle';
    streetViewUnavailable.value = false;
    streetViewFailCount = 0;
    activePhotoId.value = null;
    startFleetSync();
    prewarmTourismPoints();
  },
);

watch(
  () => (mission.value?.observations || []).map((item) => item.routeId || '').join('|'),
  async () => {
    const observations = mission.value?.observations || [];
    for (const observation of observations) {
      const key = observation.routeId;
      if (!key || processedObservationKeys.has(key)) continue;
      processedObservationKeys.add(key);
      await handleObservationCaptured(observation);
    }
  },
);

function setViewMode(mode) {
  viewMode.value = mode;
}

function toggleMapType() {
  mapType.value = mapType.value === 'roadmap' ? 'satellite' : 'roadmap';
}

function onDroneSelect(id) {
  fleet.selectDrone(id);
}

let centerSyncTimer = null;
// User pans/zooms the 2D map -> fly the 3D Cesium camera to the same center
// so both maps stay in sync (throttled to avoid camera fights while dragging).
function onMapCenterChange(center) {
  if (!center || !Number.isFinite(Number(center.lat)) || !Number.isFinite(Number(center.lng))) return;
  if (centerSyncTimer) clearTimeout(centerSyncTimer);
  centerSyncTimer = setTimeout(() => {
    window.flyFleetCamera?.(
      { lat: Number(center.lat), lon: Number(center.lng), alt: 120, yaw: 0 },
      { mode: 'top', range: 420, duration: 0.7 },
    );
  }, 400);
}
function onMapZoomChange() {}
function onPoisFound() {}
function onPoisError() {}
function onRouteFound() {}
function onRouteError() {}

watch(tourismOpen, (open) => {
  const item = leftItems.find((entry) => entry.id === 'tourism');
  if (item) item.active = open;
});

onMounted(() => {
  fleet.setDemoEnabled(true, { seedCount: 3 });
  if (!fleetRows.value.some((drone) => !drone.local)) {
    for (let i = 0; i < 3; i += 1) fleet.addDrone();
  }
  checkGoogleConnection();
  connectionCheckInterval = setInterval(checkGoogleConnection, 10000);

  registerPage({ id: 'aerial', nameKey: 'aerialview.page_aerial', route: '/' });
  registerPage({ id: 'map', nameKey: 'aerialview.page_map', route: '/map' });
  registerPage({ id: 'multiview', nameKey: 'multiviewdashboard.page_multiview', route: '/multiview' });
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
    }),
  });
  registerLeft({
    id: 'map-type',
    icon: mapType.value === 'roadmap' ? 'MENU_MAP' : 'MENU_SATELLITE',
    titleKey: 'multiviewdashboard.map_type',
    onClick: toggleMapType,
  });
  registerLeft({
    id: 'tourism',
    icon: 'MENU_PHOTO',
    titleKey: 'multiviewdashboard.tourism',
    active: tourismOpen.value,
    onClick: () => {
      tourismOpen.value = !tourismOpen.value;
    },
  });
});

onUnmounted(() => {
  if (connectionCheckInterval) clearInterval(connectionCheckInterval);
  stopFleetSync();
  teardownStreetViewPipe();
  clearPrewarmTimers();
  clear();
  unregisterPage('aerial');
  unregisterPage('map');
  unregisterPage('realdrone');
  unregisterPage('extensions');
  unregisterPage('chat');
  unregisterPage('myspace');
});
</script>

<template>
  <ViewComposer
    :left-items="leftItems"
    :right-items="[]"
    :show-flight="false"
    :show-camera="false"
    :show-hud="false"
    :flight="{ mode: '-', vx: 0, vy: 0, yaw: 0, vz: 0 }"
    :camera="{ mode: '-', yaw: 0, pitch: 0, roll: 0 }"
  >
    <template #top-overlay>
      <div class="multiview-mode-bar">
        <button
          type="button"
          :class="{ 'multiview-mode-bar__btn--active': viewMode === '3d' }"
          @click="setViewMode('3d')"
        >
          {{ t('multiviewdashboard.mode_3d') }}
        </button>
        <button
          type="button"
          :class="{ 'multiview-mode-bar__btn--active': viewMode === '2d' }"
          @click="setViewMode('2d')"
        >
          {{ t('multiviewdashboard.mode_2d') }}
        </button>
        <button
          type="button"
          :class="{ 'multiview-mode-bar__btn--active': viewMode === 'split' }"
          @click="setViewMode('split')"
        >
          {{ t('multiviewdashboard.mode_split') }}
        </button>
      </div>

      <ConnectionError :visible="showConnectionError" :message="connectionMessage" />

      <TourismObservationPanel
        :open="tourismOpen"
        :mission="mission"
        :error="tourismError"
        :is-running="running"
        :photos="tourismPhotos"
        @close="tourismOpen = false"
        @start="startTourism"
        @stop="stopTourism"
        @select="onTourismSelect"
      />

      <div v-if="streetViewActive" class="street-view-window">
        <div class="street-view-window__bar">
          <span>{{ t('multiviewdashboard.street_view') }}</span>
          <small v-if="streetViewPoint.lat">
            {{ streetViewPoint.lat.toFixed(5) }}, {{ streetViewPoint.lon.toFixed(5) }}
          </small>
        </div>
        <StreetViewPane
          ref="streetViewPaneRef"
          class="street-view-window__pane"
          :lat="streetViewPoint.lat"
          :lon="streetViewPoint.lon"
          :heading="streetViewPoint.heading"
          :pitch="streetViewPoint.pitch"
          :altitude="streetViewPoint.altitude"
          :visible="true"
          :prewarm="true"
        />
        <img
          v-if="streetViewState !== 'ok' && streetViewFallback"
          :src="streetViewFallback"
          class="street-view-window__fallback"
          alt=""
        >
      </div>

      <div v-if="tourismPhotos.length" class="tourism-photos">
        <div class="tourism-photos__head">
          <span>{{ t('multiviewdashboard.photos_taken') }}</span>
          <div class="tourism-photos__meta">
            <b>{{ capturedPhotoCount }} / {{ tourismPhotoTotal }}</b>
            <span v-if="mission?.completed" class="tourism-photos__done">
              {{ t('multiviewdashboard.mission_completed') }}
            </span>
          </div>
        </div>
        <div class="tourism-photos__grid">
          <figure
            v-for="photo in tourismPhotos"
            :key="photo.id"
            class="tourism-photos__item"
            :class="{ 'tourism-photos__item--active': photo.id === activePhotoId }"
            @click="onPhotoClick(photo)"
          >
            <img :src="photo.dataUrl" :alt="photo.label">
            <span v-if="photo.synthetic" class="tourism-photos__badge">SIM</span>
            <figcaption>{{ photo.label }} · {{ formatPhotoTime(photo.at) }}</figcaption>
          </figure>
        </div>
      </div>

      <div v-if="selectedPlaces.length" class="tourism-places">
        <div class="tourism-places__head">
          <span>{{ t('multiviewdashboard.places_selected') }}</span>
          <button type="button" class="tourism-places__clear" @click="clearTourismPlaces">
            {{ t('multiviewdashboard.places_clear') }}
          </button>
        </div>
        <ul class="tourism-places__list">
          <li v-for="(place, index) in selectedPlaces" :key="`${place.latitude}-${place.longitude}`">
            <b>{{ index + 1 }}.</b>
            <span class="tourism-places__name">{{ place.name }}</span>
            <button type="button" class="tourism-places__remove" @click="removeTourismPlace(index)">&times;</button>
          </li>
        </ul>
      </div>
    </template>

    <template #background>
      <div class="multiview-root">
        <div
          v-if="showMap"
          class="multiview-map-panel"
          :class="{
            'multiview-map-panel--full': viewMode === '2d',
            'multiview-map-panel--split': viewMode === 'split',
          }"
        >
          <TourismPlanMap
            ref="mapViewRef"
            class="multiview-map"
            :selected-places="selectedPlaces"
            :observation-plan="observationPlan"
            @mapPick="onMapPick"
            @centerChange="onMapCenterChange"
          />
        </div>
      </div>
    </template>
  </ViewComposer>
</template>

<style scoped>
.multiview-root {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.multiview-map-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 6;
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.32);
  background: #0b1620;
  box-shadow: -18px 0 46px rgba(0, 0, 0, 0.35);
  pointer-events: auto;
  transition: width 220ms ease;
}

.multiview-map-panel--split {
  width: 44%;
}

.multiview-map-panel--full {
  width: 100%;
  border-left: 0;
}

.multiview-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.tourism-photos {
  position: fixed;
  left: 86px;
  bottom: 18px;
  z-index: 68;
  width: min(360px, calc(100vw - 110px));
  padding: 10px;
  border: 1px solid rgba(83, 183, 255, 0.32);
  border-radius: 8px;
  background: rgba(5, 16, 27, 0.82);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  color: rgba(239, 248, 255, 0.9);
  font-family: 'Calibri', 'Segoe UI', sans-serif;
}

.tourism-photos__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.tourism-photos__head span {
  color: rgba(206, 228, 242, 0.68);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
}

.tourism-photos__head b {
  color: #63e6be;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
}

.tourism-photos__meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tourism-photos__done {
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.18);
  color: #a7f3d0;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.tourism-photos__grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  max-height: 168px;
  overflow-y: auto;
}

.tourism-photos__item {
  position: relative;
  margin: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.tourism-photos__item:hover {
  border-color: rgba(83, 183, 255, 0.65);
  transform: translateY(-1px);
}

.tourism-photos__item--active {
  border-color: #63e6be;
  box-shadow: 0 0 0 2px rgba(99, 230, 190, 0.35);
}

.tourism-photos__item img {
  display: block;
  width: 100%;
  height: 58px;
  object-fit: cover;
}

.tourism-photos__item figcaption {
  padding: 4px 6px;
  color: rgba(206, 228, 242, 0.72);
  font-size: 0.58rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tourism-photos__badge {
  position: absolute;
  top: 4px;
  right: 4px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(5, 16, 27, 0.7);
  color: #ffd166;
  font-size: 0.52rem;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.tourism-places {
  position: fixed;
  left: 86px;
  bottom: 250px;
  z-index: 67;
  width: min(320px, calc(100vw - 110px));
  padding: 10px;
  border: 1px solid rgba(83, 183, 255, 0.32);
  border-radius: 8px;
  background: rgba(5, 16, 27, 0.82);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.35);
  backdrop-filter: blur(12px);
  color: rgba(239, 248, 255, 0.9);
  font-family: 'Calibri', 'Segoe UI', sans-serif;
}

.tourism-places__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.tourism-places__head span {
  color: rgba(206, 228, 242, 0.68);
  font-size: 0.64rem;
  letter-spacing: 0.06em;
}

.tourism-places__clear {
  border: 0;
  background: transparent;
  color: #fca5a5;
  font-size: 0.62rem;
  cursor: pointer;
}

.tourism-places__list {
  display: grid;
  gap: 2px;
  max-height: 110px;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.tourism-places__list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 5px;
}

.tourism-places__list li:hover {
  background: rgba(83, 183, 255, 0.12);
}

.tourism-places__list b {
  color: #63e6be;
  font-size: 0.66rem;
  font-variant-numeric: tabular-nums;
}

.tourism-places__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tourism-places__remove {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: rgba(252, 165, 165, 0.75);
  font-size: 0.9rem;
  line-height: 1;
  cursor: pointer;
}

.street-view-window {
  position: fixed;
  top: 76px;
  right: 18px;
  z-index: 66;
  width: min(480px, 40vw);
  height: 315px;
  overflow: hidden;
  border: 1px solid rgba(83, 183, 255, 0.38);
  border-radius: 8px;
  background: #0b1620;
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.42);
}

.street-view-window__bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(5, 16, 27, 0.72);
  color: rgba(239, 248, 255, 0.92);
  font-family: 'Calibri', 'Segoe UI', sans-serif;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  backdrop-filter: blur(8px);
}

.street-view-window__bar small {
  color: rgba(206, 228, 242, 0.62);
  font-size: 0.6rem;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.street-view-window__pane {
  position: absolute;
  inset: 0;
}

.street-view-window__fallback {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #0b1620;
}

.multiview-mode-bar {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 90;
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 9px;
  background: rgba(5, 16, 27, 0.82);
  backdrop-filter: blur(12px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
}

.multiview-mode-bar button {
  min-width: 82px;
  height: 30px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgba(239, 248, 255, 0.78);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.multiview-mode-bar button:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.08);
}

.multiview-mode-bar .multiview-mode-bar__btn--active {
  color: #06202b;
  background: #53b7ff;
}

@media (max-width: 768px) {
  .multiview-map-panel--split {
    width: 58%;
  }

  .tourism-photos {
    left: 70px;
    bottom: 12px;
    width: min(300px, calc(100vw - 90px));
  }

  .tourism-places {
    left: 70px;
    bottom: 235px;
    width: min(300px, calc(100vw - 90px));
  }

  .street-view-window {
    top: 64px;
    right: 10px;
    width: min(360px, 52vw);
    height: 240px;
  }

  .multiview-mode-bar {
    top: 12px;
  }

  .multiview-mode-bar button {
    min-width: 0;
    padding: 0 9px;
  }
}
</style>
