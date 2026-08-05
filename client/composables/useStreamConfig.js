// Runtime MediaMTX stream catalog, fetched ONCE from the backend
// (server/config.json "mediamtx" section -> GET /api/stream/config).
//
// This lets the SAME frontend build play the desktop MediaMTX in local dev
// and the ECS MediaMTX in production — the deployed server config decides,
// no hardcoded environment URLs in views and no rebuild.
//
// Catalog entry shape: { id, hostname, description, whep_url }.
// The FIRST entry is the PRIMARY stream — the one the Livestream Host
// subpage monitors (our own broadcast, 'crazyflie-drone').
import { ref, computed } from 'vue';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

// Last-resort catalog when the endpoint is unreachable or unconfigured:
// local MediaMTX in dev, the public Caddy /live path in production.
const WHEP_BASE = import.meta.env.DEV
  ? 'http://127.0.0.1:8889'
  : 'https://drone-navigation.com/live';

const FALLBACK_STREAMS = [
  {
    id: 'crazyflie-drone',
    hostname: 'crazyflie-drone',
    description: 'Live video from the Crazyflie drone (ESP32 AI-Deck)',
    whep_url: `${WHEP_BASE}/crazyflie-drone/whep`,
  },
  {
    id: 'ubuntu-webcam',
    hostname: 'ubuntu-webcam',
    description: "A webcam stream from Kan's Ubuntu desktop",
    whep_url: `${WHEP_BASE}/ubuntu-webcam/whep`,
  },
];

const STREAM_CACHE_KEY = 'drone-navigation:stream-config:v1';
const STREAM_CACHE_TTL_MS = 10 * 60 * 1000;
const STREAM_CACHE_STALE_MS = 24 * 60 * 60 * 1000;

function readCachedStreams() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STREAM_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    const age = Date.now() - Number(cached.savedAt || 0);
    if (!Array.isArray(cached.streams) || !Number.isFinite(age) || age > STREAM_CACHE_STALE_MS) return null;
    const list = normalize(cached.streams);
    return list.length ? list : null;
  } catch {
    return null;
  }
}

function cacheStreams(list) {
  if (typeof window === 'undefined' || !Array.isArray(list) || !list.length) return;
  try {
    window.localStorage.setItem(STREAM_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      streams: list,
    }));
  } catch {
    // Private browsing or a full storage quota should not block playback.
  }
}

function hasFreshCachedStreams() {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(STREAM_CACHE_KEY);
    if (!raw) return false;
    const cached = JSON.parse(raw);
    const age = Date.now() - Number(cached.savedAt || 0);
    return Array.isArray(cached.streams) && Number.isFinite(age) && age <= STREAM_CACHE_TTL_MS;
  } catch {
    return false;
  }
}

// Use the last known catalog immediately, then refresh it in the background.
// This prevents a slow API/config request from delaying the first video view.
const streams = ref(readCachedStreams() || FALLBACK_STREAMS);
// Primary stream's WHEP URL (first catalog entry), kept for backward
// compatibility with single-stream consumers.
const whepUrl = computed(() => streams.value[0]?.whep_url || '');
let requested = false;

// Legacy single-stream config ("whep_url" only, no "streams"): derive a
// one-entry catalog from the URL — the stream id is the path segment
// right before '/whep'.
function legacyStream(url) {
  const m = /\/([^/]+)\/whep\/?$/.exec(url || '');
  const id = m ? m[1] : 'livestream';
  return [{ id, hostname: id, description: '', whep_url: url }];
}

function normalize(list) {
  return list
    .map((s) => ({
      id: s.id || s.hostname || s.whep_url,
      hostname: s.hostname || s.id || '',
      description: s.description || '',
      whep_url: s.whep_url || '',
    }))
    .filter((s) => s.whep_url);
}

export function useStreamConfig() {
  if (!requested) {
    requested = true;
    if (hasFreshCachedStreams()) return { streams, whepUrl };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    fetch(`${API_BASE}/api/stream/config`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        if (Array.isArray(data.streams) && data.streams.length) {
          const list = normalize(data.streams);
          if (list.length) {
            streams.value = list;
            cacheStreams(list);
          }
        } else if (data.whep_url) {
          const list = legacyStream(data.whep_url);
          streams.value = list;
          cacheStreams(list);
        }
      })
      .catch(() => { /* keep the cached/fallback catalog */ })
      .finally(() => clearTimeout(timeout));
  }
  return { streams, whepUrl };
}
