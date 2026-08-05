import { useDrone } from './useDrone.js';
import { useCameraCommands } from './useCameraCommands.js';

const ROTATION_SPEED = 60.0; // degrees per second at full deflection

export function useCameraPhysics() {
  const { gimbal } = useDrone();
  const { cameraCmd, activeCameraMode, camera } = useCameraCommands();

  function step(dt, { applyMovement = true } = {}) {
    if (!applyMovement) return;

    // P -> natural two-axis pan/tilt, X -> optional roll trim.
    if (activeCameraMode.value === 'P') {
      gimbal.yaw += cameraCmd.yaw * ROTATION_SPEED * dt;
      gimbal.yaw = ((gimbal.yaw + 540) % 360) - 180;
      gimbal.pitch += cameraCmd.pitch * ROTATION_SPEED * dt;
      gimbal.pitch = Math.max(-85, Math.min(45, gimbal.pitch));
      camera.yaw = cameraCmd.yaw;
      camera.pitch = cameraCmd.pitch;
      camera.roll = 0;
    } else if (activeCameraMode.value === 'X') {
      gimbal.roll += cameraCmd.roll * ROTATION_SPEED * dt;
      camera.yaw = 0;
      camera.pitch = 0;
      camera.roll = cameraCmd.roll;
    }
  }

  return { step };
}
