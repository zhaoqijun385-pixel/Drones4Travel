<script setup>
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useDrone } from '@shared-composables/useDrone.js';

const { drone, gimbal } = useDrone();
const { t } = useI18n();

const props = defineProps({
  flight: {
    type: Object,
    default: () => ({ mode: '-', vx: 0, vy: 0, yaw: 0, vz: 0 }),
  },
  camera: {
    type: Object,
    default: () => ({ mode: '-', yaw: 0, pitch: 0, roll: 0 }),
  },
  // Real-drone telemetry (useDroneTelemetry). When set, the HUD shows the
  // physical drone's live state instead of the simulator rows.
  real: {
    type: Object,
    default: null,
  },
  // The OpenClaw panel occupies the lower-right corner on AerialView.
  avoidRight: {
    type: Boolean,
    default: false,
  },
});

// Null-safe number formatting ('-' until the first frame of a category).
const fmt = (v, digits = 2) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '-' : Number(v).toFixed(digits);

const isLinked = computed(() => !props.real || props.real.linked);
const linkLabel = computed(() => {
  if (!props.real) return t('hud.simulated');
  return props.real.linked ? t('hud.live') : t('hud.lost');
});

const linkRate = computed(() => {
  if (!props.real?.linked) return '-';
  return `${fmt(props.real.hz, 1)} ${t('hud.hz')}`;
});
</script>

