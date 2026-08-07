<template>
  <div class="tourism-plan-map">
    <div ref="mapEl" class="tourism-plan-map__canvas"></div>
    <div ref="cleanMapEl" class="tourism-plan-map__clean" aria-hidden="true"></div>
  </div>
</template>

<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { loadGoogleMaps } from '@/2d_map/googleMaps.js';

// The Tourism Plan map, ported into the Tourism Observer 2D panel: click to
// add a place, numbered pins for selected places, directional arrows for the
// observation plan with dashed connector lines, and fitBounds on plan.

const props = defineProps({
  selectedPlaces: { type: Array, default: () => [] },
  observationPlan: { type: Array, default: () => [] },
});

const emit = defineEmits(['mapPick', 'centerChange']);

const mapEl = ref(null);
const cleanMapEl = ref(null);
let map = null;
let cleanMap = null;
let markers = [];
let observationMarkers = [];
let polylines = [];
let lastProgrammaticCenter = null;

function clearAllMarkers() {
  markers.forEach((m) => m.setMap(null));
  markers = [];
}

function clearObservationMarkers() {
  observationMarkers.forEach((m) => m.setMap(null));
  observationMarkers = [];
  polylines.forEach((p) => p.setMap(null));
  polylines = [];
}

function updateMapMarkers() {
  if (!map) return;
  const g = window.google;
  clearAllMarkers();
  (props.selectedPlaces || []).forEach((p, i) => {
    const lat = Number(p.latitude ?? p.lat);
    const lng = Number(p.longitude ?? p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const m = new g.maps.Marker({
      position: { lat, lng },
      map,
      label: `${i + 1}`,
      title: String(p.name || `Place ${i + 1}`),
      animation: g.maps.Animation.DROP,
    });
    markers.push(m);
  });
}

function showObservationPoints() {
  if (!map) return;
  const g = window.google;
  clearObservationMarkers();
  const bounds = new g.maps.LatLngBounds();
  (props.observationPlan || []).forEach((group) => {
    const place = group?.place || {};
    const placeLat = Number(place.latitude ?? place.lat);
    const placeLng = Number(place.longitude ?? place.lon);
    const hasPlace = Number.isFinite(placeLat) && Number.isFinite(placeLng);
    if (hasPlace) {
      new g.maps.Marker({
        position: { lat: placeLat, lng: placeLng },
        map,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#e74c3c',
          fillOpacity: 0.8,
          strokeColor: '#fff',
          strokeWeight: 2,
        },
        title: String(place.name || 'Target'),
      });
      bounds.extend({ lat: placeLat, lng: placeLng });
    }
    (group?.points || []).forEach((op) => {
      const lat = Number(op.latitude);
      const lng = Number(op.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const isTop = Number(op.altitude) >= 100;
      const m = new g.maps.Marker({
        position: { lat, lng },
        map,
        icon: {
          path: g.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          scale: 5,
          fillColor: isTop ? '#3498db' : '#2ecc71',
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 2,
          rotation: Number(op.yaw) || 0,
        },
        title: `${isTop ? 'Top' : 'Observation'} - ${Math.round(Number(op.altitude))}m`,
      });
      observationMarkers.push(m);
      bounds.extend({ lat, lng });
      if (hasPlace) {
        const line = new g.maps.Polyline({
          path: [
            { lat: placeLat, lng: placeLng },
            { lat, lng },
          ],
          map,
          geodesic: true,
          strokeColor: isTop ? '#3498db' : '#2ecc71',
          strokeOpacity: 0.4,
          strokeWeight: 1,
          icons: [
            {
              icon: { path: g.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2 },
              offset: '100%',
            },
          ],
        });
        polylines.push(line);
      }
    });
  });
  if ((props.observationPlan || []).length && !bounds.isEmpty()) {
    map.fitBounds(bounds, { top: 60, right: 48, bottom: 56, left: 48 });
  }
}

function initMap() {
  const g = window.google;
  if (!g?.maps) return;
  map = new g.maps.Map(mapEl.value, {
    center: { lat: 31.2304, lng: 121.4737 },
    zoom: 12,
    disableDefaultUI: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
  });

  map.addListener('click', (e) => {
    emit('mapPick', { lat: e.latLng.lat(), lng: e.latLng.lng() });
  });

  // User-initiated pans are reported so the host can sync the 3D camera;
  // programmatic flyTo calls are guarded so they are not echoed back.
  map.addListener('center_changed', () => {
    if (!map) return;
    const center = map.getCenter();
    if (!center) return;
    const position = { lat: center.lat(), lng: center.lng() };
    if (
      lastProgrammaticCenter
      && Math.abs(lastProgrammaticCenter.lat - position.lat) < 1e-7
      && Math.abs(lastProgrammaticCenter.lng - position.lng) < 1e-7
    ) {
      lastProgrammaticCenter = null;
      return;
    }
    lastProgrammaticCenter = null;
    emit('centerChange', position);
  });

  updateMapMarkers();
  showObservationPoints();
}

onMounted(async () => {
  try {
    await loadGoogleMaps();
    initMap();
  } catch (e) {
    console.error('[TourismPlanMap]', e);
  }
});

onBeforeUnmount(() => {
  clearAllMarkers();
  clearObservationMarkers();
  map = null;
});

watch(() => props.selectedPlaces, updateMapMarkers, { deep: true });
watch(() => props.observationPlan, showObservationPoints, { deep: true });

function flyTo(lat, lng, zoom = 15) {
  if (!map) return false;
  const position = { lat: Number(lat), lng: Number(lng) };
  lastProgrammaticCenter = position;
  map.panTo(position);
  map.setZoom(zoom);
  return true;
}

function flyToWorld() {
  if (!map) return false;
  map.setZoom(3);
  return true;
}

function getScreenshot() {
  if (!map || !mapEl.value) return null;
  try {
    let best = null;
    for (const canvas of mapEl.value.querySelectorAll('canvas')) {
      if (canvas.width > 0 && canvas.height > 0 && (!best || canvas.width * canvas.height > best.width * best.height)) {
        best = canvas;
      }
    }
    if (!best) return null;
    const shot = document.createElement('canvas');
    shot.width = best.width;
    shot.height = best.height;
    const ctx = shot.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(best, 0, 0);
    return shot.toDataURL('image/png');
  } catch (error) {
    console.warn('[TourismPlanMap] Map canvas is not readable for screenshots.', error);
    return null;
  }
}

function waitForMapIdle(targetMap, timeoutMs) {
  return new Promise((resolve) => {
    let listener = null;
    let finished = false;
    const g = window.google;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (listener && g?.maps?.event?.removeListener) {
        g.maps.event.removeListener(listener);
      }
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs || 2500);
    if (g?.maps?.event) {
      listener = g.maps.event.addListenerOnce(targetMap, 'idle', finish);
    } else {
      setTimeout(finish, 400);
    }
  });
}

