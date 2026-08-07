<script setup>
import { ref, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  TOURISM_DEFAULTS,
  resolveTourismTarget,
  searchTourismPlaces,
} from '@shared-composables/tourismObservationPlanner.js';

const { t } = useI18n();

const props = defineProps({
  open: { type: Boolean, default: true },
  mission: { type: Object, default: null },
  error: { type: String, default: '' },
  isRunning: { type: Boolean, default: false },
  photos: { type: Array, default: () => [] },
});

const emit = defineEmits(['close', 'start', 'stop', 'select']);

const placeQuery = ref('');
const radiusM = ref(TOURISM_DEFAULTS.radiusM);
const minAltM = ref(TOURISM_DEFAULTS.minAltM);
const photoCount = ref(TOURISM_DEFAULTS.photoCount);
const selectedPlace = ref(null);

const suggestions = computed(() => searchTourismPlaces(placeQuery.value, 7));
const clientSuggestions = ref([]);
const resolveError = ref('');

// Merge the local gazetteer with the client-side Google Places autocomplete.
// Search runs entirely in the browser — no backend dependency, so a failing
// /api/tourism/suggest can never break or spam the search.
const mergedSuggestions = computed(() => {
  const merged = [...suggestions.value];
  for (const item of clientSuggestions.value) {
    const name = String(item.name || '');
    if (!name) continue;
    const exists = merged.some((m) => m.name === name);
    if (!exists) merged.push(item);
  }
  return merged.slice(0, 8);
});

async function queryClientSuggestions(query) {
  const g = window.google?.maps;
  if (!g) {
    clientSuggestions.value = [];
    return;
  }
  try {
    // The Places library may not have been loaded with the initial Maps API
    // script; importLibrary loads it on demand.
    let places = g.places;
    if (!places?.AutocompleteService && typeof g.importLibrary === 'function') {
      ({ places } = await g.importLibrary('places'));
    }
    const autocomplete = places?.AutocompleteService;
    if (!autocomplete || typeof autocomplete.getPlacePredictions !== 'function') {
      clientSuggestions.value = [];
      return;
    }
    autocomplete.getPlacePredictions(
      { input: query, language: 'zh-CN', types: [] },
      (results, status) => {
        if (status !== 'OK' || !results) {
          clientSuggestions.value = [];
          return;
        }
        clientSuggestions.value = results.slice(0, 6).map((p) => ({
          id: `client-${p.place_id}`,
          name: p.structured_formatting?.main_text || p.description || '',
          address: p.structured_formatting?.secondary_text || '',
          lat: null,
          lon: null,
          source: 'client',
        }));
      }
    );
  } catch {
    clientSuggestions.value = [];
  }
}

function onQueryInput() {
  const query = placeQuery.value.trim();
  resolveError.value = '';
  if (query.length < 2) {
    clientSuggestions.value = [];
    return;
  }
  queryClientSuggestions(query);
}
// Any typed place name can start a mission now — it is resolved by the local
// gazetteer, coordinates, or the client-side Google Geocoder.
const canStart = computed(() => (
  placeQuery.value.trim().length >= 2
  && !props.isRunning
  && !props.mission
));
const totalPhotos = computed(() => props.mission?.photoCount || 0);
const captured = computed(() => props.photos.length);
const progress = computed(() => {
  if (!totalPhotos.value) return 0;
  return Math.min(100, Math.round((captured.value / totalPhotos.value) * 100));
});

async function geocodePlace(query) {
  const g = window.google?.maps;
  if (!g?.Geocoder) return null;
  try {
    const response = await new g.Geocoder().geocode({ address: query, language: 'zh-CN' });
    const result = response?.results?.[0];
    if (result?.geometry?.location) {
      const lat = result.geometry.location.lat();
      const lng = result.geometry.location.lng();
      return {
        name: result.formatted_address || query,
        address: result.formatted_address || '',
        lat,
        lon: lng,
        latitude: lat,
        longitude: lng,
        source: 'geocode',
      };
    }
  } catch {
    // fall through
  }
  return null;
}

