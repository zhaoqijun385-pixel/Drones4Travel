/**
 * Tourism module composable  --  address search, place suggestions,
 * nearby discovery, observation planning, and Street View helpers.
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

export const planResults = ref([]);
export const planLoading = ref(false);

export const streetViewStatus = ref(null);
export const streetViewLoading = ref(false);

export const error = ref(null);

// ---------------------------------------------------------------------------
// Autocomplete (GET /api/tourism/suggest)
// ---------------------------------------------------------------------------

export async function fetchSuggestions(query) {
  if (!query || query.trim().length < 2) {
    suggestions.value = [];
    return;
  }
  searching.value = true;
  error.value = null;
  try {
    const url = apiUrl(`/tourism/suggest?query=${encodeURIComponent(query.trim())}&language=zh-CN`);
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
// Nearby places (GET /api/tourism/places/nearby)
// ---------------------------------------------------------------------------

export async function fetchNearbyPlaces(lat, lng, radius = 1000) {
  nearbyLoading.value = true;
  error.value = null;
  try {
    const url = apiUrl(`/tourism/places/nearby?lat=${lat}&lng=${lng}&radius=${radius}&language=zh-CN`);
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
// Single place plan (POST /api/tourism/plan)
// ---------------------------------------------------------------------------

export async function planSingle(query) {
  planLoading.value = true;
  error.value = null;
  try {
    const res = await fetch(apiUrl('/tourism/plan'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.detail || `Plan failed (status ${res.status})`);
    return data;
  } catch (e) {
    console.error('[useTourism] plan failed:', e);
    error.value = e.message;
    return null;
  } finally {
    planLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Batch plan (POST /api/tourism/plan/batch)
// ---------------------------------------------------------------------------

export async function planBatch(queries) {
  planLoading.value = true;
  error.value = null;
  try {
    const res = await fetch(apiUrl('/tourism/plan/batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.detail || `Batch plan failed (status ${res.status})`);
    planResults.value = data.results || [];
    return data;
  } catch (e) {
    console.error('[useTourism] batch plan failed:', e);
    error.value = e.message;
    planResults.value = [];
    return null;
  } finally {
    planLoading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Street View check (GET /api/tourism/streetview)
// ---------------------------------------------------------------------------

export async function checkStreetView(lat, lng, radius = 50) {
  streetViewLoading.value = true;
  try {
    const url = apiUrl(`/tourism/streetview?lat=${lat}&lng=${lng}&radius=${radius}`);
    const res = await fetch(url);
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data?.detail || `Street View check failed (status ${res.status})`);
    streetViewStatus.value = data;
    return data;
  } catch (e) {
    console.error('[useTourism] streetview check failed:', e);
    streetViewStatus.value = null;
    return null;
  } finally {
    streetViewLoading.value = false;
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
  planResults.value = [];
  streetViewStatus.value = null;
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

export function streetViewImageUrl(lat, lng, heading = 0, size = '400x200') {
  const key = config.googleApiKey || '';
  if (!key) return '';
  return `https://maps.googleapis.com/maps/api/streetview?location=${lat},${lng}&heading=${heading}&size=${size}&fov=90&key=${key}`;
}
