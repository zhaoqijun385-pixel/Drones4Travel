<script setup>
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import MapView from '@/2d_map/MapView.vue';
import { createWhepPlayer } from '@shared-composables/useWhepPlayer.js';
import { useStreamConfig } from '@shared-composables/useStreamConfig.js';

const { t } = useI18n();
const { streams } = useStreamConfig();

const props = defineProps({
  open: { type: Boolean, default: false },
  mode: { type: String, default: 'map' },
  drones: { type: Array, default: () => [] },
  selectedDroneId: { type: String, default: '' },
  selectedDrone: { type: Object, default: null },
});

const emit = defineEmits(['close', 'mode-change', 'select-drone']);

const videoEl = ref(null);
const videoState = ref('idle');
let videoPlayer = null;
let playingUrl = '';
let mapPointTimer = null;
let videoReleaseTimer = null;
const mapViewMounted = ref(false);
const videoMounted = ref(false);
const VIDEO_CACHE_TTL_MS = 30_000;

const selected = computed(() => props.selectedDrone || props.drones.find((drone) => drone.droneId === props.selectedDroneId) || null);

// A future server fleet record can provide streamId. Until then, keep the
// existing primary MediaMTX stream as a safe fallback for the local/demo deck.
const targetStream = computed(() => {
  const streamKey = selected.value?.streamId || selected.value?.droneId;
  if (streamKey) {
    const matched = streams.value.find((stream) => stream.id === streamKey || stream.hostname === streamKey);
    if (matched) return matched;
  }
  return streams.value[0] || null;
});

const targetUrl = computed(() => targetStream.value?.whep_url || '');

const mapPoint = reactive({ lat: 0, lon: 0, alt: 100, heading: 0 });

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function syncMapPoint() {
  const drone = selected.value;
  if (!drone) return;
  mapPoint.lat = numberOr(drone.lat, mapPoint.lat);
  mapPoint.lon = numberOr(drone.lon, mapPoint.lon);
  mapPoint.alt = Math.max(10, numberOr(drone.alt, mapPoint.alt));
  mapPoint.heading = numberOr(drone.yaw, numberOr(drone.heading, mapPoint.heading));
}

function stopMapPointTimer() {
  if (mapPointTimer) {
    clearInterval(mapPointTimer);
    mapPointTimer = null;
  }
}

function syncMapPointTimer() {
  stopMapPointTimer();
  if (!props.open || props.mode !== 'map') return;
  syncMapPoint();
  // The fleet simulation ticks at 10 Hz, but a 5 Hz map center update is
  // enough for a small HUD window and avoids excessive Google Maps work.
  mapPointTimer = setInterval(syncMapPoint, 200);
}

function onVideoProgress(phase) {
  if (phase === 'track' || phase === 'handshake') videoState.value = 'live';
  else if (phase === 'start' || phase === 'offer') videoState.value = 'connecting';
}

function ensureVideoPlayer() {
  if (videoPlayer) return videoPlayer;
  videoPlayer = createWhepPlayer({
    url: () => targetUrl.value,
    logTag: 'situation-video',
    onProgress: onVideoProgress,
  });
  return videoPlayer;
}

function cancelVideoRelease() {
  if (videoReleaseTimer) {
    clearTimeout(videoReleaseTimer);
    videoReleaseTimer = null;
  }
}

function releaseVideoCache() {
  if (props.open) return;
  cancelVideoRelease();
  if (videoPlayer) videoPlayer.stop();
  playingUrl = '';
  videoState.value = 'idle';
  videoMounted.value = false;
}

function scheduleVideoRelease() {
  cancelVideoRelease();
  if (!videoPlayer) return;
  // Keep the WHEP PeerConnection briefly so a close/reopen does not repeat
  // the SDP handshake on a slow network. Detach the video immediately to
  // avoid decoding frames while the panel is hidden.
  videoPlayer.detach();
  videoReleaseTimer = setTimeout(releaseVideoCache, VIDEO_CACHE_TTL_MS);
}

