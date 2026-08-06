import test from 'node:test';
import assert from 'node:assert/strict';
import { useCameraCommands } from '../composables/useCameraCommands.js';
import { useCameraPhysics } from '../composables/useCameraPhysics.js';
import { useDrone } from '../composables/useDrone.js';
import { useFlightCommands } from '../composables/useFlightCommands.js';
import { useFlightPhysics } from '../composables/useFlightPhysics.js';
import { altitudeSpeedFromInput } from '../composables/flightAltitudeMath.js';

test('pan/tilt gimbal updates yaw and pitch in the same frame', () => {
  const { gimbal } = useDrone();
  const commands = useCameraCommands();
  const physics = useCameraPhysics();
  gimbal.yaw = 0;
  gimbal.pitch = 0;
  commands.onCameraMove({ mode: 'P', yaw: 1, pitch: 0.5 });
  physics.step(1);
  assert.equal(gimbal.yaw, 60);
  assert.equal(gimbal.pitch, 30);
  commands.onCameraStop();
});

test('height control uses a bounded three-metre-per-second rate', () => {
  const { drone } = useDrone();
  const commands = useFlightCommands();
  const physics = useFlightPhysics();
  drone.alt = 100;
  commands.onFlightMove({ mode: 'H', vz: 1 });
  const movement = physics.computeDesiredEnuMove(1, true);
  assert.equal(movement.z, 3);
  commands.onFlightStop();
});

test('height control speed follows joystick displacement with a deadzone', () => {
  assert.equal(altitudeSpeedFromInput(0), 0);
  assert.equal(altitudeSpeedFromInput(0.05), 0);
  assert.ok(altitudeSpeedFromInput(0.25) > 0);
  assert.ok(altitudeSpeedFromInput(0.25) < altitudeSpeedFromInput(0.75));
  assert.equal(altitudeSpeedFromInput(1), 3);
  assert.equal(altitudeSpeedFromInput(3), 3);
  assert.equal(altitudeSpeedFromInput(-1), -8);
  assert.ok(Math.abs(altitudeSpeedFromInput(-0.75)) > Math.abs(altitudeSpeedFromInput(0.75)));
});
