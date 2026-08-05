import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceMission,
  parkingPose,
  planGatherMission,
  planMission,
  planNavigateMission,
} from '../composables/fleetMissionPlanner.js';

function fleet(count = 4) {
  return Array.from({ length: count }, (_, index) => ({
    droneId: `test-${index + 1}`,
    local: false,
    online: true,
    ...parkingPose(index + 1),
  }));
}

test('navigate mission moves exactly one drone near its target', () => {
  const drones = [
    { droneId: 'local-drone', local: true, online: true, x: 0, y: 0, z: 0.12 },
    ...fleet(3),
  ];
  const mission = planNavigateMission(drones, 'test-1', 'local-drone');
  assert.equal(mission.routes.length, 1);
  assert.equal(mission.routes[0].droneId, 'test-1');
  const destination = mission.routes[0].segments.at(-1).to;
  assert.ok(Math.hypot(destination.x, destination.y) >= 4);
  assert.ok(Math.hypot(destination.x, destination.y) <= 5);
  let final = null;
  for (let elapsed = 0; elapsed < 120_000; elapsed += 100) {
    [final] = advanceMission(mission, drones, 100);
    Object.assign(drones.find((drone) => drone.droneId === final.droneId), final);
  }
  assert.equal(final.phase, 'onstation');
  assert.ok(final.z > 0.5);
});

test('gather mission assigns separated slots around the local drone', () => {
  const drones = [
    { droneId: 'local-drone', local: true, online: true, x: 0, y: 0, z: 0.12 },
    ...fleet(8),
  ];
  const mission = planGatherMission(drones, 'local-drone');
  assert.equal(mission.routes.length, 8);
  const destinations = mission.routes.map((route) => route.segments.at(-1).to);
  for (let i = 0; i < destinations.length; i += 1) {
    for (let j = i + 1; j < destinations.length; j += 1) {
      assert.ok(Math.hypot(
        destinations[i].x - destinations[j].x,
        destinations[i].y - destinations[j].y,
      ) >= 6);
    }
  }
});

test('gather mission completes without violating three-metre separation', () => {
  const drones = [
    { droneId: 'local-drone', local: true, online: true, x: 0, y: 0, z: 0.12 },
    ...fleet(8),
  ];
  const mission = planGatherMission(drones, 'local-drone');
  let minimum = Infinity;
  for (let elapsed = 0; elapsed < 240_000; elapsed += 100) {
    const states = advanceMission(mission, drones, 100);
    states.forEach((state) => Object.assign(
      drones.find((drone) => drone.droneId === state.droneId),
      state,
    ));
    for (let i = 0; i < drones.length; i += 1) {
      for (let j = i + 1; j < drones.length; j += 1) {
        minimum = Math.min(minimum, Math.hypot(
          drones[i].x - drones[j].x,
          drones[i].y - drones[j].y,
          drones[i].z - drones[j].z,
        ));
      }
    }
  }
  assert.ok(minimum >= 3);
  mission.routes.forEach((route) => {
    const drone = drones.find((item) => item.droneId === route.droneId);
    assert.equal(drone.phase, 'parked');
    assert.equal(drone.z, 0.12);
  });
});

test('parking poses are fixed and separated', () => {
  const drones = fleet(20);
  const unique = new Set(drones.map((drone) => `${drone.x}:${drone.y}:${drone.z}`));
  assert.equal(unique.size, drones.length);
  for (let i = 0; i < drones.length; i += 1) {
    for (let j = i + 1; j < drones.length; j += 1) {
      assert.ok(Math.hypot(drones[i].x - drones[j].x, drones[i].y - drones[j].y) >= 6);
    }
  }
});

for (const preset of ['inspection', 'cross']) {
  test(`${preset} mission preserves three-metre separation and returns home`, () => {
    const drones = fleet();
    const homes = new Map(drones.map((drone) => [drone.droneId, { ...drone }]));
    const mission = planMission(drones, preset);
    let minimum = Infinity;
    for (let elapsed = 0; elapsed < 360_000; elapsed += 100) {
      const states = advanceMission(mission, drones, 100);
      states.forEach((state) => Object.assign(
        drones.find((drone) => drone.droneId === state.droneId),
        state,
      ));
      for (let i = 0; i < drones.length; i += 1) {
        for (let j = i + 1; j < drones.length; j += 1) {
          minimum = Math.min(
            minimum,
            Math.hypot(
              drones[i].x - drones[j].x,
              drones[i].y - drones[j].y,
              drones[i].z - drones[j].z,
            ),
          );
        }
      }
    }
    assert.ok(minimum >= 3);
    drones.forEach((drone) => {
      const home = homes.get(drone.droneId);
      assert.equal(drone.phase, 'parked');
      assert.ok(Math.abs(drone.x - home.x) < 0.001);
      assert.ok(Math.abs(drone.y - home.y) < 0.001);
      assert.ok(Math.abs(drone.z - home.z) < 0.001);
    });
  });
}
