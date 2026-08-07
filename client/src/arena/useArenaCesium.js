/**
 * Mission Arena Cesium layer — reuses the shared window.cesiumViewer (Aerial / Node 1).
 * Does NOT create a second Viewer. Does NOT touch useDrone().
 */
import { syncQuadEntity } from './droneMesh.js';

const SOURCE_NAME = 'mission-arena-units';

export function createArenaCesiumController() {
  let dataSource = null;
  let staticBuilt = false;
  let staticKey = '';
  let spin = 0;
  /** @type {Map<string, string[]>} */
  const unitPartIds = new Map();

  function viewer() {
    return window.cesiumViewer || null;
  }

  function ensureSource() {
    const v = viewer();
    if (!v || !window.Cesium) return null;
    if (dataSource && !v.dataSources.contains(dataSource)) {
      dataSource = null;
      staticBuilt = false;
      unitPartIds.clear();
    }
    if (!dataSource) {
      dataSource = new window.Cesium.CustomDataSource(SOURCE_NAME);
      v.dataSources.add(dataSource);
    }
    return dataSource;
  }

  function clear() {
    const v = viewer();
    if (dataSource && v) {
      try { v.dataSources.remove(dataSource, true); } catch { /* */ }
    }
    dataSource = null;
    staticBuilt = false;
    unitPartIds.clear();
  }

  function ensureStatic(proj, state) {
    const ds = ensureSource();
    const Cesium = window.Cesium;
    if (!ds || !Cesium || !proj || !state) return;
    const key = `${state.mission_id || ''}-${state.map?.w}-${state.map?.h}-${state.route || 'main'}-${(state.waypoints || []).length}`;
    if (staticBuilt && key === staticKey) return;
    // Rebuild corridor / zones when mission or route changes
    const drop = [];
    for (const e of ds.entities.values) {
      if (e.id?.startsWith?.('arena-wall-') || e.id === 'arena-corridor' || e.id === 'arena-keep' || e.id === 'arena-relay') {
        drop.push(e);
      }
    }
    for (const e of drop) ds.entities.remove(e);
    staticKey = key;

    const path = (state.waypoints || []).map((p) => {
      const ll = proj.localToLatLng(p.x, p.y);
      return Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, 8);
    });
    if (path.length >= 2) {
      ds.entities.add({
        id: 'arena-corridor',
        polyline: {
          positions: path,
          width: 4,
          material: Cesium.Color.fromCssColorString('#78d2b4').withAlpha(0.9),
          clampToGround: false,
        },
      });
    }

    const kz = state.keep_zone;
    if (kz) {
      const ll = proj.localToLatLng(kz.x, kz.y);
      ds.entities.add({
        id: 'arena-keep',
        position: Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, 0),
        ellipse: {
          semiMajorAxis: kz.r,
          semiMinorAxis: kz.r,
          material: Cesium.Color.fromCssColorString('#e35d5d').withAlpha(0.25),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ff8a7a'),
          height: 0,
          extrudedHeight: 4,
        },
      });
    }

    const rz = state.relay_zone;
    if (rz) {
      const ll = proj.localToLatLng(rz.x, rz.y);
      ds.entities.add({
        id: 'arena-relay',
        position: Cesium.Cartesian3.fromDegrees(ll.lng, ll.lat, 0),
        ellipse: {
          semiMajorAxis: rz.r,
          semiMinorAxis: rz.r,
          material: Cesium.Color.fromCssColorString('#f0c14a').withAlpha(0.22),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ffe08a'),
          height: 0,
          extrudedHeight: 3,
        },
        label: {
          text: 'RELAY',
          font: 'bold 11px sans-serif',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }

    for (const w of state.walls || []) {
      const sw = proj.localToLatLng(w.x, w.y + w.h);
      const ne = proj.localToLatLng(w.x + w.w, w.y);
      const h = Math.max(8, w.height || 14);
      ds.entities.add({
        id: `arena-wall-${w.x}-${w.y}`,
        rectangle: {
          coordinates: Cesium.Rectangle.fromDegrees(sw.lng, sw.lat, ne.lng, ne.lat),
          material: Cesium.Color.fromCssColorString('#2a3a34').withAlpha(0.75),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#6a8a7c'),
          height: 0,
          extrudedHeight: h,
        },
      });
    }

    staticBuilt = true;
  }

  function removeUnitParts(ds, uid) {
    const ids = unitPartIds.get(uid) || [];
    for (const id of ids) {
      const e = ds.entities.getById(id);
      if (e) ds.entities.remove(e);
    }
    unitPartIds.delete(uid);
  }

  function syncEngagementBeams(ds, Cesium, proj, state) {
    const want = new Set();
    for (const [i, sk] of (state.skirmishes || []).entries()) {
      const id = `arena-skirmish-${i}`;
      want.add(id);
      const a = state.units?.[sk.a];
      const b = state.units?.[sk.b];
      if (!a || !b) continue;
      const la = proj.localToLatLng(a.x, a.y);
      const lb = proj.localToLatLng(b.x, b.y);
      const positions = [
        Cesium.Cartesian3.fromDegrees(la.lng, la.lat, Math.max(2, a.alt)),
        Cesium.Cartesian3.fromDegrees(lb.lng, lb.lat, Math.max(2, b.alt)),
      ];
      const col = sk.kind === 'intercept'
        ? Cesium.Color.fromCssColorString('#ff6644').withAlpha(0.85)
        : sk.kind === 'suppress'
          ? Cesium.Color.fromCssColorString('#4db6ff').withAlpha(0.8)
          : Cesium.Color.fromCssColorString('#f0c14a').withAlpha(0.75);
      let ent = ds.entities.getById(id);
      if (!ent) {
        ent = ds.entities.add({
          id,
          polyline: {
            positions,
            width: 2.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.25,
              color: col,
            }),
          },
        });
      } else if (ent.polyline) {
        ent.polyline.positions = positions;
        ent.polyline.material = new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: col,
        });
      }
    }
    const drop = [];
    for (const e of ds.entities.values) {
      if (e.id?.startsWith?.('arena-skirmish-') && !want.has(e.id)) drop.push(e);
    }
    for (const e of drop) ds.entities.remove(e);
  }

  function syncUnits(proj, state, { hideObserver = true } = {}) {
    const ds = ensureSource();
    const Cesium = window.Cesium;
    if (!ds || !Cesium || !proj || !state?.units) return;

    ensureStatic(proj, state);
    spin += 0.55;

    const seen = new Set();
    for (const [uid, u] of Object.entries(state.units)) {
      if (hideObserver && uid === 'observer') {
        removeUnitParts(ds, uid);
        continue;
      }
      seen.add(uid);
      const ll = proj.localToLatLng(u.x, u.y);
      const alt = Math.max(2, u.alt || 12);
      const ids = syncQuadEntity(ds, Cesium, uid, u, ll.lng, ll.lat, alt, { spin });
      unitPartIds.set(uid, ids);
    }

    for (const uid of [...unitPartIds.keys()]) {
      if (!seen.has(uid)) removeUnitParts(ds, uid);
    }

    syncEngagementBeams(ds, Cesium, proj, state);
  }

  function syncCamera({ lat, lon, alt, headingDeg, pitchDeg }) {
    if (typeof window.updateCesiumCamera !== 'function') return;
    window.updateCesiumCamera({
      lat,
      lon,
      alt: Math.max(3, alt),
      heading: headingDeg,
      gimbalYaw: 0,
      gimbalPitch: pitchDeg,
      gimbalRoll: 0,
    });
  }

  function showCesium() {
    const el = document.getElementById('cesiumContainer');
    if (el) el.classList.remove('cesium-hidden');
  }

  return {
    syncUnits,
    syncCamera,
    clear,
    showCesium,
    viewer,
  };
}
