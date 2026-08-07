/**
 * Tourism module composable  --  address search, place suggestions,
 * nearby discovery and observation planning helpers.
 */

import { ref, computed } from 'vue';
import config from '../config.json';

const BASE = (() => {
  if (config.apiBaseUrl) return config.apiBaseUrl.replace(/\/+$/, '');
  const { origin } = window.location;
  return origin;
})();

function apiUrl(path) {
  return `${BASE}/api${path}`;
}

// ---------------------------------------------------------------------------
// Safe JSON parsing helpers
// ---------------------------------------------------------------------------

async function safeJson(res) {
  const text = await res.text();
  if (!text) {
    throw new Error(`Server returned empty response (status ${res.status})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid response from server (status ${res.status}): ${text.slice(0, 200)}`);
  }
}

async function errorDetail(res) {
  try {
    const body = await safeJson(res);
    return body?.detail || `Request failed with status ${res.status}`;
  } catch {
    return `Request failed with status ${res.status}`;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export const searchQuery = ref('');
export const suggestions = ref([]);
export const searching = ref(false);

export const selectedPlaces = ref([]);
export const nearbyPlaces = ref([]);
export const nearbyLoading = ref(false);

export const error = ref(null);

// ---------------------------------------------------------------------------
// Autocomplete (GET /api/survey/suggest)
// ---------------------------------------------------------------------------

export async function fetchSuggestions(query) {
  if (!query || query.trim().length < 2) {
    suggestions.value = [];
    return;
  }
  searching.value = true;
  error.value = null;
  try {
    const url = apiUrl(`/survey/suggest?query=${encodeURIComponent(query.trim())}&language=zh-CN`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(await errorDetail(res));
    const data = await safeJson(res);
    suggestions.value = data.suggestions || [];
  } catch (e) {
    console.debug('[useTourism] suggest failed:', e);
    suggestions.value = [];
    error.value = e.message;
  } finally {
    searching.value = false;
  }
}

// ---------------------------------------------------------------------------
// Nearby places (GET /api/survey/places/nearby)
// ---------------------------------------------------------------------------

export async function fetchNearbyPlaces(lat, lng, radius = 1000) {
  nearbyLoading.value = true;
  error.value = null;
  try {
    const url = apiUrl(`/survey/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}&language=zh-CN`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(await errorDetail(res));
    const data = await safeJson(res);
    nearbyPlaces.value = data.places || [];
    return data.places || [];
  } catch (e) {
    console.error('[useTourism] nearby failed:', e);
    nearbyPlaces.value = [];
    error.value = e.message;
    return [];
  } finally {
    nearbyLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Place selection helpers
// ---------------------------------------------------------------------------

export function addPlace(place) {
  const exists = selectedPlaces.value.find(
    (p) => p.latitude === place.latitude && p.longitude === place.longitude,
  );
  if (!exists) {
    selectedPlaces.value.push(place);
  }
}

export function removePlace(index) {
  selectedPlaces.value.splice(index, 1);
}

export function clearPlaces() {
  selectedPlaces.value = [];
}

// ---------------------------------------------------------------------------
// Derived
// ---------------------------------------------------------------------------

export const hasPlaces = computed(() => selectedPlaces.value.length > 0);

export function staticMapUrl(lat, lng, zoom = 16, size = '400x200') {
  const key = config.googleApiKey || '';
  if (!key) return '';
  return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&markers=color:red%7C${lat},${lng}&key=${key}`;
}
