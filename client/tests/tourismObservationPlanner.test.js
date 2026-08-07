import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOURISM_GAZETTEER,
  buildTourismObservationPoints,
  planTourismObservationMission,
  advanceTourismMission,
  resolveTourismTarget,
  searchTourismPlaces,
  destinationFromBearing,
  bearingBetween,
} from '../composables/tourismObservationPlanner.js';

function fleet(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    droneId: `demo-${index + 1}`,
    local: false,
    online: true,
  }));
}

test('gazetteer contains a rich set of places', () => {
  assert.ok(TOURISM_GAZETTEER.length >= 100, `expected >= 100 places, got ${TOURISM_GAZETTEER.length}`);
  const ids = new Set(TOURISM_GAZETTEER.map((p) => p.id));
  assert.equal(ids.size, TOURISM_GAZETTEER.length, 'place ids must be unique');
  TOURISM_GAZETTEER.forEach((place) => {
    assert.ok(Number.isFinite(place.lat), `${place.id} lat`);
    assert.ok(Number.isFinite(place.lon), `${place.id} lon`);
  });
});

test('searchTourismPlaces matches Chinese names and English aliases', () => {
  assert.ok(searchTourismPlaces('故宫').some((p) => p.name === '故宫博物院'));
  assert.ok(searchTourismPlaces('Eiffel Tower').some((p) => p.id === 'eiffel-tower'));
  assert.ok(searchTourismPlaces('Mount Tai').some((p) => p.id === 'mount-tai'));
  assert.ok(searchTourismPlaces('湖').length > 0, 'partial match works');
  assert.equal(searchTourismPlaces('').length, 0);
  assert.equal(searchTourismPlaces('   ').length, 0);
});

test('resolveTourismTarget handles gazetteer, aliases and coordinates', () => {
  const westLake = resolveTourismTarget('西湖');
  assert.ok(westLake);
  assert.equal(westLake.name, '杭州西湖');
  assert.ok(Math.abs(westLake.lat - 30.247) < 0.001);

  const coords = resolveTourismTarget('30.2470, 120.1495');
  assert.ok(coords);
  assert.ok(Math.abs(coords.lat - 30.247) < 1e-4);
  assert.ok(Math.abs(coords.lon - 120.1495) < 1e-4);

  assert.equal(resolveTourismTarget(''), null);
  assert.equal(resolveTourismTarget('一个不存在的地点xyz'), null);
  assert.equal(resolveTourismTarget('999, 999'), null);
});

test('buildTourismObservationPoints produces center plus ring points', () => {
  const points = buildTourismObservationPoints(
    { lat: 31.24, lon: 121.49 },
    { photoCount: 5, radiusM: 180, minAltM: 80 },
  );
  assert.equal(points.length, 5);
  assert.equal(points[0].id, 'center');
  assert.ok(points[0].alt >= 80);
  points.slice(1).forEach((point) => {
    assert.ok(point.alt >= 80, 'ring altitude respects minAltM');
    assert.ok(point.radiusM > 0);
  });
});

test('buildTourismObservationPoints clamps radius and altitude', () => {
  const points = buildTourismObservationPoints(
    { lat: 0, lon: 0 },
    { photoCount: 3, radiusM: 10, minAltM: 5 },
  );
  assert.ok(points[1].radiusM >= 40, 'radius clamps to minimum 40m');
  assert.ok(points[0].alt >= 20, 'altitude clamps to minimum 20m');
});

test('planTourismObservationMission distributes routes across drones', () => {
  const mission = planTourismObservationMission(
    fleet(3),
    { lat: 31.24, lon: 121.49, name: 'Test target' },
    { photoCount: 5 },
  );
  assert.ok(mission);
  assert.equal(mission.kind, 'tourism');
  assert.equal(mission.photoCount, 5);
  assert.equal(mission.routes.length, 5);
  assert.equal(mission.target.name, 'Test target');
  const droneIds = new Set(mission.routes.map((route) => route.droneId));
  assert.ok(droneIds.size <= 3);
  assert.equal(mission.completed, false);
  assert.equal(mission.observations.length, 0);
});

test('advanceTourismMission records every observation and completes', () => {
  const mission = planTourismObservationMission(
    fleet(3),
    { lat: 31.24, lon: 121.49, name: 'T' },
    { photoCount: 5 },
  );
  let ticks = 0;
  while (!mission.completed && ticks < 20000) {
    advanceTourismMission(mission, 100);
    ticks += 1;
  }
  assert.equal(mission.completed, true, 'mission completes');
  assert.equal(mission.observations.length, 5, 'one observation per point');
  const labels = new Set(mission.observations.map((o) => o.label));
  assert.equal(labels.size, 5);
});

test('destinationFromBearing and bearingBetween are consistent', () => {
  const origin = { lat: 31.24, lon: 121.49 };
  const north = destinationFromBearing(origin.lat, origin.lon, 1000, 0);
  assert.ok(north.lat > origin.lat, 'bearing 0 moves north');
  const back = bearingBetween(north.lat, north.lon, origin.lat, origin.lon);
  assert.ok(Math.abs(back) > 179, `return bearing should be ~180, got ${back}`);
});
