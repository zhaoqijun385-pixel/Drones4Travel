/**
 * Leaflet overlays for Mission Arena (OSM / Esri fallback).
 */

import { DRONE_COLORS, quadcopterSvgDataUrl } from './droneModels.js';

export function createLeafletArenaOverlays() {
  let L = null;
  let map = null;
  let proj = null;
  let layerGroup = null;
  let built = false;
  let blueM = null;
  let redM = null;
  let vipM = null;
  let jamCircle = null;
  let trails = { blue: null, vip: null, red: null };
  let fitted = false;

  function destroy() {
    if (layerGroup && map) map.removeLayer(layerGroup);
    layerGroup = null;
    blueM = redM = vipM = jamCircle = null;
    trails = { blue: null, vip: null, red: null };
    built = false;
    fitted = false;
    map = null;
    L = null;
    proj = null;
  }

  function attach(leaflet, mapInstance, projection) {
    destroy();
    L = leaflet;
    map = mapInstance;
    proj = projection;
    layerGroup = L.layerGroup().addTo(map);
  }

  function clear() {
    if (layerGroup) layerGroup.clearLayers();
    blueM = redM = vipM = jamCircle = null;
    trails = { blue: null, vip: null, red: null };
    built = false;
    fitted = false;
  }

  function ll(x, y) {
    const p = proj.localToLatLng(x, y);
    return [p.lat, p.lng];
  }

  function droneIcon(color, label, yawRad, alt) {
    const yawDeg = ((yawRad || 0) * 180) / Math.PI;
    const scale = 0.85 + Math.min(1.2, (alt || 8) / 40);
    const px = Math.round(44 * scale);
    return L.icon({
      iconUrl: quadcopterSvgDataUrl(color, label, yawDeg, scale),
      iconSize: [px, px],
      iconAnchor: [px / 2, px / 2],
    });
  }

  function fitArena(state) {
    if (!map || !proj || !state?.map || fitted) return;
    const sw = ll(0, state.map.h);
    const ne = ll(state.map.w, 0);
    map.fitBounds([sw, ne], { padding: [48, 48], animate: false });
    fitted = true;
  }

  function ensureStatic(state) {
    if (!L || !map || !proj || !state || built) return;
    built = true;

    for (const w of state.walls || []) {
      const sw = proj.localToLatLng(w.x, w.y + w.h);
      const ne = proj.localToLatLng(w.x + w.w, w.y);
      L.rectangle([[sw.lat, sw.lng], [ne.lat, ne.lng]], {
        color: '#5a7a6c',
        weight: 1,
        fillColor: '#2a3a34',
        fillOpacity: 0.78,
        interactive: false,
      }).addTo(layerGroup);
    }

    const path = (state.waypoints || []).map((p) => ll(p.x, p.y));
    if (path.length) {
      L.polyline(path, {
        color: '#78d2b4',
        weight: 4,
        opacity: 0.85,
        dashArray: '10 8',
        interactive: false,
      }).addTo(layerGroup);
      path.forEach((p, i) => {
        L.circleMarker(p, {
          radius: 7,
          color: '#0a1614',
          weight: 1,
          fillColor: '#9fe8c8',
          fillOpacity: 0.95,
          interactive: false,
        }).addTo(layerGroup).bindTooltip(String(i + 1), { permanent: true, direction: 'center', className: 'arena-wp-tip' });
      });
    }

    L.circle(ll(state.keep_zone.x, state.keep_zone.y), {
      radius: state.keep_zone.r,
      color: '#ff5a5a',
      weight: 2,
      fillColor: '#c83232',
      fillOpacity: 0.2,
      interactive: false,
    }).addTo(layerGroup);

    jamCircle = L.circle(ll(state.jam_zone.x, state.jam_zone.y), {
      radius: state.jam_zone.r,
      color: '#e68c3c',
      weight: 1.5,
      fillColor: '#c87828',
      fillOpacity: 0.1,
      interactive: false,
    }).addTo(layerGroup);

    const trailColors = { blue: '#4db6ff', vip: '#d4c56a', red: '#ff6b5a' };
    for (const name of ['blue', 'vip', 'red']) {
      trails[name] = L.polyline([], {
        color: trailColors[name],
        weight: 3,
        opacity: 0.65,
        interactive: false,
      }).addTo(layerGroup);
    }

    blueM = L.marker(ll(state.blue.x, state.blue.y), {
      icon: droneIcon(DRONE_COLORS.blue, 'B', state.blue.yaw, state.blue.alt),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(layerGroup);
    redM = L.marker(ll(state.red.x, state.red.y), {
      icon: droneIcon(DRONE_COLORS.red, 'R', state.red.yaw, state.red.alt),
      interactive: false,
      zIndexOffset: 1000,
    }).addTo(layerGroup);
    vipM = L.marker(ll(state.vip.x, state.vip.y), {
      icon: droneIcon(DRONE_COLORS.vip, 'V', state.vip.yaw, state.vip.alt),
      interactive: false,
      zIndexOffset: 900,
    }).addTo(layerGroup);

    fitArena(state);
  }

  function sync(state) {
    if (!L || !map || !proj || !state) return;
    ensureStatic(state);

    const t = state.trails || {};
    for (const name of ['blue', 'vip', 'red']) {
      if (trails[name]) {
        trails[name].setLatLngs((t[name] || []).map((p) => ll(p.x, p.y)));
      }
    }

    if (blueM) {
      blueM.setLatLng(ll(state.blue.x, state.blue.y));
      blueM.setIcon(droneIcon(DRONE_COLORS.blue, 'B', state.blue.yaw, state.blue.alt));
    }
    if (redM) {
      redM.setLatLng(ll(state.red.x, state.red.y));
      redM.setIcon(droneIcon(DRONE_COLORS.red, 'R', state.red.yaw, state.red.alt));
    }
    if (vipM) {
      vipM.setLatLng(ll(state.vip.x, state.vip.y));
      vipM.setIcon(droneIcon(DRONE_COLORS.vip, 'V', state.vip.yaw, state.vip.alt));
    }
    if (jamCircle && state.jam) {
      jamCircle.setStyle({ fillOpacity: state.jam.active ? 0.22 : 0.1 });
    }
  }

  return { attach, sync, clear, destroy };
}