async function selectSuggestion(place) {
  placeQuery.value = place.name;
  resolveError.value = '';
  let resolved = place;
  if (!Number.isFinite(Number(place.lat ?? place.latitude))) {
    resolved = await geocodePlace(place.name) || place;
  }
  selectedPlace.value = resolved;
  emit('select', resolved);
}

function changeCount(delta) {
  photoCount.value = Math.max(5, Math.min(12, photoCount.value + delta));
}

async function startMission() {
  const query = placeQuery.value.trim();
  resolveError.value = '';
  if (query.length < 2) return;
  let target = resolveTourismTarget(query);
  if (!target) {
    target = await geocodePlace(query);
  }
  const fallback = selectedPlace.value && (Number.isFinite(Number(selectedPlace.value.lat)) || Number.isFinite(Number(selectedPlace.value.latitude)))
    ? {
        lat: Number(selectedPlace.value.lat ?? selectedPlace.value.latitude),
        lon: Number(selectedPlace.value.lon ?? selectedPlace.value.longitude),
        name: String(selectedPlace.value.name || placeQuery.value),
        source: 'gazetteer',
      }
    : null;
  const resolved = target || fallback;
  if (!resolved) {
    resolveError.value = '无法解析该地点，请检查名称后重试。';
    return;
  }
  emit('start', {
    target: resolved,
    radiusM: Number(radiusM.value) || TOURISM_DEFAULTS.radiusM,
    minAltM: Number(minAltM.value) || TOURISM_DEFAULTS.minAltM,
    photoCount: photoCount.value,
  });
}

function stopMission() {
  emit('stop');
}
</script>

<template>
  <aside class="tourism-panel" :class="{ 'tourism-panel--hidden': !open }">
    <header class="tourism-panel__header">
      <div>
        <span class="tourism-panel__eyebrow">🌍 Tourism Observer</span>
        <strong>单地点观测任务</strong>
      </div>
    </header>

    <div v-if="!mission" class="tourism-panel__form">
      <label class="tourism-panel__field">
        <span>地点名称</span>
        <input
          v-model="placeQuery"
          type="search"
          placeholder="例如 故宫 / 埃菲尔铁塔"
          @input="onQueryInput"
          @keyup.enter.prevent="startMission"
        />
      </label>
      <div v-if="mergedSuggestions.length" class="tourism-panel__suggestions">
        <button v-for="place in mergedSuggestions" :key="place.id" @click="selectSuggestion(place)">
          <b>{{ place.name }}</b>
          <span v-if="place.address" class="sug-addr">{{ place.address }}</span>
          <span v-else-if="Number.isFinite(place.lat)">{{ place.lat.toFixed(3) }}, {{ place.lon.toFixed(3) }}</span>
          <span v-else class="sug-source">在线</span>
        </button>
      </div>

      <div class="tourism-panel__controls">
        <label>半径 <input v-model.number="radiusM" type="number" min="40" max="2000" step="10" /> m</label>
        <label>高度 <input v-model.number="minAltM" type="number" min="20" max="1000" step="10" /> m</label>
      </div>
      <div class="tourism-panel__count">
        <span>拍摄点</span>
        <div class="stepper">
          <button @click="changeCount(-1)">-</button>
          <b>{{ photoCount }}</b>
          <button @click="changeCount(1)">+</button>
        </div>
      </div>
      <p v-if="error || resolveError" class="error">{{ resolveError || error }}</p>
      <button class="btn-start" :disabled="!canStart" @click="startMission">🚀 开始观测</button>
    </div>

    <div v-else class="tourism-panel__status">
      <div class="status-row">
        <span class="dot" />
        <div>
          <small>当前任务</small>
          <strong>{{ mission.target?.name || '观测中' }}</strong>
        </div>
      </div>
      <div class="progress-bar">
        <div class="fill" :style="{ width: `${progress}%` }" />
        <span>{{ captured }} / {{ totalPhotos }}</span>
      </div>
      <div v-if="!isRunning" class="info">{{ progress === 100 ? '✅ 任务完成' : '⏸️ 已暂停' }}</div>
      <button v-if="isRunning" class="btn-stop" @click="stopMission">⏹ 停止</button>
    </div>
  </aside>
