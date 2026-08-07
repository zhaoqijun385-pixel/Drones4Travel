/**
 * Procedural Cesium quadcopter (multi-entity) — looks like a real airframe in 3D,
 * no external glTF dependency. Parts: body + 4 arms + 4 rotor discs (spin).
 */

import { DRONE_COLORS } from '../2d_map/droneModels.js';

export { DRONE_COLORS };

export function factionColor(unit) {
  if (unit.faction === 'red') return DRONE_COLORS.red;
  if (unit.faction === 'vip') return DRONE_COLORS.vip;
  if (unit.faction === 'observer') return '#b8f0d0';
  return DRONE_COLORS.blue;
}

export function unitLabel(uid, unit) {
  if (unit.role === 'lead') return 'B1';
  if (unit.role === 'wing') return 'B2';
  if (unit.role === 'guard') return 'BG';
  if (unit.faction === 'vip') return 'V';
  if (unit.faction === 'observer') return 'O';
  if (uid === 'red_a') return 'R1';
  if (uid === 'red_b') return 'R2';
  if (uid === 'red_c') return 'RJ';
  if (uid === 'red_d') return 'RA';
  return uid.slice(0, 2).toUpperCase();
}

/** Local offsets in meters (east, north, up) before yaw — X-frame quad. */
const ARM = 0.95;
const PARTS = [
  { key: 'body', east: 0, north: 0, up: 0, kind: 'box', size: [0.55, 0.28, 0.72] },
  { key: 'cam', east: 0, north: 0.38, up: -0.12, kind: 'box', size: [0.22, 0.16, 0.22] },
  { key: 'armNE', east: ARM * 0.55, north: ARM * 0.55, up: 0.02, kind: 'box', size: [0.9, 0.08, 0.1] },
  { key: 'armNW', east: -ARM * 0.55, north: ARM * 0.55, up: 0.02, kind: 'box', size: [0.9, 0.08, 0.1] },
  { key: 'armSE', east: ARM * 0.55, north: -ARM * 0.55, up: 0.02, kind: 'box', size: [0.9, 0.08, 0.1] },
  { key: 'armSW', east: -ARM * 0.55, north: -ARM * 0.55, up: 0.02, kind: 'box', size: [0.9, 0.08, 0.1] },
  { key: 'rotNE', east: ARM, north: ARM, up: 0.12, kind: 'rotor' },
  { key: 'rotNW', east: -ARM, north: ARM, up: 0.12, kind: 'rotor' },
  { key: 'rotSE', east: ARM, north: -ARM, up: 0.12, kind: 'rotor' },
  { key: 'rotSW', east: -ARM, north: -ARM, up: 0.12, kind: 'rotor' },
];

function scaleFor(unit) {
  if (unit.faction === 'vip') return 2.4;
  if (unit.faction === 'observer') return 2.6;
  if (unit.role === 'jammer' || unit.role === 'lead') return 2.2;
  return 2.0;
}

function cssToCesiumColor(Cesium, css, alpha = 1) {
  const c = Cesium.Color.fromCssColorString(css);
  return c.withAlpha(alpha);
}

function localToWorld(Cesium, lng, lat, alt, east, north, up, yawRad) {
  const center = Cesium.Cartesian3.fromDegrees(lng, lat, alt);
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center);
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  // yaw 0 = +east in sim; rotate local EN offsets
  const e = east * c - north * s;
  const n = east * s + north * c;
  const local = new Cesium.Cartesian3(e, n, up);
  return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
}

function hprOrientation(Cesium, lng, lat, alt, yawRad, extraYaw = 0) {
  const center = Cesium.Cartesian3.fromDegrees(lng, lat, alt);
  // Cesium heading: 0 = north; sim yaw 0 ≈ east → heading = yaw - 90°
  const heading = yawRad - Math.PI / 2 + extraYaw;
  const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
  return Cesium.Transforms.headingPitchRollQuaternion(center, hpr);
}

/**
 * Create or update a multi-part quadcopter for one unit.
 * @returns {string[]} entity ids owned by this unit
 */
export function syncQuadEntity(ds, Cesium, uid, unit, lng, lat, alt, { spin = 0 } = {}) {
  const ids = [];
  const yaw = unit.yaw || 0;
  const s = scaleFor(unit);
  const color = factionColor(unit);
  const bodyColor = cssToCesiumColor(Cesium, color, 0.95);
  const dark = cssToCesiumColor(Cesium, '#1a2220', 0.98);
  const rotorColor = cssToCesiumColor(Cesium, '#c8d4ce', 0.55);

  for (const part of PARTS) {
    const id = `arena-unit-${uid}-${part.key}`;
    ids.push(id);
    let ent = ds.entities.getById(id);
    const pe = part.east * s;
    const pn = part.north * s;
    const pu = part.up * s;
    const pos = localToWorld(Cesium, lng, lat, alt, pe, pn, pu, yaw);

    if (part.kind === 'box') {
      const dims = new Cesium.Cartesian3(part.size[0] * s, part.size[1] * s, part.size[2] * s);
      const isArm = part.key.startsWith('arm');
      const mat = part.key === 'cam' ? dark : (isArm ? dark : bodyColor);
      // Arms along diagonal — rotate 45° around up
      const armYaw = isArm ? Math.PI / 4 : 0;
      const orient = hprOrientation(Cesium, lng, lat, alt, yaw, armYaw);
      if (!ent) {
        ent = ds.entities.add({
          id,
          position: pos,
          orientation: orient,
          box: {
            dimensions: dims,
            material: mat,
            outline: true,
            outlineColor: cssToCesiumColor(Cesium, '#0a100e', 0.8),
          },
        });
      } else {
        ent.position = pos;
        ent.orientation = orient;
        if (ent.box) {
          ent.box.dimensions = dims;
          ent.box.material = mat;
        }
      }
    } else if (part.kind === 'rotor') {
      const orient = hprOrientation(Cesium, lng, lat, alt, yaw, spin);
      const r = 0.42 * s;
      if (!ent) {
        ent = ds.entities.add({
          id,
          position: pos,
          orientation: orient,
          cylinder: {
            length: 0.04 * s,
            topRadius: r,
            bottomRadius: r,
            material: rotorColor,
            slices: 16,
          },
        });
      } else {
        ent.position = pos;
        ent.orientation = orient;
      }
    }
  }

  // Label above
  const labelId = `arena-unit-${uid}-label`;
  ids.push(labelId);
  let lab = ds.entities.getById(labelId);
  const labPos = localToWorld(Cesium, lng, lat, alt, 0, 0, 0.9 * s, yaw);
  const text = unitLabel(uid, unit);
  if (!lab) {
    lab = ds.entities.add({
      id: labelId,
      position: labPos,
      label: {
        text,
        font: 'bold 13px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        showBackground: true,
        backgroundColor: cssToCesiumColor(Cesium, color, 0.55),
        backgroundPadding: new Cesium.Cartesian2(6, 4),
        pixelOffset: new Cesium.Cartesian2(0, -8),
        scaleByDistance: new Cesium.NearFarScalar(40, 1.15, 400, 0.55),
      },
    });
  } else {
    lab.position = labPos;
    if (lab.label) lab.label.text = text;
  }

  return ids;
}
