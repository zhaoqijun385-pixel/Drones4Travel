/**
 * Physical Crazyflie identity (channel / address / URI) from the backend.
 * Used by Real Drone Host/Viewer so the SPA matches the EEPROM airframe.
 */
import { ref, computed } from 'vue';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

const DEFAULT_IDENTITY = {
  name: 'project-cf',
  radio_uri: 'radio://0/87/2M/E7E787A91D',
  radio_channel: 87,
  radio_datarate: '2M',
  radio_address: 'E7E787A91D',
  min_fly_voltage: 3.9,
};

const identity = ref({ ...DEFAULT_IDENTITY });
let requested = false;

export function useDroneIdentity() {
  if (!requested) {
    requested = true;
    fetch(`${API_BASE}/api/drone/identity`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && data.radio_uri) identity.value = { ...DEFAULT_IDENTITY, ...data };
      })
      .catch(() => { /* keep defaults */ });
  }
  const label = computed(() => {
    const id = identity.value;
    return `${id.name} · ch${id.radio_channel}/${id.radio_datarate}/${id.radio_address}`;
  });
  return { identity, label };
}
