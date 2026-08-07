/**
 * Local arena meters (x eastward, y southward from map top-left in sim)
 * → WGS84 around a fixed origin. Display-only; sim stays in meters.
 */

const METERS_PER_DEG_LAT = 111320;

export function createArenaProjection(originLat, originLng, mapW, mapH) {
  const cos = Math.cos((originLat * Math.PI) / 180);
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.max(0.2, cos);

  function localToLatLng(x, y) {
    const east = x - mapW / 2;
    const north = mapH / 2 - y;
    return {
      lat: originLat + north / METERS_PER_DEG_LAT,
      lng: originLng + east / metersPerDegLng,
    };
  }

  return { localToLatLng, originLat, originLng, mapW, mapH };
}
