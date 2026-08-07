<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import {
  createStreetView,
  altitudeToStreetViewZoom,
  altitudeToStreetViewPitchOffset,
} from '@/3d_street/streetView.js';

const props = defineProps({
  lat: { type: Number, default: 0 },
  lon: { type: Number, default: 0 },
  heading: { type: Number, default: 0 }, // radians, Cesium convention
  pitch: { type: Number, default: 0 },   // radians, Cesium convention
  altitude: { type: Number, default: 0 }, // meters above surface
  visible: { type: Boolean, default: false },
  prewarm: { type: Boolean, default: false },
});

const containerRef = ref(null);
const streetView = ref(null);
const error = ref(null);
const isReady = ref(false);
const state = ref('idle'); // idle | loading | ok | none | error
let retryTimer = null;
let retryKey = '';
let loadingTimer = null;
let retryCount = 0;

// The exact target point often has no panorama (museum grounds, squares,
// parks), while nearby streets do. Ask the Street View service for the
// nearest panorama within a generous radius and move the view there.
async function moveToNearestPano(lat, lon) {
  const g = window.google;
  if (!streetView.value) return;
  if (!g?.maps?.StreetViewService) {
    streetView.value.setPosition(lat, lon);
    return;
  }
  try {
    const service = new g.maps.StreetViewService();
    const data = await new Promise((resolve, reject) => {
      service.getPanorama(
        { location: { lat, lng: lon }, radius: 300 },
        (result, status) => {
          if (status === 'OK' && result) resolve(result);
          else reject(status);
        },
      );
    });
    const found = data?.location?.latLng;
    if (found) {
      streetView.value.setPosition(found.lat(), found.lng());
    } else {
      streetView.value.setPosition(lat, lon);
    }
  } catch {
    streetView.value.setPosition(lat, lon);
  }
}

const emit = defineEmits(['ready']);

async function initStreetView() {
  if (!containerRef.value || streetView.value) return;
  try {
    state.value = 'loading';
    startLoadingTimeout();
    streetView.value = await createStreetView(containerRef.value, {
      lat: props.lat,
      lon: props.lon,
      heading: props.heading,
      pitch: props.pitch,
      zoom: altitudeToStreetViewZoom(props.altitude),
    });
    // Listen for panorama tiles loaded
    streetView.value.panorama.addListener('status_changed', () => {
      let status = '';
      try {
        status = streetView.value.panorama.getStatus();
      } catch {
        status = '';
      }
      if (status === 'OK') {
        state.value = 'ok';
        retryCount = 0;
        clearLoadingTimeout();
        isReady.value = true;
        emit('ready');
      } else if (status === 'ZERO_RESULTS') {
        state.value = 'none';
        clearLoadingTimeout();
        scheduleRetry();
      } else if (status) {
        state.value = 'error';
        clearLoadingTimeout();
        scheduleRetry();
      }
    });
  } catch (e) {
    error.value = e.message;
    state.value = 'error';
    console.error('[StreetViewPane]', e);
  }
}

// Loading failures are often transient (tiles still fetching, rate limit).
// Retry the current position once after a short delay unless a newer
// position arrived in the meantime.
function scheduleRetry() {
  // Google's Street View backend can be temporarily unavailable (HTTP 503).
  // Limit retries so a dead service does not keep the pane spinning forever;
  // the host view falls back to map/3D previews and clean map photos instead.
  if (retryCount >= 3) {
    state.value = 'error';
    return;
  }
  retryCount += 1;
  const key = `${props.lat.toFixed(6)}-${props.lon.toFixed(6)}-${Date.now()}`;
  retryKey = key;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (retryKey !== key || !streetView.value) return;
    state.value = 'loading';
    moveToNearestPano(props.lat, props.lon);
  }, 1200);
}

function clearLoadingTimeout() {
  if (loadingTimer) {
    clearTimeout(loadingTimer);
    loadingTimer = null;
  }
}

// A panorama that never reaches OK must not leave a black box forever.
// After 12 s of loading, surface an error so the host can show a fallback
// (3D view / last photo) and the retry can re-attempt the nearest pano.
function startLoadingTimeout() {
  clearLoadingTimeout();
  loadingTimer = setTimeout(() => {
    loadingTimer = null;
    if (state.value === 'loading' && streetView.value) {
      state.value = 'error';
      scheduleRetry();
    }
  }, 12000);
}

