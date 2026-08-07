<script setup>
/**
 * OSM / Esri Leaflet base map for Mission Arena when Google key is missing.
 * Interactive: drag / scroll zoom / double-click zoom.
 */
import { ref, onMounted, onUnmounted, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  alt: { type: Number, default: 250 },
  mapTypeId: { type: String, default: 'satellite' },
  /** When false, enable mouse pan/zoom. */
  locked: { type: Boolean, default: false },
});

const emit = defineEmits(['ready']);
const rootRef = ref(null);

let map = null;
let baseLayer = null;

const ALT_ZOOM_K = 20971520;
function altToZoom(alt) {
  const clamped = Math.max(10, Math.min(100000, alt));
  const z = Math.log2(ALT_ZOOM_K / clamped);
  return Math.max(13, Math.min(19, Math.round(z)));
}

function tileLayerFor(type) {
  if (type === 'satellite') {
    return L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: 'Tiles &copy; Esri', maxZoom: 19 },
    );
  }
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap',
    maxZoom: 19,
  });
}

function applyLock(locked) {
  if (!map) return;
  if (locked) {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.touchZoom.disable();
    map.keyboard.disable();
  } else {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom.enable();
    map.boxZoom.enable();
    map.touchZoom.enable();
    map.keyboard.enable();
  }
}

onMounted(() => {
  if (!rootRef.value) return;
  map = L.map(rootRef.value, {
    center: [props.lat, props.lon],
    zoom: altToZoom(props.alt),
    zoomControl: !props.locked,
    attributionControl: true,
  });
  applyLock(props.locked);
  baseLayer = tileLayerFor(props.mapTypeId);
  baseLayer.addTo(map);
  setTimeout(() => map.invalidateSize(), 80);
  emit('ready', { map, L });
});

onUnmounted(() => {
  if (map) {
    map.remove();
    map = null;
  }
});

watch(() => [props.lat, props.lon], ([lat, lon]) => {
  // Only recenter if still near initial (avoid fighting user pan)
  if (!map) return;
});

watch(() => props.alt, (alt) => {
  if (map && props.locked) map.setZoom(altToZoom(alt), { animate: false });
});

watch(() => props.mapTypeId, (type) => {
  if (!map) return;
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = tileLayerFor(type);
  baseLayer.addTo(map);
});

watch(() => props.locked, (locked) => {
  applyLock(locked);
  if (map) {
    if (locked) map.zoomControl?.remove?.();
    else L.control.zoom({ position: 'topleft' }).addTo(map);
  }
});

defineExpose({
  getMap: () => map,
  getLeaflet: () => L,
});
</script>

<template>
  <div class="arena-osm">
    <div ref="rootRef" class="arena-osm__map" />
    <div class="arena-osm__badge">OSM / Esri · 拖拽平移 · 滚轮缩放</div>
  </div>
</template>

<style scoped>
.arena-osm { position: absolute; inset: 0; }
.arena-osm__map {
  position: absolute;
  inset: 0;
  background: #0b1c18;
}
.arena-osm__badge {
  position: absolute;
  left: 88px;
  bottom: 12px;
  z-index: 400;
  padding: 4px 8px;
  font-size: 11px;
  color: #d7ebe2;
  background: rgba(10, 24, 20, 0.75);
  border: 1px solid rgba(120, 180, 150, 0.25);
  pointer-events: none;
}
</style>

<style>
.arena-wp-tip {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  font-weight: 700;
  font-size: 10px;
  color: #0a1614;
}
</style>
