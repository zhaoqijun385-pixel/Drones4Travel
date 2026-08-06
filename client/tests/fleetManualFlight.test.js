import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceManualFlight,
  applyManualFlightMove,
  DEMO_AUTO_SPEED_MPS,
  DEMO_GROUND_HEIGHT,
} from '../composables/fleetManualFlight.js';

test('manual FPV takeoff climbs continuously at the original auto-flight speed', () => {
  let drone = {
    z: 0.12,
    autoTargetZ: 100,
    autoAction: 'takeoff',
  };
  const samples = [];
  for (let elapsed = 0; elapsed < 20_000 && drone.autoTargetZ != null; elapsed += 100) {
    const next = advanceManualFlight(drone, 100, 150);
    drone = { ...drone, ...next };
    samples.push(drone.z);
  }
  assert.equal(DEMO_AUTO_SPEED_MPS, 8);
  assert.ok(samples[0] > 0.12 && samples[0] < 100);
  assert.ok(samples.every((value, index) => index === 0 || value >= samples[index - 1]));
  assert.equal(drone.z, 100);
  assert.equal(drone.alt, 250);
  assert.equal(drone.phase, 'holding');
  assert.equal(drone.autoTargetZ, null);
});

test('manual landing descends continuously and finishes parked', () => {
  let drone = {
    z: 20,
    autoTargetZ: 0.12,
    autoAction: 'land',
  };
  const first = advanceManualFlight(drone, 100, 150);
  assert.ok(first.z < 20 && first.z > 0.12);
  assert.equal(first.phase, 'landing');
  drone = { ...drone, ...first };
  for (let elapsed = 0; elapsed < 10_000 && drone.autoTargetZ != null; elapsed += 100) {
    drone = { ...drone, ...advanceManualFlight(drone, 100, 150) };
  }
  assert.equal(drone.z, 0.12);
  assert.equal(drone.phase, 'parked');
  assert.equal(drone.autoTargetZ, null);
});

test('remote manual movement keeps its own altitude and never snaps to local ground', () => {
  const next = applyManualFlightMove(
    { x: 4, y: 8, z: 100, yaw: 350, autoTargetZ: 100, autoAction: 'takeoff' },
    { x: 2, y: -3, z: -1 },
    150,
    20,
  );
  assert.equal(next.x, 6);
  assert.equal(next.y, 5);
  assert.equal(next.z, 99);
  assert.equal(next.alt, 249);
  assert.equal(next.yaw, 10);
  assert.equal(next.autoTargetZ, null);
  assert.equal(next.autoAction, '');

  const landed = applyManualFlightMove({ z: DEMO_GROUND_HEIGHT }, { z: -50 }, 150);
  assert.equal(landed.z, DEMO_GROUND_HEIGHT);
});