</template>

<style scoped>
.tourism-panel {
  position: fixed;
  top: 60px;
  left: 20px;
  z-index: 70;
  width: 300px;
  padding: 16px;
  background: rgba(5, 16, 27, 0.92);
  border: 1px solid rgba(83, 183, 255, 0.3);
  border-radius: 12px;
  backdrop-filter: blur(12px);
  color: #e8f7ff;
  font-family: 'Calibri', sans-serif;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  transition: opacity 0.2s;
}
.tourism-panel--hidden { opacity: 0; pointer-events: none; }
.tourism-panel__header { border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 12px; }
.tourism-panel__eyebrow { color: #6dc7e8; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.tourism-panel__header strong { display: block; font-size: 1rem; margin-top: 2px; }
.tourism-panel__form { display: flex; flex-direction: column; gap: 10px; }
.tourism-panel__field input { width: 100%; padding: 6px 10px; border-radius: 6px; border: 1px solid rgba(83,183,255,0.3); background: rgba(255,255,255,0.06); color: #fff; }
.tourism-panel__field input:focus { border-color: #53b7ff; outline: none; }
.tourism-panel__suggestions { display: flex; flex-direction: column; gap: 4px; max-height: 120px; overflow-y: auto; }
.tourism-panel__suggestions button { background: transparent; border: none; color: #e8f7ff; text-align: left; padding: 4px 8px; border-radius: 4px; cursor: pointer; display: flex; justify-content: space-between; }
.tourism-panel__suggestions button:hover { background: rgba(83,183,255,0.15); }
.tourism-panel__suggestions span { color: #aac; font-size: 0.7rem; }
.tourism-panel__suggestions .sug-source { color: #6dc7e8; font-size: 0.6rem; }
.tourism-panel__suggestions .sug-addr { color: #7f8c8d; font-size: 0.62rem; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tourism-panel__controls { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.tourism-panel__controls label { display: flex; align-items: center; gap: 4px; font-size: 0.8rem; color: #aac; }
.tourism-panel__controls input { width: 60px; background: rgba(255,255,255,0.06); border: 1px solid rgba(83,183,255,0.2); color: #fff; border-radius: 4px; padding: 2px 4px; }
.tourism-panel__count { display: flex; justify-content: space-between; align-items: center; }
.stepper { display: flex; gap: 8px; align-items: center; }
.stepper button { width: 28px; height: 28px; border-radius: 4px; border: 1px solid rgba(83,183,255,0.3); background: transparent; color: #fff; cursor: pointer; }
.stepper b { min-width: 24px; text-align: center; color: #63e6be; }
.error { color: #fca5a5; font-size: 0.8rem; margin: 0; }
.btn-start, .btn-stop { width: 100%; padding: 8px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; }
.btn-start { background: #2b6cff; color: #fff; }
.btn-start:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-stop { background: rgba(248,113,113,0.2); color: #fecaca; border: 1px solid rgba(255,107,95,0.3); }
.tourism-panel__status { display: flex; flex-direction: column; gap: 8px; }
.status-row { display: flex; align-items: center; gap: 8px; }
.status-row .dot { width: 10px; height: 10px; border-radius: 50%; background: #63e6be; animation: pulse 1.4s infinite; }
.status-row small { display: block; font-size: 0.6rem; color: #aac; }
.status-row strong { font-size: 0.9rem; }
.progress-bar { position: relative; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden; }
.progress-bar .fill { height: 100%; background: linear-gradient(90deg, #53b7ff, #63e6be); transition: width 0.3s; }
.progress-bar span { position: absolute; right: 0; top: -12px; font-size: 0.6rem; color: #aac; }
.info { text-align: center; font-size: 0.8rem; color: #aac; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
</style>