// A clean map capture for photo fallbacks: a SEPARATE Google Map instance
// that never receives any pins/arrows, so the screenshot can never contain
// the planning overlay. It is created off-screen at a photo-friendly size and
// reused; each shot waits for the map to finish rendering (idle).
async function getCleanScreenshot(lat, lng, zoom = 15) {
  const g = window.google;
  // The template ref is preferred, but fall back to a direct DOM lookup so
  // the clean capture works even if the ref binding is unavailable.
  const container = cleanMapEl.value || document.querySelector('.tourism-plan-map__clean');
  if (!g?.maps?.Map || !container) return null;
  try {
    if (!cleanMap) {
      cleanMap = new g.maps.Map(container, {
        center: { lat: Number(lat), lng: Number(lng) },
        zoom,
        disableDefaultUI: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        gestureHandling: 'none',
        keyboardShortcuts: false,
      });
      g.maps.event.trigger(cleanMap, 'resize');
    } else {
      cleanMap.setCenter({ lat: Number(lat), lng: Number(lng) });
      cleanMap.setZoom(zoom);
    }
    await waitForMapIdle(cleanMap, 2500);
    let best = null;
    for (const canvas of container.querySelectorAll('canvas')) {
      if (canvas.width > 0 && canvas.height > 0 && (!best || canvas.width * canvas.height > best.width * best.height)) {
        best = canvas;
      }
    }
    if (best) {
      const shot = document.createElement('canvas');
      shot.width = best.width;
      shot.height = best.height;
      const ctx = shot.getContext('2d');
      if (ctx) {
        ctx.drawImage(best, 0, 0);
        return shot.toDataURL('image/png');
      }
    }
    // Some environments render the second map as raster <img> tiles instead
    // of a WebGL canvas (no canvas available). Composite the tiles back into
    // a flat image so the fallback still produces a real map picture.
    return compositeTileImages(container);
  } catch (error) {
    console.warn('[TourismPlanMap] Clean map screenshot failed.', error);
    return null;
  }
}

function compositeTileImages(container) {
  if (!container) return null;
  const base = container.getBoundingClientRect();
  if (!base.width || !base.height) return null;
  const out = document.createElement('canvas');
  out.width = Math.round(base.width);
  out.height = Math.round(base.height);
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#e5e3df';
  ctx.fillRect(0, 0, out.width, out.height);
  let painted = 0;
  for (const img of container.querySelectorAll('img')) {
    if (!img.naturalWidth || img.naturalWidth < 64) continue;
    const rect = img.getBoundingClientRect();
    try {
      ctx.drawImage(img, rect.left - base.left, rect.top - base.top, rect.width, rect.height);
      painted += 1;
    } catch {
      // skip unreadable tiles
    }
  }
  if (!painted) return null;
  return out.toDataURL('image/png');
}

defineExpose({ flyTo, flyToWorld, getScreenshot, getCleanScreenshot });
</script>

<style scoped>
.tourism-plan-map {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #0b0b0b;
}

.tourism-plan-map__canvas {
  width: 100%;
  height: 100%;
}

.tourism-plan-map__clean {
  position: fixed;
  right: 0;
  bottom: 0;
  width: 640px;
  height: 400px;
  pointer-events: none;
  opacity: 0;
  z-index: 0;
}
</style>

