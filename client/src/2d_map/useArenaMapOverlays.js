/**
 * Google Maps overlays for Mission Arena (multi-drone factions).
 * Built on the same Maps JS stack as Map2DView — not Three.js.
 */

import { DRONE_COLORS, quadcopterSvgDataUrl } from './droneModels.js';

export function createArenaOverlayController() {
  let mapsApi = null;
  let map = null;
  let proj = null;
  let walls = [];
  let corridor = null;
  let keepCircle = null;
  let jamCircle = null;
  let wpMarkers = [];
  const unitMarkers = new Map();
  const trailPolys = new Map();
  let fitted = false;

  function clear() {
    for (const w of walls) w.setMap(null);
    walls = [];
    for (const m of wpMarkers) m.setMap(null);
    wpMarkers = [];
    if (corridor) { corridor.setMap(null); corridor = null; }
    if (keepCircle) { keepCircle.setMap(null); keepCircle = null; }
    if (jamCircle) { jamCircle.setMap(null); jamCircle = null; }
    for (const m of unitMarkers.values()) m.setMap(null);
    unitMarkers.clear();
    for (const p of trailPolys.values()) p.setMap(null);
    trailPolys.clear();
    fitted = false;
  }

  function destroy() {
    clear();
    mapsApi = null;
    map = null;
    proj = null;
  }

  function attach(api, mapInstance, projection) {
    clear();
    mapsApi = api;
    map = mapInstance;
    proj = projection;
  }

  function droneIcon(color, label, yawRad, alt) {
    const yawDeg = ((yawRad || 0) * 180) / Math.PI;
    const scale = 0.9 + Math.min(1.1, (alt || 8) / 50);
    return {
      url: quadcopterSvgDataUrl(color, label, yawDeg, scale),
      scaledSize: new mapsApi.Size(Math.round(48 * scale), Math.round(48 * scale)),
      anchor: new mapsApi.Point(Math.round(24 * scale), Math.round(24 * scale)),
    };
  }

  function colorFor(unit) {
    if (unit.faction === 'red') return DRONE_COLORS.red;
    if (unit.faction === 'vip') return DRONE_COLORS.vip;
    if (unit.faction === 'observer') return '#b8f0d0';
    return DRONE_COLORS.blue;
  }

  function labelFor(uid, unit) {
    if (unit.role === 'lead') return 'B1';
    if (unit.role === 'wing') return 'B2';
    if (unit.faction === 'vip') return 'V';
    if (unit.faction === 'observer') return 'O';
    if (uid === 'red_a') return 'R1';
    if (uid === 'red_b') return 'R2';
    if (uid === 'red_c') return 'RJ';
    return uid.slice(0, 2).toUpperCase();
  }

  function fitArena(state) {
    if (!map || !proj || !state?.map || fitted) return;
    // Avoid map.fitBounds — it resets tilt/heading to 0 (Google Maps docs).
    const c = proj.localToLatLng(state.map.w / 2, state.map.h / 2);
    map.setCenter({ lat: c.lat, lng: c.lng });
    // ~220 m arena → zoom ~18 keeps 45° aerial imagery usable in many regions
    if (typeof map.getZoom === 'function' && (map.getZoom() < 17 || map.getZoom() > 19)) {
      map.setZoom(18);
    }
    fitted = true;
    try {
      if (String(map.getMapTypeId()).includes('satellite') || map.getMapTypeId() === 'hybrid') {
        map.setTilt(45);
      }
    } catch { /* */ }
  }

  function ensureStatic(state) {
    if (!mapsApi || !map || !proj || !state) return;
    if (walls.length) return;

    for (const w of state.walls || []) {
      const sw = proj.localToLatLng(w.x, w.y + w.h);
      const ne = proj.localToLatLng(w.x + w.w, w.y);
      walls.push(new mapsApi.Rectangle({
        map,
        bounds: { south: sw.lat, west: sw.lng, north: ne.lat, east: ne.lng },
        fillColor: '#2a3a34',
        fillOpacity: 0.65,
        strokeColor: '#6a8a7c',
        strokeWeight: 1,
        clickable: false,
        zIndex: 1,
      }));
    }

    const path = (state.waypoints || []).map((p) => proj.localToLatLng(p.x, p.y));
    corridor = new mapsApi.Polyline({
      map,
      path,
      strokeColor: '#78d2b4',
      strokeOpacity: 0.9,
      strokeWeight: 4,
      geodesic: true,
      clickable: false,
      zIndex: 2,
      icons: [{
        icon: { path: mapsApi.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.5, strokeColor: '#b8f0d8' },
        offset: '100%',
        repeat: '56px',
      }],
    });

    path.forEach((p, i) => {
      wpMarkers.push(new mapsApi.Marker({
        map,
        position: p,
        clickable: false,
        zIndex: 3,
        label: { text: String(i + 1), color: '#0a1614', fontSize: '10px', fontWeight: '700' },
        icon: {
          path: mapsApi.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#9fe8c8',
          fillOpacity: 0.95,
          strokeWeight: 1,
          strokeColor: '#0a1614',
        },
      }));
    });

    keepCircle = new mapsApi.Circle({
      map,
      center: proj.localToLatLng(state.keep_zone.x, state.keep_zone.y),
      radius: state.keep_zone.r,
      fillColor: '#c83232',
      fillOpacity: 0.2,
      strokeColor: '#ff5a5a',
      strokeWeight: 2,
      clickable: false,
      zIndex: 2,
    });
    jamCircle = new mapsApi.Circle({
      map,
      center: proj.localToLatLng(state.jam_zone.x, state.jam_zone.y),
      radius: state.jam_zone.r,
      fillColor: '#c87828',
      fillOpacity: 0.1,
      strokeColor: '#e68c3c',
      strokeWeight: 1.5,
      clickable: false,
      zIndex: 2,
    });

    fitArena(state);
  }

  function sync(state, opts = {}) {
    if (!mapsApi || !map || !proj || !state) return;
    ensureStatic(state);

    const hideObserver = !!opts.hideObserverMarker;
    const units = state.units || {};

    for (const [uid, unit] of Object.entries(units)) {
      if (uid === 'observer' && hideObserver) {
        const existing = unitMarkers.get(uid);
        if (existing) existing.setMap(null);
        unitMarkers.delete(uid);
        continue;
      }
      const pos = proj.localToLatLng(unit.x, unit.y);
      let marker = unitMarkers.get(uid);
      const icon = droneIcon(colorFor(unit), labelFor(uid, unit), unit.yaw, unit.alt);
      if (!marker) {
        marker = new mapsApi.Marker({
          map,
          position: pos,
          clickable: false,
          zIndex: unit.faction === 'observer' ? 25 : 20,
          title: uid,
          icon,
        });
        unitMarkers.set(uid, marker);
      } else {
        if (!marker.getMap()) marker.setMap(map);
        marker.setPosition(pos);
        marker.setIcon(icon);
      }
    }

    // Trails
    const trails = state.trails || {};
    for (const [uid, pts] of Object.entries(trails)) {
      if (!pts?.length) continue;
      const path = pts.map((p) => proj.localToLatLng(p.x, p.y));
      const unit = units[uid];
      const stroke = unit ? colorFor(unit) : '#88a';
      let poly = trailPolys.get(uid);
      if (!poly) {
        poly = new mapsApi.Polyline({
          map,
          path,
          strokeColor: stroke,
          strokeOpacity: 0.65,
          strokeWeight: 3,
          geodesic: true,
          clickable: false,
          zIndex: 4,
        });
        trailPolys.set(uid, poly);
      } else {
        poly.setPath(path);
      }
    }

    if (jamCircle && state.jam) {
      jamCircle.setOptions({ fillOpacity: state.jam.active ? 0.22 : 0.1 });
    }
  }

  function refit() { fitted = false; }

  return { attach, sync, clear, destroy, refit };
}
