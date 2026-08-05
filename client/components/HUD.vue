<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDrone } from '@shared-composables/useDrone.js';

const { t } = useI18n();
const { drone } = useDrone();

const props = defineProps({
  flight: {
    type: Object,
    default: () => ({ mode: '-', vx: 0, vy: 0, yaw: 0, vz: 0 }),
  },
  camera: {
    type: Object,
    default: () => ({ mode: '-' }),
  },
  real: { type: Object, default: null },
  selectedDrone: { type: Object, default: null },
  hasControl: { type: Boolean, default: false },
  avoidRight: { type: Boolean, default: false },
});

const fmt = (value, digits = 1) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? '—'
    : Number(value).toFixed(digits);

const identity = computed(() => {
  if (props.selectedDrone) return props.selectedDrone.name || props.selectedDrone.droneId;
  return props.real ? 'Crazyflie' : t('hud.local_drone');
});
const linked = computed(() => props.real ? Boolean(props.real.linked) : props.selectedDrone?.online !== false);
const phase = computed(() => {
  if (props.real) return props.real.linked ? t('hud.manual') : t('hud.lost');
  const value = props.selectedDrone?.phase;
  return value ? t(`hud.phase_${value}`) : t('hud.manual');
});
const altitude = computed(() => {
  if (props.real) return props.real.position?.z;
  if (props.selectedDrone && Number.isFinite(Number(props.selectedDrone.z))) return props.selectedDrone.z;
  return drone.alt;
});
const battery = computed(() => {
  if (props.real) return props.real.battery?.voltage == null ? '—' : `${fmt(props.real.battery.voltage, 2)} V`;
  return props.selectedDrone?.battery == null ? '—' : `${fmt(props.selectedDrone.battery, 0)}%`;
});
const target = computed(() => props.selectedDrone?.missionTarget || t('hud.no_task'));
const progress = computed(() => Math.round(Number(props.selectedDrone?.missionProgress || 0) * 100));
</script>

<template>
  <section
    class="hud"
    :class="{ 'hud--avoid-right': avoidRight, 'hud--lost': !linked }"
    role="status"
    :aria-label="t('hud.flight_status')"
  >
    <div class="hud__identity">
      <span class="hud__beacon" :class="{ 'is-lost': !linked }" aria-hidden="true" />
      <div>
        <small>{{ real ? t('hud.real') : t('hud.selected_drone') }}</small>
        <strong>{{ identity }}</strong>
      </div>
    </div>

    <div class="hud__metric">
      <small>{{ t('hud.state') }}</small>
      <strong>{{ phase }}</strong>
    </div>
    <div class="hud__metric">
      <small>{{ t('hud.altitude') }}</small>
      <strong>{{ fmt(altitude, 2) }} <i>m</i></strong>
    </div>
    <div class="hud__metric">
      <small>{{ t('hud.battery') }}</small>
      <strong>{{ battery }}</strong>
    </div>
    <div class="hud__metric">
      <small>{{ t('hud.control') }}</small>
      <strong>{{ hasControl ? t('hud.control_owned') : t('hud.control_safe') }}</strong>
    </div>

    <div class="hud__route">
      <div class="hud__route-label">
        <span>{{ target }}</span>
        <b>{{ progress }}%</b>
      </div>
      <div class="hud__route-track">
        <span class="hud__route-pad" />
        <i><b :style="{ width: `${progress}%` }" /></i>
        <span class="hud__route-target" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.hud {
  position: absolute;
  right: 94px;
  bottom: 24px;
  left: 94px;
  z-index: 50;
  display: grid;
  grid-template-columns: minmax(150px, 1.3fr) repeat(4, minmax(80px, 0.65fr)) minmax(170px, 1fr);
  align-items: center;
  gap: 0;
  min-height: 58px;
  overflow: hidden;
  border: 1px solid rgba(109, 199, 232, 0.28);
  border-radius: 8px;
  background: rgba(7, 17, 27, 0.94);
  box-shadow: 0 13px 34px rgba(0, 0, 0, 0.34), inset 0 1px rgba(255, 255, 255, 0.05);
  color: #eaf6fb;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  pointer-events: none;
  contain: layout paint;
}

.hud--avoid-right { right: 490px; }
.hud--lost { border-color: rgba(255, 107, 95, 0.5); }

.hud__identity,
.hud__metric,
.hud__route { min-width: 0; padding: 9px 12px; }
.hud__identity,
.hud__metric { border-right: 1px solid rgba(109, 199, 232, 0.11); }
.hud__identity { display: flex; align-items: center; gap: 9px; }
.hud__identity div,
.hud__metric { min-width: 0; }

.hud small {
  display: block;
  margin-bottom: 3px;
  color: #7893a0;
  font-size: 0.52rem;
  font-weight: 750;
  letter-spacing: 0.11em;
  text-transform: uppercase;
}
.hud strong {
  display: block;
  overflow: hidden;
  color: #eaf6fb;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hud strong i { color: #7893a0; font-size: 0.58rem; font-style: normal; font-weight: 400; }

.hud__beacon { width: 9px; height: 9px; flex: 0 0 auto; border-radius: 2px; background: #5dd5a4; box-shadow: 0 0 10px rgba(93, 213, 164, 0.9); transform: rotate(45deg); }
.hud__beacon.is-lost { background: #ff6b5f; box-shadow: 0 0 10px rgba(255, 107, 95, 0.85); }

.hud__route-label { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 7px; color: #aac0ca; font-size: 0.58rem; }
.hud__route-label span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hud__route-label b { color: #6dc7e8; font-family: "SFMono-Regular", Consolas, monospace; }
.hud__route-track { display: grid; grid-template-columns: 7px 1fr 7px; align-items: center; gap: 5px; }
.hud__route-track > span { width: 7px; height: 7px; box-sizing: border-box; border: 2px solid #6dc7e8; }
.hud__route-pad { transform: rotate(45deg); }
.hud__route-target { border-radius: 50%; }
.hud__route-track i { position: relative; height: 3px; overflow: hidden; border-radius: 2px; background: #1c3442; }
.hud__route-track i b { position: absolute; inset: 0 auto 0 0; background: #5dd5a4; transition: width 120ms linear; }

@media (max-width: 980px) {
  .hud { grid-template-columns: minmax(130px, 1fr) repeat(3, minmax(72px, 0.6fr)) minmax(130px, 1fr); }
  .hud__metric:nth-of-type(5) { display: none; }
  .hud--avoid-right { right: 400px; }
}

@media (max-width: 640px) {
  .hud {
    right: 68px;
    bottom: 12px;
    left: 68px;
    grid-template-columns: 1.2fr 0.7fr 0.7fr;
    min-height: 50px;
  }
  .hud--avoid-right { top: auto; right: 68px; left: 68px; }
  .hud__metric:nth-of-type(2),
  .hud__metric:nth-of-type(5),
  .hud__route { display: none; }
  .hud__identity,
  .hud__metric { padding: 7px 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .hud,
  .hud * { animation: none !important; transition: none !important; }
}
</style>
