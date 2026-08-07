<script setup>
/**
 * Mission Arena — multi-UAV sim with observer FPV on shared Cesium
 * (same Google Photorealistic 3D Tiles stack as Aerial / Node 1).
 * Google Maps 2D cannot free-look in 3D (tilt only 0/45); Cesium can.
 * Does NOT write shared useDrone() physics state.
 */
import { ref, computed, onMounted, onUnmounted, h, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ViewComposer from '@shared/_ViewComposer.vue';
import { createArenaProjection } from '@/2d_map/arenaGeo.js';
import { createArenaCesiumController } from '@/arena/useArenaCesium.js';
import { useDockRegistry } from '@shared-composables/useDockRegistry.js';
import { usePageRegistry } from '@shared-composables/usePageRegistry.js';
import { useAppSettings } from '@shared-composables/useAppSettings.js';
import { useConnectionStatus, checkCesiumConnection } from '@shared-composables/useConnectionStatus.js';
import { useFlightCommands } from '@shared-composables/useFlightCommands.js';
import { useCameraCommands } from '@shared-composables/useCameraCommands.js';
import DockMenuButton from '@shared/DockMenuButton.vue';
import ConnectionError from '@shared/ConnectionError.vue';

const { t } = useI18n();
const { leftItems, rightItems, registerLeft, registerRight, clear } = useDockRegistry();
const { pages, registerPage, unregisterPage } = usePageRegistry();
const { settings } = useAppSettings();
const { cesiumReady, cesiumError } = useConnectionStatus();

const {
  flight,
  flightCmd,
  showFlight,
  toggleFlight,
  onFlightMove,
  onFlightStop,
  onFlightModeChange,
  startKeyboard: startFlightKeyboard,
  stopKeyboard: stopFlightKeyboard,
} = useFlightCommands();

const {
  camera,
  cameraCmd,
  showCamera,
  toggleCamera,
  onCameraMove,
  onCameraStop,
  onCameraModeChange,
} = useCameraCommands();

const showConnectionError = computed(() => !cesiumReady.value);
const connectionMessage = computed(() => cesiumError.value || 'Cesium / 3D tiles not ready.');

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:8000/api/sim/arena'
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/sim/arena`;

const originLat = computed(() => Number(settings.defaultLat) || 37.4286);
const originLon = computed(() => Number(settings.defaultLon) || -122.1699);

const controlMode = ref('observer');
const followCam = ref(true);
const showBrief = ref(true);

/** Free look (degrees). pitch: 0 horizon … -90 nadir — true 3D like Aerial. */
const lookYaw = ref(0);
const lookPitch = ref(-38);

const state = ref(null);
const connected = ref(false);
const keys = ref({
  w: false, a: false, s: false, d: false,
  r: false, f: false, q: false, e: false,
});

const heldExtra = ref({
  r: false, f: false, q: false, e: false,
  arrowleft: false, arrowright: false, arrowup: false, arrowdown: false,
});

const cesium = createArenaCesiumController();
let ws = null;
let inputTimer = null;
let connectionCheckInterval = null;
let rafId = 0;
let lastFrameTs = 0;

const STICK_DEADZONE = 0.35;
const LOOK_YAW_RATE = 90;
const LOOK_PITCH_RATE = 55;

const phaseLabel = computed(() => {
  const p = state.value?.phase || 'idle';
  return t(`missionarenaview.phase_${p}`, p);
});
const stageLabel = computed(() => {
  const s = state.value?.stage || 'contact';
  return t(`missionarenaview.stage_${s}`, s);
});
const timeLeft = computed(() => {
  if (!state.value) return '—';
  return Math.max(0, state.value.time_limit - state.value.t).toFixed(1);
});
const unitCount = computed(() => Object.keys(state.value?.units || {}).length);
const obsAlt = computed(() => Math.round(state.value?.units?.observer?.alt ?? 0));
const routeLabel = computed(() => (state.value?.route === 'alt'
  ? t('missionarenaview.route_alt')
  : t('missionarenaview.route_main')));

function send(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function pushInput() {
  send({ type: 'input', keys: { ...keys.value }, control_mode: controlMode.value });
}

function setMode(mode) {
  controlMode.value = mode;
  send({ type: 'set_mode', control_mode: mode });
  if (mode === 'observer') followCam.value = true;
}

function holdExtra(key, down) {
  if (!(key in heldExtra.value)) return;
  heldExtra.value[key] = !!down;
}

function applyFlightToKeys() {
  const cmd = flightCmd;
  const next = {
    w: false, a: false, s: false, d: false,
    r: false, f: false, q: false, e: false,
  };
  if (showFlight.value) {
    if (cmd.mode === 'M') {
      next.w = cmd.vy > STICK_DEADZONE;
      next.s = cmd.vy < -STICK_DEADZONE;
      next.d = cmd.vx > STICK_DEADZONE;
      next.a = cmd.vx < -STICK_DEADZONE;
    } else if (cmd.mode === 'R') {
      next.q = cmd.yaw < -STICK_DEADZONE;
      next.e = cmd.yaw > STICK_DEADZONE;
    } else if (cmd.mode === 'H') {
      next.r = cmd.vz > STICK_DEADZONE;
      next.f = cmd.vz < -STICK_DEADZONE;
    }
  }
  const ex = heldExtra.value;
  if (ex.r) next.r = true;
  if (ex.f) next.f = true;
  if (ex.q) next.q = true;
  if (ex.e) next.e = true;
  keys.value = next;

  flight.mode = next.r || next.f ? 'H'
    : ((next.q || next.e) && !(next.w || next.a || next.s || next.d) ? 'R' : cmd.mode);
  flight.vx = next.d ? 3 : next.a ? -3 : cmd.vx;
  flight.vy = next.w ? 3 : next.s ? -3 : cmd.vy;
  flight.yaw = next.e ? 3 : next.q ? -3 : cmd.yaw;
  flight.vz = next.r ? 3 : next.f ? -3 : cmd.vz;
}

/** GIMBAL → continuous Cesium look (same idea as Aerial gimbal). */
function applyGimbalLook(dt) {
  if (!showCamera.value) {
    camera.yaw = 0;
    camera.pitch = 0;
    camera.roll = 0;
    return;
  }
  const cmd = cameraCmd;
  const ex = heldExtra.value;
  let yawCmd = 0;
  let pitchCmd = 0;

  if (cmd.mode === 'Z') yawCmd += cmd.yaw || 0;
  if (cmd.mode === 'Y') pitchCmd += cmd.pitch || 0;
  if (ex.arrowleft) yawCmd -= 1;
  if (ex.arrowright) yawCmd += 1;
  // Up = look toward horizon (increase pitch), down = look down (decrease)
  if (ex.arrowup) pitchCmd += 1;
  if (ex.arrowdown) pitchCmd -= 1;

  camera.mode = Math.abs(pitchCmd) > Math.abs(yawCmd) && pitchCmd ? 'Y' : 'Z';
  camera.yaw = yawCmd;
  camera.pitch = pitchCmd;
  camera.roll = 0;

  if (yawCmd) {
    lookYaw.value = (((lookYaw.value + yawCmd * LOOK_YAW_RATE * dt) % 360) + 360) % 360;
  }
  if (pitchCmd) {
    lookPitch.value = Math.max(-89, Math.min(-5, lookPitch.value + pitchCmd * LOOK_PITCH_RATE * dt));
  }
}

function syncScene() {
  const s = state.value;
  if (!s?.map || !s.units) return;
  const proj = createArenaProjection(originLat.value, originLon.value, s.map.w, s.map.h);
  const hideObs = followCam.value && controlMode.value === 'observer';
  cesium.syncUnits(proj, s, { hideObserver: hideObs });

  if (!followCam.value) return;
  const focus = controlMode.value === 'blue' ? s.units.blue_lead : s.units.observer;
  if (!focus) return;
  const ll = proj.localToLatLng(focus.x, focus.y);
  const craftYawDeg = ((focus.yaw || 0) * 180) / Math.PI;
  cesium.syncCamera({
    lat: ll.lat,
    lon: ll.lng,
    alt: focus.alt || 40,
    headingDeg: craftYawDeg + lookYaw.value,
    pitchDeg: lookPitch.value,
  });
}

function frameLoop(ts) {
  rafId = requestAnimationFrame(frameLoop);
  const dt = lastFrameTs ? Math.min(0.05, (ts - lastFrameTs) / 1000) : 0.016;
  lastFrameTs = ts;
  applyFlightToKeys();
  applyGimbalLook(dt);
  syncScene();
}

function connect() {
  if (ws) try { ws.close(); } catch { /* */ }
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { connected.value = true; };
  ws.onclose = () => {
    connected.value = false;
    setTimeout(connect, 1500);
  };
  ws.onerror = () => {};
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type !== 'state') return;
      state.value = msg;
      if (msg.control_mode) controlMode.value = msg.control_mode;
    } catch { /* */ }
  };
}

function onArenaKeyDown(e) {
  if (e.target && ['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(k)) {
    e.preventDefault();
    heldExtra.value[k] = true;
    return;
  }
  if (['r', 'f', 'q', 'e'].includes(k)) {
    e.preventDefault();
    heldExtra.value[k] = true;
    return;
  }
  if (k === ' ') {
    e.preventDefault();
    startMission();
  } else if (k === 'escape') {
    send({ type: 'abort' });
  } else if (k === '1') {
    setMode('observer');
  } else if (k === '2') {
    setMode('blue');
  } else if (k === 'v') {
    followCam.value = !followCam.value;
  }
}

function onArenaKeyUp(e) {
  const k = e.key.toLowerCase();
  if (k in heldExtra.value) heldExtra.value[k] = false;
}

function startMission() {
  if (!state.value) return;
  showBrief.value = false;
  if (['blue_win', 'red_win', 'draw', 'aborted'].includes(state.value.phase)) {
    send({ type: 'reset' });
    setTimeout(() => send({ type: 'start' }), 80);
  } else if (state.value.phase !== 'running') {
    send({ type: 'start' });
  }
}

function resetMission() {
  send({ type: 'reset' });
  showBrief.value = true;
  lookYaw.value = 0;
  lookPitch.value = -38;
}

function abortMission() {
  send({ type: 'abort' });
}

function dismissBrief() {
  showBrief.value = false;
}

function lookLevel() {
  lookPitch.value = -25;
}

function lookDown() {
  lookPitch.value = -75;
}

onMounted(() => {
  registerPage({ id: 'aerial', nameKey: 'aerialview.page_aerial', route: '/' });
  registerPage({ id: 'map', nameKey: 'aerialview.page_map', route: '/map' });
  registerPage({ id: 'realdrone', nameKey: 'aerialview.page_realdrone', route: '/real-drone' });
  registerPage({ id: 'missionarena', nameKey: 'aerialview.page_missionarena', route: '/mission-arena' });
  registerPage({ id: 'surveymission', nameKey: 'aerialview.page_surveymission', route: '/survey-mission' });
  registerPage({ id: 'extensions', nameKey: 'aerialview.page_extensions', route: '/extensions' });
  registerPage({ id: 'chat', nameKey: 'aerialview.page_chat', route: '/chat' });
  registerPage({ id: 'myspace', nameKey: 'aerialview.page_myspace', route: '/myspace' });

  registerLeft({
    id: 'router',
    render: () => h(DockMenuButton, {
      icon: 'MENU_ROUTER',
      titleKey: 'aerialview.pages',
      pages,
    }),
  });
  registerLeft({
    id: 'camera',
    icon: 'MENU_CAMERA',
    titleKey: 'aerialview.camera',
    active: showCamera.value,
    onClick: toggleCamera,
  });
  registerRight({
    id: 'steer',
    icon: 'MENU_CONTROL_STICK',
    titleKey: 'aerialview.steer',
    active: showFlight.value,
    onClick: toggleFlight,
  });

  watch(showFlight, (val) => {
    const item = rightItems.find((i) => i.id === 'steer');
    if (item) item.active = val;
  });
  watch(showCamera, (val) => {
    const item = leftItems.find((i) => i.id === 'camera');
    if (item) item.active = val;
  });

  checkCesiumConnection();
  connectionCheckInterval = setInterval(checkCesiumConnection, 10000);

  cesium.showCesium();
  showFlight.value = true;
  showCamera.value = true;
  startFlightKeyboard();
  lastFrameTs = 0;
  rafId = requestAnimationFrame(frameLoop);

  connect();
  window.addEventListener('keydown', onArenaKeyDown);
  window.addEventListener('keyup', onArenaKeyUp);
  inputTimer = setInterval(pushInput, 50);
});

onUnmounted(() => {
  clear();
  ['aerial', 'realdrone', 'map', 'missionarena', 'surveymission', 'myspace', 'chat', 'extensions']
    .forEach((id) => unregisterPage(id));
  window.removeEventListener('keydown', onArenaKeyDown);
  window.removeEventListener('keyup', onArenaKeyUp);
  stopFlightKeyboard();
  onFlightStop();
  onCameraStop();
  if (rafId) cancelAnimationFrame(rafId);
  if (inputTimer) clearInterval(inputTimer);
  if (connectionCheckInterval) clearInterval(connectionCheckInterval);
  cesium.clear();
  if (ws) try { ws.close(); } catch { /* */ }
});
</script>

<template>
  <ViewComposer
    :left-items="leftItems"
    :right-items="rightItems"
    :show-flight="showFlight"
    :show-camera="showCamera"
    :show-hud="true"
    :flight="flight"
    :camera="camera"
    @flightMove="onFlightMove"
    @flightStop="onFlightStop"
    @flightModeChange="onFlightModeChange"
    @cameraMove="onCameraMove"
    @cameraStop="onCameraStop"
    @cameraModeChange="onCameraModeChange"
  >
    <template #top-overlay>
      <ConnectionError :visible="showConnectionError" :message="connectionMessage" />
    </template>

    <!-- Transparent shell: shared #cesiumContainer (Node 1) shows through -->
    <template #background>
      <div class="arena view-composer__background">
        <header class="arena__top">
          <div>
            <span class="arena__title">{{ t('missionarenaview.title') }}</span>
            <span class="arena__sub">{{ t('missionarenaview.subtitle_cesium') }}</span>
          </div>
          <div class="arena__meters">
            <div class="meter">
              <span>{{ t('missionarenaview.time') }}</span>
              <strong>{{ timeLeft }}s</strong>
            </div>
            <div class="meter">
              <span>{{ t('missionarenaview.occupy') }}</span>
              <div class="bar"><i :style="{ width: `${Math.min(100, ((state?.occupy?.current || 0) / (state?.occupy?.need || 1)) * 100)}%` }" /></div>
            </div>
            <div class="meter">
              <span>{{ t('missionarenaview.jam') }}</span>
              <div class="bar bar--jam"><i :style="{ width: `${Math.min(100, ((state?.jam?.current || 0) / (state?.jam?.need || 1)) * 100)}%` }" /></div>
            </div>
            <div class="meter">
              <span>{{ t('missionarenaview.relay') }}</span>
              <div class="bar bar--relay"><i :style="{ width: `${Math.min(100, ((state?.relay?.current || 0) / (state?.relay?.need || 1)) * 100)}%` }" /></div>
            </div>
            <div class="meter">
              <span>{{ t('missionarenaview.obs_alt') }}</span>
              <strong>{{ obsAlt }} m</strong>
            </div>
            <div class="meter meter--phase" :data-phase="state?.phase">
              <span>{{ t('missionarenaview.stage') }}</span>
              <strong>{{ stageLabel }}</strong>
            </div>
            <div class="meter meter--phase" :data-phase="state?.phase">
              <span>{{ t('missionarenaview.phase') }}</span>
              <strong>{{ phaseLabel }}</strong>
            </div>
            <div class="meter">
              <span>{{ t('missionarenaview.route') }}</span>
              <strong>{{ routeLabel }}</strong>
            </div>
          </div>
        </header>

        <div class="arena-pad">
          <div class="arena-pad__block">
            <div class="arena-pad__title">
              {{ t('missionarenaview.pad_gimbal') }} · yaw {{ Math.round(lookYaw) }}° · pitch {{ Math.round(lookPitch) }}°
            </div>
            <div class="arena-pad__row">
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('arrowleft', true)"
                @pointerup.prevent="holdExtra('arrowleft', false)"
                @pointerleave="holdExtra('arrowleft', false)"
                @pointercancel="holdExtra('arrowleft', false)"
              >← {{ t('missionarenaview.pad_look_left') }}</button>
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('arrowright', true)"
                @pointerup.prevent="holdExtra('arrowright', false)"
                @pointerleave="holdExtra('arrowright', false)"
                @pointercancel="holdExtra('arrowright', false)"
              >{{ t('missionarenaview.pad_look_right') }} →</button>
            </div>
            <div class="arena-pad__row">
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('arrowup', true)"
                @pointerup.prevent="holdExtra('arrowup', false)"
                @pointerleave="holdExtra('arrowup', false)"
                @pointercancel="holdExtra('arrowup', false)"
              >↑ {{ t('missionarenaview.pad_look_up') }}</button>
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('arrowdown', true)"
                @pointerup.prevent="holdExtra('arrowdown', false)"
                @pointerleave="holdExtra('arrowdown', false)"
                @pointercancel="holdExtra('arrowdown', false)"
              >↓ {{ t('missionarenaview.pad_look_down') }}</button>
            </div>
            <div class="arena-pad__row">
              <button type="button" class="pad-btn" @click="lookLevel">{{ t('missionarenaview.pad_level') }}</button>
              <button type="button" class="pad-btn" @click="lookDown">{{ t('missionarenaview.pad_look_nadir') }}</button>
            </div>
          </div>
          <div class="arena-pad__block">
            <div class="arena-pad__title">{{ t('missionarenaview.pad_flight_extra') }}</div>
            <div class="arena-pad__row">
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('r', true)"
                @pointerup.prevent="holdExtra('r', false)"
                @pointerleave="holdExtra('r', false)"
                @pointercancel="holdExtra('r', false)"
              >R {{ t('missionarenaview.pad_up') }}</button>
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('f', true)"
                @pointerup.prevent="holdExtra('f', false)"
                @pointerleave="holdExtra('f', false)"
                @pointercancel="holdExtra('f', false)"
              >F {{ t('missionarenaview.pad_down') }}</button>
            </div>
            <div class="arena-pad__row">
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('q', true)"
                @pointerup.prevent="holdExtra('q', false)"
                @pointerleave="holdExtra('q', false)"
                @pointercancel="holdExtra('q', false)"
              >Q {{ t('missionarenaview.pad_yaw_left') }}</button>
              <button
                type="button"
                class="pad-btn"
                @pointerdown.prevent="holdExtra('e', true)"
                @pointerup.prevent="holdExtra('e', false)"
                @pointerleave="holdExtra('e', false)"
                @pointercancel="holdExtra('e', false)"
              >E {{ t('missionarenaview.pad_yaw_right') }}</button>
            </div>
          </div>
        </div>

        <aside class="arena__side">
          <section class="card">
            <h3>{{ t('missionarenaview.brief') }}</h3>
            <p>{{ state?.brief || t('missionarenaview.brief_fallback') }}</p>
            <p class="meta">{{ t('missionarenaview.units') }}: {{ unitCount }} · Cesium 3D</p>
          </section>

          <section class="card">
            <h3>{{ t('missionarenaview.control') }}</h3>
            <div class="mode-row">
              <button type="button" class="btn" :class="{ 'btn--primary': controlMode === 'observer' }" @click="setMode('observer')">
                {{ t('missionarenaview.mode_observer') }}
              </button>
              <button type="button" class="btn" :class="{ 'btn--primary': controlMode === 'blue' }" @click="setMode('blue')">
                {{ t('missionarenaview.mode_blue') }}
              </button>
            </div>
            <ul>
              <li>{{ t('missionarenaview.rule_observer') }}</li>
              <li>{{ t('missionarenaview.rule_blue') }}</li>
              <li>{{ t('missionarenaview.rule_red') }}</li>
              <li>{{ t('missionarenaview.rule_keys3d') }}</li>
            </ul>
            <label class="check">
              <input v-model="followCam" type="checkbox">
              {{ t('missionarenaview.follow_cam') }}
            </label>
          </section>

          <section class="card">
            <h3>{{ t('missionarenaview.status') }}</h3>
            <p>
              <span :class="['dot', connected ? 'dot--on' : 'dot--off']" />
              {{ connected ? t('missionarenaview.connected') : t('missionarenaview.disconnected') }}
            </p>
            <div class="actions">
              <button type="button" class="btn btn--primary" @click="startMission">{{ t('missionarenaview.start') }}</button>
              <button type="button" class="btn" @click="resetMission">{{ t('missionarenaview.reset') }}</button>
              <button type="button" class="btn btn--warn" @click="abortMission">{{ t('missionarenaview.abort') }}</button>
            </div>
          </section>

          <section class="card card--log">
            <h3>{{ t('missionarenaview.audit') }}</h3>
            <div class="log">
              <div v-for="(ev, i) in (state?.events || []).slice().reverse()" :key="i" class="log__row">
                <span>{{ ev.ts?.toFixed?.(1) ?? ev.ts }}s</span>
                <b>{{ ev.kind }}</b>
                <i>{{ ev.detail }}</i>
              </div>
              <div v-if="!(state?.events || []).length" class="log__empty">{{ t('missionarenaview.audit_empty') }}</div>
            </div>
          </section>
        </aside>

        <div v-if="showBrief && state && ['briefing','idle'].includes(state.phase)" class="arena__toast">
          <div class="overlay-card">
            <h2>{{ t('missionarenaview.title') }}</h2>
            <p>{{ t('missionarenaview.overlay_hint_cesium') }}</p>
            <div class="actions" style="justify-content:center">
              <button type="button" class="btn btn--primary" @click="startMission">{{ t('missionarenaview.start') }}</button>
              <button type="button" class="btn" @click="dismissBrief">{{ t('missionarenaview.scout_first') }}</button>
            </div>
          </div>
        </div>
        <div v-if="state && ['blue_win','red_win','draw','aborted'].includes(state.phase)" class="arena__toast">
          <div class="overlay-card" :data-phase="state.phase">
            <h2>{{ phaseLabel }}</h2>
            <p>{{ t('missionarenaview.replay_hint') }}</p>
            <button type="button" class="btn btn--primary" @click="startMission">{{ t('missionarenaview.again') }}</button>
          </div>
        </div>
      </div>
    </template>
  </ViewComposer>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Syne:wght@600;700&display=swap');

:deep(.view-composer__background) {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background: transparent;
}

.arena {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  color: #e7f2ec;
  font-family: 'IBM Plex Sans', sans-serif;
  background: transparent;
}

.arena__top {
  position: absolute;
  top: 0; left: 0; right: 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  gap: 12px 20px;
  justify-content: space-between;
  align-items: flex-end;
  padding: 14px 20px 10px 88px;
  background: linear-gradient(180deg, rgba(6,18,14,.88), rgba(6,18,14,.05));
  pointer-events: none;
}
.arena__title {
  display: block;
  font-family: Syne, sans-serif;
  font-size: 1.35rem;
  font-weight: 700;
  text-shadow: 0 1px 8px #000;
}
.arena__sub { display: block; font-size: .82rem; opacity: .85; }
.arena__meters { display: flex; flex-wrap: wrap; gap: 12px 16px; }
.meter { min-width: 96px; }
.meter span {
  display: block; font-size: .68rem; letter-spacing: .08em;
  text-transform: uppercase; opacity: .7;
}
.meter strong { font-size: 1.05rem; text-shadow: 0 1px 4px #000; }
.bar {
  height: 6px; margin: 4px 0; border-radius: 3px;
  background: rgba(0,0,0,.4); overflow: hidden;
}
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #e35d5d, #ff9a7a); }
.bar--jam i { background: linear-gradient(90deg, #c47a20, #f0c14a); }
.bar--relay i { background: linear-gradient(90deg, #a88a20, #ffe08a); }
.meter--phase[data-phase='running'] strong { color: #7ddeb0; }
.meter--phase[data-phase='blue_win'] strong { color: #6ec8ff; }
.meter--phase[data-phase='red_win'] strong { color: #ff8a7a; }

.arena-pad {
  position: absolute;
  left: 88px;
  bottom: 200px;
  z-index: 6;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  max-width: min(440px, 48vw);
  pointer-events: auto;
}
.arena-pad__block {
  padding: 10px 12px;
  background: rgba(8, 22, 18, 0.92);
  border: 1px solid rgba(120, 190, 160, 0.35);
  backdrop-filter: blur(8px);
  min-width: 168px;
}
.arena-pad__title {
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.85;
  margin-bottom: 8px;
  font-family: Syne, sans-serif;
}
.arena-pad__row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.arena-pad__row:last-child { margin-bottom: 0; }
.pad-btn {
  flex: 1;
  border: 1px solid rgba(140, 190, 170, 0.4);
  background: rgba(28, 52, 44, 0.95);
  color: #e7f2ec;
  padding: 8px 6px;
  font: 600 0.72rem 'IBM Plex Sans', sans-serif;
  cursor: pointer;
  touch-action: none;
  user-select: none;
}
.pad-btn:hover { filter: brightness(1.1); }
.pad-btn:active {
  background: #1f6b52;
  border-color: #3aa882;
}

.arena__side {
  position: absolute;
  top: 92px; right: 14px; bottom: 14px;
  width: min(300px, 34vw);
  z-index: 3;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
  pointer-events: none;
}
.card {
  pointer-events: auto;
  padding: 12px 14px;
  background: rgba(10, 24, 20, .88);
  border: 1px solid rgba(120, 180, 150, .22);
  backdrop-filter: blur(8px);
}
.card h3 { margin: 0 0 8px; font-family: Syne, sans-serif; font-size: .95rem; }
.card p, .card li { margin: 0 0 6px; font-size: .8rem; line-height: 1.45; opacity: .92; }
.card ul { margin: 8px 0 0; padding-left: 1.05rem; }
.meta { opacity: .7 !important; font-size: .75rem !important; }
.mode-row { display: flex; gap: 8px; margin-bottom: 8px; }
.mode-row .btn { flex: 1; }
.check {
  display: flex; align-items: center; gap: 8px;
  margin-top: 10px; font-size: .8rem; cursor: pointer;
}
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.btn {
  border: 1px solid rgba(140, 190, 170, .35);
  background: rgba(30, 50, 44, .92);
  color: #e7f2ec;
  padding: 7px 11px;
  font: 500 .78rem 'IBM Plex Sans', sans-serif;
  cursor: pointer;
}
.btn:hover { filter: brightness(1.08); }
.btn--primary { background: #1f6b52; border-color: #3aa882; }
.btn--warn { background: #5a3028; border-color: #a86a5a; }
.dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%; margin-right: 6px;
}
.dot--on { background: #4fd28a; }
.dot--off { background: #c45a4a; }
.card--log { flex: 1; min-height: 90px; }
.log { font-size: .72rem; max-height: 140px; overflow: auto; }
.log__row {
  display: grid; grid-template-columns: 40px 1fr auto; gap: 6px;
  opacity: .85; padding: 2px 0;
}
.log__row i { font-style: normal; opacity: .6; }
.log__empty { opacity: .5; }

.arena__toast {
  position: absolute;
  left: 50%;
  top: 20%;
  transform: translateX(-50%);
  z-index: 5;
  pointer-events: none;
  padding-left: 40px;
}
.overlay-card {
  pointer-events: auto;
  max-width: 400px;
  padding: 22px 26px;
  text-align: center;
  background: rgba(12, 28, 24, .94);
  border: 1px solid rgba(120, 190, 160, .35);
  box-shadow: 0 16px 48px rgba(0,0,0,.45);
}
.overlay-card h2 { margin: 0 0 10px; font-family: Syne, sans-serif; }
.overlay-card p { margin: 0 0 16px; opacity: .85; line-height: 1.5; }
.overlay-card[data-phase='blue_win'] { border-color: rgba(90,180,255,.45); }
.overlay-card[data-phase='red_win'] { border-color: rgba(255,110,90,.45); }

@media (max-width: 900px) {
  .arena__side {
    top: auto; left: 72px; right: 8px; bottom: 8px;
    width: auto; max-height: 36vh;
  }
  .arena-pad { bottom: 38vh; left: 72px; }
}
</style>