async function syncVideo() {
  if (!props.open) {
    scheduleVideoRelease();
    return;
  }
  cancelVideoRelease();
  if (props.mode !== 'video') {
    if (videoPlayer) videoPlayer.detach();
    return;
  }
  videoMounted.value = true;
  if (!targetUrl.value) {
    releaseVideoCache();
    videoState.value = 'unavailable';
    return;
  }

  await nextTick();
  if (!videoEl.value) return;
  if (playingUrl === targetUrl.value) {
    ensureVideoPlayer().attach(videoEl.value);
    return;
  }

  const player = ensureVideoPlayer();
  player.stop();
  playingUrl = targetUrl.value;
  videoState.value = 'connecting';
  player.attach(videoEl.value);
  player.start();
}

function onVideoPlaying() {
  videoState.value = 'live';
}

watch([() => props.open, () => props.mode], ([open, mode]) => {
  if (!open) return;
  if (mode === 'map') mapViewMounted.value = true;
  if (mode === 'video') videoMounted.value = true;
}, { immediate: true });
watch([() => props.open, () => props.mode], syncMapPointTimer, { immediate: true });
watch([() => props.open, () => props.mode, targetUrl], syncVideo, { immediate: true });
watch(selected, syncMapPoint);

onUnmounted(() => {
  stopMapPointTimer();
  cancelVideoRelease();
  if (videoPlayer) videoPlayer.stop();
});
</script>

<template>
  <aside v-show="open" class="situation-panel" :class="`situation-panel--${mode}`" :aria-hidden="!open" aria-label="Drone situation window">
    <header class="situation-panel__header">
      <div class="situation-panel__identity">
        <span class="situation-panel__eyebrow">{{ t('dronesituationpanel.eyebrow') }}</span>
        <strong>{{ selected?.name || t('dronesituationpanel.no_drone') }}</strong>
      </div>
      <button type="button" class="situation-panel__close" :aria-label="t('dronesituationpanel.close')" @click="emit('close')">×</button>
    </header>

    <div class="situation-panel__controls">
      <label class="situation-panel__target">
        <span>{{ t('dronesituationpanel.target') }}</span>
        <select :value="selectedDroneId" :disabled="!drones.length" @change="emit('select-drone', $event.target.value)">
          <option v-if="!drones.length" value="">{{ t('dronesituationpanel.no_drone') }}</option>
          <option v-for="drone in drones" :key="drone.droneId" :value="drone.droneId">
            {{ drone.name }} · {{ drone.droneId }}
          </option>
        </select>
      </label>
      <div class="situation-panel__mode-switch" role="tablist" :aria-label="t('dronesituationpanel.view')">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'map'"
          :class="{ 'is-active': mode === 'map' }"
          @click="emit('mode-change', 'map')"
        >
          {{ t('dronesituationpanel.map') }}
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'video'"
          :class="{ 'is-active': mode === 'video' }"
          @click="emit('mode-change', 'video')"
        >
          {{ t('dronesituationpanel.video') }}
        </button>
      </div>
    </div>

    <template v-if="mapViewMounted">
      <div v-show="mode === 'map'" class="situation-panel__stage situation-panel__stage--map">
        <MapView
          :lat="mapPoint.lat"
          :lon="mapPoint.lon"
          :alt="mapPoint.alt"
          :heading="mapPoint.heading"
          map-type-id="roadmap"
        />
        <div class="situation-panel__telemetry">
          <span>{{ mapPoint.lat.toFixed(5) }}, {{ mapPoint.lon.toFixed(5) }}</span>
          <b>{{ mapPoint.alt.toFixed(1) }} m</b>
        </div>
      </div>
    </template>

    <template v-if="videoMounted">
      <div v-show="mode === 'video'" class="situation-panel__stage situation-panel__stage--video">
        <video
          ref="videoEl"
          class="situation-panel__video"
          autoplay
          muted
          playsinline
          @playing="onVideoPlaying"
        />
        <div v-if="videoState !== 'live'" class="situation-panel__video-state">
          <span class="situation-panel__video-dot" :class="`situation-panel__video-dot--${videoState}`" />
          {{ videoState === 'unavailable' ? t('dronesituationpanel.video_unavailable') : t('dronesituationpanel.video_connecting') }}
        </div>
        <span class="situation-panel__stream-name">{{ targetStream?.hostname || t('dronesituationpanel.no_stream') }}</span>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.situation-panel {
  position: fixed;
  top: 24px;
  left: 94px;
  z-index: 70;
  width: min(360px, calc(100vw - 190px));
  overflow: hidden;
  border: 1px solid rgba(83, 183, 255, 0.42);
  border-radius: 14px;
  background: rgba(5, 16, 27, 0.92);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.4), inset 0 1px rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(14px);
  color: #e8f4ff;
  font-family: Calibri, 'Segoe UI', sans-serif;
  pointer-events: auto;
}