watch(
  () => [props.visible, props.prewarm],
  async ([visible, prewarm]) => {
    if ((visible || prewarm) && !streetView.value) {
      await initStreetView();
    }
    if (streetView.value && visible) {
      streetView.value.setVisible(true);
    }
  },
  { immediate: true }
);

watch(
  () => [props.lat, props.lon],
  () => {
    if (streetView.value) {
      state.value = 'loading';
      startLoadingTimeout();
      moveToNearestPano(props.lat, props.lon);
      // Re-assert heading after setPosition to prevent Google Street View
      // from snapping to the nearest road link direction (which can be ~180° off).
      const pitchOffsetRad = (altitudeToStreetViewPitchOffset(props.altitude) * Math.PI) / 180;
      streetView.value.setPov(props.heading, props.pitch + pitchOffsetRad);
    }
  }
);

watch(
  () => [props.heading, props.pitch, props.altitude],
  () => {
    if (streetView.value) {
      // Add altitude-based pitch offset: tilts view upward as drone rises
      // to simulate a rising viewpoint (more sky/horizon, less street)
      const pitchOffsetRad = (altitudeToStreetViewPitchOffset(props.altitude) * Math.PI) / 180;
      streetView.value.setPov(props.heading, props.pitch + pitchOffsetRad);
      streetView.value.setZoom(altitudeToStreetViewZoom(props.altitude));
    }
  }
);

onMounted(() => {
  if (props.visible) initStreetView();
});

onUnmounted(() => {
  if (retryTimer) clearTimeout(retryTimer);
  clearLoadingTimeout();
  if (streetView.value) {
    streetView.value.destroy();
    streetView.value = null;
  }
});

// Expose the panorama handle so host views (e.g. the tourism observation
// dashboard) can force renders and read presented frames for screenshots.
defineExpose({
  get streetView() {
    return streetView.value;
  },
  get isReady() {
    return isReady.value;
  },
  get state() {
    return state.value;
  },
});
</script>

<template>
  <div
    class="street-view-pane"
    :class="{ 'street-view-pane--visible': visible, 'street-view-pane--hidden': !visible }"
  >
    <div ref="containerRef" class="street-view-container" />
    <div v-if="state === 'loading'" class="street-view-overlay">
      <span class="street-view-overlay__spinner" />
      <span>{{ $t('streetviewpane.loading') }}</span>
    </div>
    <div v-else-if="state === 'none'" class="street-view-overlay">
      {{ $t('streetviewpane.unavailable') }}
    </div>
    <div v-else-if="state === 'error'" class="street-view-overlay street-view-overlay--error">
      {{ $t('streetviewpane.load_failed') }}
    </div>
    <div v-if="error" class="street-view-error">
      {{ $t('streetviewpane.unavailable') }} {{ error }}
    </div>
  </div>
</template>

<style scoped>
.street-view-pane {
  position: absolute;
  inset: 0;
  z-index: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease-in-out;
  background: #111;
}

.street-view-pane--visible {
  opacity: 1;
  pointer-events: auto;
}

.street-view-container {
  width: 100%;
  height: 100%;
}

/* Hide Google Maps API attribution footer injected into the panorama container */
.street-view-container :deep(.gm-style-cc),
.street-view-container :deep(.gm-style a) {
  display: none !important;
}

.street-view-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #f87171;
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 0.9rem;
  text-align: center;
  background: rgba(0, 0, 0, 0.7);
}

.street-view-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: rgba(206, 228, 242, 0.85);
  font-family: Calibri, 'Segoe UI', sans-serif;
  font-size: 0.82rem;
  background: rgba(5, 16, 27, 0.82);
  text-align: center;
  padding: 16px;
}

.street-view-overlay--error {
  color: #fca5a5;
}

.street-view-overlay__spinner {
  width: 22px;
  height: 22px;
  border: 3px solid rgba(83, 183, 255, 0.25);
  border-top-color: #53b7ff;
  border-radius: 50%;
  animation: streetview-spin 0.8s linear infinite;
}

@keyframes streetview-spin {
  to { transform: rotate(360deg); }
}
</style>