<template>
  <section
    class="hud"
    :class="{
      'hud--real': real,
      'hud--sim': !real,
      'hud--avoid-right': avoidRight,
      'hud--lost': real && !real.linked,
    }"
    role="status"
    :aria-label="t('hud.telemetry')"
  >
    <header class="hud-header">
      <div class="hud-heading">
        <span class="hud-signal" aria-hidden="true"><i /></span>
        <span class="hud-eyebrow">{{ t('hud.telemetry') }}</span>
        <span class="hud-mode">{{ real ? t('hud.real') : t('hud.simulation') }}</span>
      </div>
      <div class="hud-link" :class="{ 'hud-link--lost': !isLinked }">
        <span class="hud-link__dot" aria-hidden="true" />
        <span>{{ linkLabel }}</span>
        <span v-if="real" class="hud-link__rate">{{ linkRate }}</span>
      </div>
    </header>

    <!-- Physical Crazyflie telemetry. Keep the three-axis values aligned so
         they can be scanned quickly without expanding the panel. -->
    <div v-if="real" class="hud-grid hud-grid--real">
      <section class="hud-card hud-card--wide">
        <div class="hud-card__title">{{ t('hud.position') }} <span>m</span></div>
        <div class="hud-axis-grid">
          <div class="hud-axis"><span>X</span><strong>{{ fmt(real.position?.x) }}</strong></div>
          <div class="hud-axis"><span>Y</span><strong>{{ fmt(real.position?.y) }}</strong></div>
          <div class="hud-axis"><span>Z</span><strong>{{ fmt(real.position?.z) }}</strong></div>
        </div>
      </section>

      <section class="hud-card hud-card--wide">
        <div class="hud-card__title">{{ t('hud.attitude') }} <span>°</span></div>
        <div class="hud-axis-grid">
          <div class="hud-axis"><span>{{ t('hud.yaw_short') }}</span><strong>{{ fmt(real.attitude?.yaw, 1) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.pitch_short') }}</span><strong>{{ fmt(real.attitude?.pitch, 1) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.roll_short') }}</span><strong>{{ fmt(real.attitude?.roll, 1) }}</strong></div>
        </div>
      </section>

      <section class="hud-card hud-card--power">
        <div class="hud-card__title">{{ t('hud.power') }}</div>
        <div class="hud-primary-value">{{ fmt(real.battery?.voltage) }} <small>V</small></div>
        <div class="hud-card__hint">{{ t('hud.battery') }}</div>
      </section>
    </div>

    <!-- Simulator telemetry. The same card language is used, but the
         existing flight, camera, position and gimbal values remain intact. -->
    <div v-else class="hud-grid hud-grid--sim">
      <section class="hud-card hud-card--flight">
        <div class="hud-card__title">{{ t('hud.flight') }} <b>{{ flight.mode }}</b></div>
        <div class="hud-card__line">
          <span>{{ t('hud.mode') }}</span><strong>{{ flight.mode }}</strong>
        </div>
        <div class="hud-card__line hud-card__line--muted">
          <template v-if="flight.mode === 'M'">vx {{ fmt(flight.vx) }} · vy {{ fmt(flight.vy) }}</template>
          <template v-else-if="flight.mode === 'R'">{{ t('hud.yaw_short') }} {{ fmt(flight.yaw) }}</template>
          <template v-else-if="flight.mode === 'H'">vz {{ fmt(flight.vz) }}</template>
          <template v-else>—</template>
        </div>
      </section>

      <section class="hud-card hud-card--flight">
        <div class="hud-card__title">{{ t('hud.camera') }} <b>{{ camera.mode }}</b></div>
        <div class="hud-card__line">
          <span>{{ t('hud.mode') }}</span><strong>{{ camera.mode }}</strong>
        </div>
        <div class="hud-card__line hud-card__line--muted">
          <template v-if="camera.mode === 'Z'">{{ t('hud.yaw_short') }} {{ fmt(camera.yaw) }}</template>
          <template v-else-if="camera.mode === 'Y'">{{ t('hud.pitch_short') }} {{ fmt(camera.pitch) }}</template>
          <template v-else-if="camera.mode === 'X'">{{ t('hud.roll_short') }} {{ fmt(camera.roll) }}</template>
          <template v-else>—</template>
        </div>
      </section>

      <section class="hud-card hud-card--wide">
        <div class="hud-card__title">{{ t('hud.position') }} <span>° / m</span></div>
        <div class="hud-axis-grid hud-axis-grid--sim">
          <div class="hud-axis"><span>{{ t('hud.lat_short') }}</span><strong>{{ fmt(drone.lat, 4) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.lon_short') }}</span><strong>{{ fmt(drone.lon, 4) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.alt_short') }}</span><strong>{{ fmt(drone.alt, 2) }}</strong></div>
        </div>
      </section>

      <section class="hud-card hud-card--wide">
        <div class="hud-card__title">{{ t('hud.direction') }} <span>°</span></div>
        <div class="hud-axis-grid">
          <div class="hud-axis"><span>{{ t('hud.yaw_short') }}</span><strong>{{ fmt(drone.heading, 1) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.pitch_short') }}</span><strong>0.0</strong></div>
          <div class="hud-axis"><span>{{ t('hud.roll_short') }}</span><strong>0.0</strong></div>
        </div>
      </section>

      <section class="hud-card hud-card--gimbal">
        <div class="hud-card__title">{{ t('hud.gimbal') }} <span>°</span></div>
        <div class="hud-axis-grid">
          <div class="hud-axis"><span>{{ t('hud.yaw_short') }}</span><strong>{{ fmt(gimbal.yaw, 1) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.pitch_short') }}</span><strong>{{ fmt(gimbal.pitch, 1) }}</strong></div>
          <div class="hud-axis"><span>{{ t('hud.roll_short') }}</span><strong>{{ fmt(gimbal.roll, 1) }}</strong></div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.hud {
  position: absolute;
  left: 50%;
  bottom: 48px;
  z-index: 50;
  width: min(640px, calc(100vw - 188px));
  transform: translateX(-50%);
  box-sizing: border-box;
  padding: 10px;
  overflow: hidden;
  border: 1px solid rgba(74, 222, 128, 0.25);
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(5, 16, 13, 0.92), rgba(3, 10, 16, 0.88));
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(10px);
  color: #dcfce7;
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.76rem;
  line-height: 1.25;
  pointer-events: none;
  contain: layout paint;
}

.hud--lost {
  border-color: rgba(248, 113, 113, 0.42);
}

/* OpenClaw is fixed to the lower-right. Move the HUD into the remaining
   lower band only while that panel is visible. */
.hud--avoid-right {
  right: 500px;
  left: 94px;
  width: auto;
  transform: none;
}

.hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 26px;
  padding: 0 3px 8px;
  border-bottom: 1px solid rgba(134, 239, 172, 0.16);
}

.hud-heading,
.hud-link {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.hud-signal {
  display: inline-grid;
  width: 13px;
  height: 13px;
  place-items: center;
  border: 1px solid rgba(74, 222, 128, 0.65);
  border-radius: 50%;
}

.hud-signal i,
.hud-link__dot {
  display: block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px rgba(74, 222, 128, 0.9);
}

.hud-eyebrow {
  color: #bbf7d0;
  font-size: 0.64rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hud-mode {
  padding: 3px 6px;
  border: 1px solid rgba(134, 239, 172, 0.24);
  border-radius: 4px;
  color: #86efac;
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hud-link {
  color: #86efac;
  font-size: 0.68rem;
  font-weight: 700;
  white-space: nowrap;
}

.hud-link__rate {
  color: rgba(220, 252, 231, 0.56);
  font-weight: 400;
}

.hud-link--lost,
.hud-link--lost .hud-link__rate {
  color: #fca5a5;
}

.hud-link--lost .hud-link__dot {
  background: #f87171;
  box-shadow: 0 0 8px rgba(248, 113, 113, 0.85);
}

.hud-grid {
  display: grid;
  gap: 7px;
  padding-top: 8px;
}

.hud-grid--real {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 112px;
}

.hud-grid--sim {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.hud-card {
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid rgba(134, 239, 172, 0.12);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
}

.hud-card--flight {
  grid-column: span 2;
}

.hud-card--wide {
  grid-column: span 2;
}

.hud-card--gimbal {
  grid-column: span 2;
}

.hud-card--power {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.hud-card__title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
  color: #86efac;
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hud-card__title span {
  color: rgba(220, 252, 231, 0.42);
  font-size: 0.58rem;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}

.hud-card__title b {
  color: #f0fdf4;
  font-size: 0.8rem;
}

.hud-axis-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.hud-axis {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.hud-axis span,
.hud-card__line span,
.hud-card__hint {
  color: rgba(220, 252, 231, 0.48);
  font-size: 0.58rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.hud-axis strong,
.hud-card__line strong,
.hud-primary-value {
  overflow: hidden;
  color: #f0fdf4;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-card__line {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 5px;
}

.hud-card__line--muted {
  display: block;
  overflow: hidden;
  color: rgba(220, 252, 231, 0.66);
  font-size: 0.66rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hud-primary-value {
  margin: 1px 0 5px;
  color: #bbf7d0;
  font-size: 1.05rem;
}

.hud-primary-value small {
  color: rgba(220, 252, 231, 0.55);
  font-size: 0.62rem;
  font-weight: 400;
}

.hud-card__hint {
  text-transform: none;
}

@media (max-width: 900px) {
  .hud {
    width: min(560px, calc(100vw - 144px));
  }

  .hud--avoid-right {
    right: 410px;
    left: 76px;
    width: auto;
  }

  .hud-grid--real {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hud-card--power {
    grid-column: span 2;
    min-height: 52px;
  }
}

@media (max-width: 640px) {
  .hud {
    right: 68px;
    bottom: 40px;
    left: 68px;
    width: auto;
    transform: none;
    padding: 8px;
    font-size: 0.68rem;
  }

  .hud--avoid-right {
    right: 68px;
    left: 68px;
    width: auto;
    top: 24px;
    bottom: auto;
  }

  .hud-header {
    gap: 6px;
    padding-bottom: 6px;
  }

  .hud-eyebrow {
    font-size: 0.56rem;
  }

  .hud-mode {
    display: none;
  }

  .hud-grid {
    gap: 5px;
    padding-top: 6px;
  }

  .hud-card {
    padding: 6px 7px;
  }

  .hud-card__title {
    margin-bottom: 5px;
    font-size: 0.55rem;
  }

  .hud-axis-grid {
    gap: 4px;
  }

  .hud-axis strong,
  .hud-card__line strong {
    font-size: 0.68rem;
  }

  .hud-axis span,
  .hud-card__line span,
  .hud-card__hint {
    font-size: 0.5rem;
  }

  .hud-card--flight,
  .hud-card--wide,
  .hud-card--gimbal {
    grid-column: span 3;
  }

  .hud-grid--real .hud-card--wide,
  .hud-grid--real .hud-card--power {
    grid-column: span 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .hud,
  .hud * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