.situation-panel__header,
.situation-panel__controls,
.situation-panel__mode-switch {
  display: flex;
  align-items: center;
}

.situation-panel__header {
  justify-content: space-between;
  gap: 12px;
  padding: 11px 13px 9px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.situation-panel__identity { min-width: 0; }
.situation-panel__eyebrow {
  display: block;
  margin-bottom: 3px;
  color: #7dd3fc;
  font-size: 0.58rem;
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.situation-panel__identity strong {
  display: block;
  overflow: hidden;
  color: #f0f9ff;
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.situation-panel__close {
  flex: 0 0 auto;
  border: 0;
  color: rgba(232, 244, 255, 0.7);
  background: transparent;
  font-size: 1.35rem;
  line-height: 1;
  cursor: pointer;
}

.situation-panel__controls {
  align-items: flex-end;
  gap: 8px;
  padding: 9px 12px;
}

.situation-panel__target {
  display: block;
  min-width: 0;
  flex: 1;
}

.situation-panel__target span {
  display: block;
  margin-bottom: 4px;
  color: rgba(232, 244, 255, 0.54);
  font-size: 0.62rem;
}

.situation-panel__target select {
  width: 100%;
  padding: 7px 8px;
  border: 1px solid rgba(83, 183, 255, 0.3);
  border-radius: 7px;
  color: #e8f4ff;
  background: rgba(255, 255, 255, 0.07);
  font: inherit;
  font-size: 0.7rem;
}

.situation-panel__mode-switch {
  flex: 0 0 auto;
  gap: 3px;
  padding: 3px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.24);
}

.situation-panel__mode-switch button {
  padding: 6px 7px;
  border: 0;
  border-radius: 5px;
  color: rgba(232, 244, 255, 0.58);
  background: transparent;
  font: inherit;
  font-size: 0.64rem;
  cursor: pointer;
}

.situation-panel__mode-switch button.is-active {
  color: #07131e;
  background: #7dd3fc;
  font-weight: 700;
}

.situation-panel__stage {
  position: relative;
  height: 220px;
  overflow: hidden;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: #06111b;
}

.situation-panel__stage--map :deep(.map-view) {
  position: absolute;
}

.situation-panel__stage--video {
  display: grid;
  place-items: center;
}

.situation-panel__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #02070b;
}

.situation-panel__video-state {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 9px;
  border-radius: 7px;
  color: rgba(232, 244, 255, 0.72);
  background: rgba(0, 0, 0, 0.56);
  font-size: 0.68rem;
}

.situation-panel__video-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f6c453;
  box-shadow: 0 0 8px rgba(246, 196, 83, 0.8);
}

.situation-panel__video-dot--unavailable { background: #f87171; box-shadow: 0 0 8px rgba(248, 113, 113, 0.7); }
.situation-panel__stream-name {
  position: absolute;
  right: 8px;
  bottom: 7px;
  max-width: calc(100% - 16px);
  overflow: hidden;
  padding: 3px 5px;
  border-radius: 4px;
  color: rgba(232, 244, 255, 0.68);
  background: rgba(0, 0, 0, 0.5);
  font-size: 0.58rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.situation-panel__telemetry {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  padding: 5px 7px;
  border-radius: 6px;
  color: #e0f2fe;
  background: rgba(5, 16, 27, 0.74);
  font-family: 'Courier New', monospace;
  font-size: 0.6rem;
}

.situation-panel__telemetry b { color: #7dd3fc; }

@media (max-width: 640px) {
  .situation-panel {
    top: 14px;
    left: 68px;
    width: calc(100vw - 82px);
  }

  .situation-panel__stage { height: 170px; }
  .situation-panel__controls { align-items: stretch; flex-direction: column; }
  .situation-panel__mode-switch { align-self: stretch; }
  .situation-panel__mode-switch button { flex: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .situation-panel,
  .situation-panel * { transition: none !important; animation: none !important; }
}
</style>
