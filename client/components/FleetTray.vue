<script setup>
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps({
  minimized: { type: Boolean, default: false },
  drones: { type: Array, default: () => [] },
  selectedDroneId: { type: String, default: '' },
  mode: { type: String, default: 'off' },
  liveStatus: { type: String, default: 'idle' },
  activeMission: { type: Object, default: null },
  missionPresets: { type: Array, default: () => [] },
  performance: { type: Object, default: () => ({ fps: 0, objects: 0, visible: 0 }) },
  ownsControl: { type: Boolean, default: false },
  cameraMode: { type: String, default: 'free' },
  cameraRange: { type: Number, default: 24 },
});

const emit = defineEmits([
  'toggle-minimized',
  'select-drone',
  'add-drone',
  'remove-drone',
  'mode-change',
  'start-mission',
  'stop-mission',
  'toggle-follow',
  'toggle-control',
  'open-situation',
  'open-agent',
  'focus-drone',
  'camera-mode-change',
  'camera-range-change',
  'set-takeoff-altitude',
  'navigate-to',
  'gather',
]);

const addOpen = ref(false);
const diagnosticsOpen = ref(false);
const pendingDeleteId = ref('');
const name = ref('');
const type = ref('demo');
const query = ref('');
const targetDroneId = ref('');
const altitudeDraft = ref(100);

const selected = computed(() =>
  props.drones.find((drone) => drone.droneId === props.selectedDroneId) || props.drones[0] || null);
const selectedTakeoffAltitude = computed(() => Number(selected.value?.takeoffAltitude) || 100);
const remoteCount = computed(() => props.drones.filter((drone) => !drone.local).length);
const missionProgress = computed(() => Math.round(Number(selected.value?.missionProgress || 0) * 100));
const visibleDrones = computed(() => {
  const term = query.value.trim().toLowerCase();
  if (!term) return props.drones;
  return props.drones.filter((drone) =>
    `${drone.name} ${drone.droneId} ${drone.phase || ''}`.toLowerCase().includes(term));
});
const navigationTargets = computed(() =>
  props.drones.filter((drone) => drone.online !== false && drone.droneId !== props.selectedDroneId));

watch(() => props.selectedDroneId, () => {
  targetDroneId.value = navigationTargets.value.find((drone) => drone.local)?.droneId
    || navigationTargets.value[0]?.droneId
    || '';
}, { immediate: true });

watch(navigationTargets, () => {
  if (!navigationTargets.value.some((drone) => drone.droneId === targetDroneId.value)) {
    targetDroneId.value = navigationTargets.value.find((drone) => drone.local)?.droneId
      || navigationTargets.value[0]?.droneId
      || '';
  }
});

watch(
  selectedTakeoffAltitude,
  (value) => {
    altitudeDraft.value = value;
  },
  { immediate: true },
);
watch(() => props.selectedDroneId, () => {
  altitudeDraft.value = selectedTakeoffAltitude.value;
});

function addDrone() {
  emit('add-drone', { name: name.value.trim(), type: type.value });
  name.value = '';
  type.value = 'demo';
  addOpen.value = false;
}

function requestRemove(droneId) {
  if (pendingDeleteId.value === droneId) {
    emit('remove-drone', droneId);
    pendingDeleteId.value = '';
    return;
  }
  pendingDeleteId.value = droneId;
  window.setTimeout(() => {
    if (pendingDeleteId.value === droneId) pendingDeleteId.value = '';
  }, 4000);
}

function statusLabel(drone) {
  const phase = drone?.phase || (drone?.online === false ? 'offline' : 'parked');
  return t(`fleettray.phase_${phase}`);
}

function commitAltitude() {
  emit('set-takeoff-altitude', altitudeDraft.value);
}
</script>

<template>
  <aside class="fleet-tray" :class="{ 'fleet-tray--minimized': minimized }" aria-label="Fleet workbench">
    <button
      v-if="minimized"
      type="button"
      class="fleet-tray__compact"
      :aria-label="t('fleettray.expand')"
      @click="emit('toggle-minimized')"
    >
      <span class="fleet-tray__beacon" :class="{ 'is-live': mode === 'live' }" />
      <strong>{{ selected?.name || t('fleettray.title') }}</strong>
      <span>{{ statusLabel(selected) }} · {{ selected?.battery?.toFixed?.(0) ?? '—' }}%</span>
      <b>＋</b>
    </button>

    <template v-else>
      <header class="fleet-tray__header">
        <div>
          <span class="fleet-tray__eyebrow">{{ t('fleettray.eyebrow') }}</span>
          <strong>{{ t('fleettray.title') }}</strong>
        </div>
        <div class="fleet-tray__header-actions">
          <span class="fleet-tray__count">{{ drones.length }}</span>
          <button type="button" :aria-label="t('fleettray.minimize')" @click="emit('toggle-minimized')">—</button>
        </div>
      </header>

      <div class="fleet-tray__mode">
        <button type="button" :class="{ 'is-active': mode === 'demo' }" @click="emit('mode-change', 'demo')">
          {{ t('fleettray.demo') }}
        </button>
        <button type="button" :class="{ 'is-active': mode === 'live' }" @click="emit('mode-change', 'live')">
          {{ t('fleettray.live') }}
        </button>
        <span>{{ mode === 'live' ? t(`fleettray.live_${liveStatus}`) : t('fleettray.local') }}</span>
      </div>

      <div class="fleet-tray__camera">
        <span>{{ t('fleettray.camera') }}</span>
        <button
          v-for="cameraOption in ['free', 'fpv', 'follow', 'top', 'overview']"
          :key="cameraOption"
          type="button"
          :class="{ 'is-active': cameraMode === cameraOption }"
          @click="emit('camera-mode-change', cameraOption)"
        >
          {{ t(`fleettray.camera_${cameraOption}`) }}
        </button>
        <label v-if="cameraMode === 'follow' || cameraMode === 'top'">
          <input
            type="range"
            min="8"
            max="160"
            step="2"
            :value="cameraRange"
            :aria-label="t('fleettray.camera_distance')"
            @input="emit('camera-range-change', Number($event.target.value))"
          >
          <b>{{ cameraRange }}m</b>
        </label>
      </div>

      <div class="fleet-tray__filter">
        <input v-model="query" type="search" :placeholder="t('fleettray.search')" :aria-label="t('fleettray.search')">
        <span>{{ visibleDrones.length }}/{{ drones.length }}</span>
      </div>

      <div v-if="selected" class="fleet-tray__selected-settings">
        <label>
          <span>{{ t('fleettray.takeoff_altitude') }}</span>
          <input
            type="number"
            min="20"
            max="10000"
            step="10"
            v-model.number="altitudeDraft"
            :aria-label="t('fleettray.takeoff_altitude')"
            @change="commitAltitude"
            @blur="commitAltitude"
            @keyup.enter.prevent="commitAltitude"
          >
          <b>m</b>
        </label>
      </div>

      <div class="fleet-tray__list">
        <article
          v-for="drone in visibleDrones"
          :key="drone.droneId"
          class="fleet-tray__drone"
          :class="{ 'is-selected': drone.droneId === selectedDroneId, 'is-offline': drone.online === false }"
        >
          <button type="button" class="fleet-tray__select" @click="emit('select-drone', drone.droneId)">
            <span class="fleet-tray__dot" :style="{ backgroundColor: drone.color }" />
            <span class="fleet-tray__identity">
              <strong>{{ drone.name }}</strong>
              <small>{{ statusLabel(drone) }} · {{ drone.missionTarget || drone.droneId }}</small>
            </span>
            <span class="fleet-tray__battery">{{ drone.battery?.toFixed?.(0) ?? '—' }}%</span>
          </button>
          <button
            type="button"
            class="fleet-tray__locate"
            :title="t('fleettray.locate')"
            @click="emit('focus-drone', drone.droneId)"
          >
            ◎
          </button>
          <button
            v-if="!drone.local"
            type="button"
            class="fleet-tray__remove"
            :class="{ 'is-confirming': pendingDeleteId === drone.droneId }"
            @click="requestRemove(drone.droneId)"
          >
            {{ pendingDeleteId === drone.droneId ? t('fleettray.confirm') : '×' }}
          </button>
        </article>
      </div>

      <div class="fleet-tray__dispatch">
        <span>{{ selected?.name || '—' }}</span>
        <b>→</b>
        <select v-model="targetDroneId" :disabled="!navigationTargets.length || selected?.local">
          <option v-for="drone in navigationTargets" :key="drone.droneId" :value="drone.droneId">
            {{ drone.local ? t('fleettray.me') : drone.name }}
          </option>
        </select>
        <button
          type="button"
          :disabled="!targetDroneId || selected?.local || mode !== 'demo'"
          @click="emit('navigate-to', { droneId: selected.droneId, targetDroneId })"
        >
          {{ t('fleettray.go_find') }}
        </button>
        <button type="button" :disabled="mode !== 'demo' || drones.length < 2" @click="emit('gather')">
          {{ t('fleettray.gather') }}
        </button>
      </div>

      <div v-if="selected" class="fleet-tray__mission-strip">
        <span :class="{ 'is-complete': missionProgress > 2 }">{{ t('fleettray.leg_pad') }}</span>
        <i><b :style="{ width: `${missionProgress}%` }" /></i>
        <span :class="{ 'is-complete': missionProgress >= 100 }">{{ selected.missionTarget || t('fleettray.leg_target') }}</span>
        <em>{{ missionProgress }}%</em>
      </div>

      <form v-if="addOpen" class="fleet-tray__add" @submit.prevent="addDrone">
        <input v-model="name" maxlength="40" :placeholder="t('fleettray.name_placeholder')" autofocus>
        <select v-model="type">
          <option value="demo">{{ t('fleettray.type_demo') }}</option>
          <option value="live">{{ t('fleettray.type_live') }}</option>
        </select>
        <button type="submit">{{ t('fleettray.create') }}</button>
      </form>

      <div class="fleet-tray__actions">
        <button type="button" @click="addOpen = !addOpen">{{ addOpen ? t('fleettray.cancel') : t('fleettray.add') }}</button>
        <button type="button" @click="emit('open-situation')">{{ t('fleettray.situation') }}</button>
        <button type="button" :disabled="!selected || selected.local" @click="emit('open-agent')">{{ t('fleettray.agent') }}</button>
      </div>

      <div v-if="mode === 'demo' && remoteCount" class="fleet-tray__missions">
        <button
          v-for="preset in missionPresets"
          :key="preset.id"
          type="button"
          :disabled="Boolean(activeMission)"
          @click="emit('start-mission', preset.id)"
        >
          {{ t(`fleettray.mission_${preset.labelKey}`) }}
        </button>
        <button v-if="activeMission" type="button" class="is-stop" @click="emit('stop-mission')">
          {{ t('fleettray.stop_mission') }}
        </button>
      </div>

      <div class="fleet-tray__utility">
        <button type="button" @click="emit('toggle-follow')">{{ t('fleettray.follow') }}</button>
        <button v-if="mode === 'live' && selected" type="button" @click="emit('toggle-control')">
          {{ ownsControl ? t('fleettray.release') : t('fleettray.claim') }}
        </button>
        <button type="button" @click="diagnosticsOpen = !diagnosticsOpen">{{ t('fleettray.diagnostics') }}</button>
      </div>
      <div v-if="diagnosticsOpen" class="fleet-tray__diagnostics">
        <span>{{ performance.fps || 0 }} FPS</span>
        <span>{{ performance.visible || 0 }}/{{ performance.objects || drones.length }} {{ t('fleettray.visible') }}</span>
        <span>{{ selected?.agentStatus || 'not_created' }} Agent</span>
      </div>
    </template>
  </aside>
</template>

<style scoped>
.fleet-tray {
  position: fixed;
  top: 22px;
  right: 92px;
  z-index: 76;
  width: min(370px, calc(100vw - 160px));
  overflow: hidden;
  border: 1px solid rgba(109, 199, 232, 0.34);
  border-radius: 10px;
  background: rgba(7, 17, 27, 0.94);
  box-shadow: 0 20px 58px rgba(0, 0, 0, 0.42), inset 0 1px rgba(255, 255, 255, 0.06);
  color: #eaf6fb;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  pointer-events: auto;
}

.fleet-tray button,
.fleet-tray input,
.fleet-tray select { font: inherit; }
.fleet-tray button:focus-visible,
.fleet-tray input:focus-visible,
.fleet-tray select:focus-visible { outline: 2px solid #6dc7e8; outline-offset: 2px; }

.fleet-tray__header,
.fleet-tray__header-actions,
.fleet-tray__mode,
.fleet-tray__select,
.fleet-tray__actions,
.fleet-tray__utility,
.fleet-tray__diagnostics,
.fleet-tray__compact {
  display: flex;
  align-items: center;
}

.fleet-tray__header {
  justify-content: space-between;
  min-height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid rgba(109, 199, 232, 0.14);
}
.fleet-tray__eyebrow { display: block; color: #6dc7e8; font-size: 0.56rem; font-weight: 800; letter-spacing: 0.16em; text-transform: uppercase; }
.fleet-tray__header strong { display: block; margin-top: 2px; font-size: 0.88rem; letter-spacing: 0.03em; }
.fleet-tray__header-actions { gap: 7px; }
.fleet-tray__header-actions button,
.fleet-tray__count { display: grid; width: 26px; height: 26px; place-items: center; border: 1px solid rgba(109, 199, 232, 0.2); border-radius: 5px; color: #dff7ff; background: #0e1c28; }
.fleet-tray__header-actions button { cursor: pointer; }

.fleet-tray__mode {
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.fleet-tray__mode button { padding: 5px 9px; border: 0; border-radius: 5px; color: #8ea9b6; background: transparent; cursor: pointer; font-size: 0.67rem; }
.fleet-tray__mode button.is-active { color: #07111b; background: #6dc7e8; font-weight: 750; }
.fleet-tray__mode span { margin-left: auto; color: #5dd5a4; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.6rem; }

.fleet-tray__camera {
  display: grid;
  grid-template-columns: auto repeat(5, minmax(0, 1fr));
  align-items: center;
  gap: 4px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.fleet-tray__camera > span { color: #7893a0; font-size: 0.58rem; }
.fleet-tray__camera > button { padding: 5px 3px; border: 1px solid #244252; border-radius: 5px; color: #9eb5c0; background: #0e1c28; cursor: pointer; font-size: 0.58rem; }
.fleet-tray__camera > button.is-active { color: #07111b; border-color: #6dc7e8; background: #6dc7e8; font-weight: 750; }
.fleet-tray__camera label { grid-column: 2 / -1; display: flex; align-items: center; gap: 7px; }
.fleet-tray__camera input { min-width: 0; flex: 1; accent-color: #6dc7e8; }
.fleet-tray__camera label b { width: 36px; color: #6dc7e8; font: 0.58rem "SFMono-Regular", Consolas, monospace; }

.fleet-tray__filter { display: flex; align-items: center; gap: 7px; padding: 7px 10px 2px; }
.fleet-tray__filter input { min-width: 0; flex: 1; padding: 6px 8px; border: 1px solid #244252; border-radius: 5px; color: #eaf6fb; background: #07111b; font-size: 0.64rem; }
.fleet-tray__filter span { color: #7893a0; font: 0.58rem "SFMono-Regular", Consolas, monospace; }

.fleet-tray__selected-settings { padding: 5px 10px 3px; }
.fleet-tray__selected-settings label { display: flex; align-items: center; gap: 7px; color: #7893a0; font-size: 0.6rem; }
.fleet-tray__selected-settings input { width: 70px; margin-left: auto; padding: 4px 6px; border: 1px solid #244252; border-radius: 5px; color: #eaf6fb; background: #07111b; font-size: 0.62rem; }
.fleet-tray__selected-settings b { color: #6dc7e8; font: 0.6rem "SFMono-Regular", Consolas, monospace; }

.fleet-tray__list { max-height: min(290px, 34vh); overflow: auto; padding: 4px 6px 6px; }
.fleet-tray__drone { position: relative; margin: 3px 0; border: 1px solid transparent; border-radius: 7px; background: rgba(255, 255, 255, 0.035); }
.fleet-tray__drone.is-selected { border-color: rgba(109, 199, 232, 0.55); background: rgba(109, 199, 232, 0.11); }
.fleet-tray__drone.is-offline { opacity: 0.55; }
.fleet-tray__select { width: 100%; gap: 8px; padding: 8px 58px 8px 9px; border: 0; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.fleet-tray__dot { width: 8px; height: 8px; flex: 0 0 auto; border-radius: 2px; box-shadow: 0 0 9px currentColor; transform: rotate(45deg); }
.fleet-tray__identity { min-width: 0; flex: 1; }
.fleet-tray__identity strong,
.fleet-tray__identity small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fleet-tray__identity strong { font-size: 0.72rem; }
.fleet-tray__identity small { margin-top: 2px; color: #7893a0; font-size: 0.58rem; }
.fleet-tray__battery { color: #5dd5a4; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.64rem; }
.fleet-tray__locate,
.fleet-tray__remove { position: absolute; top: 50%; min-width: 22px; height: 22px; transform: translateY(-50%); border: 0; border-radius: 4px; color: #7893a0; background: transparent; cursor: pointer; font-size: 0.8rem; }
.fleet-tray__locate { right: 30px; color: #6dc7e8; }
.fleet-tray__remove { right: 6px; }
.fleet-tray__remove.is-confirming { width: auto; padding: 0 6px; color: #fff0ec; background: #ff6b5f; font-size: 0.56rem; }

.fleet-tray__dispatch { display: grid; grid-template-columns: minmax(54px, auto) auto 1fr auto auto; align-items: center; gap: 5px; padding: 8px 10px; border-top: 1px solid rgba(109, 199, 232, 0.12); background: rgba(14, 28, 40, 0.72); }
.fleet-tray__dispatch > span { overflow: hidden; color: #dff7ff; font-size: 0.62rem; font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.fleet-tray__dispatch > b { color: #5dd5a4; font-size: 0.66rem; }
.fleet-tray__dispatch select { min-width: 0; padding: 5px; border: 1px solid #244252; border-radius: 5px; color: #dff7ff; background: #07111b; font-size: 0.6rem; }
.fleet-tray__dispatch button { padding: 6px 7px; border: 1px solid rgba(93, 213, 164, 0.35); border-radius: 5px; color: #d8f9ea; background: rgba(93, 213, 164, 0.1); cursor: pointer; font-size: 0.58rem; white-space: nowrap; }
.fleet-tray__dispatch button:disabled { cursor: not-allowed; opacity: 0.36; }

.fleet-tray__mission-strip { display: grid; grid-template-columns: auto 1fr auto auto; align-items: center; gap: 7px; margin: 3px 10px 8px; color: #7893a0; font-size: 0.57rem; }
.fleet-tray__mission-strip i { position: relative; height: 3px; overflow: hidden; border-radius: 2px; background: #1c3442; }
.fleet-tray__mission-strip i b { position: absolute; inset: 0 auto 0 0; background: #5dd5a4; transition: width 120ms linear; }
.fleet-tray__mission-strip span.is-complete { color: #d8f9ea; }
.fleet-tray__mission-strip em { color: #6dc7e8; font-family: "SFMono-Regular", Consolas, monospace; font-style: normal; }

.fleet-tray__add { display: grid; grid-template-columns: 1fr 96px auto; gap: 5px; padding: 7px 10px; background: #0e1c28; }
.fleet-tray__add input,
.fleet-tray__add select { min-width: 0; padding: 6px 7px; border: 1px solid #244252; border-radius: 5px; color: #eaf6fb; background: #07111b; font-size: 0.65rem; }
.fleet-tray__add button { border: 0; border-radius: 5px; color: #07111b; background: #5dd5a4; cursor: pointer; font-size: 0.63rem; font-weight: 750; }

.fleet-tray__actions,
.fleet-tray__utility { gap: 5px; padding: 0 10px 8px; }
.fleet-tray__actions button,
.fleet-tray__utility button,
.fleet-tray__missions button { flex: 1; min-width: 0; padding: 6px 5px; border: 1px solid #244252; border-radius: 5px; color: #c8dce5; background: #0e1c28; cursor: pointer; font-size: 0.61rem; }
.fleet-tray__actions button:disabled,
.fleet-tray__missions button:disabled { cursor: not-allowed; opacity: 0.4; }
.fleet-tray__missions { display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; padding: 0 10px 8px; }
.fleet-tray__missions button.is-stop { color: #fff0ec; border-color: rgba(255, 107, 95, 0.45); }
.fleet-tray__utility { padding-top: 7px; border-top: 1px solid rgba(255, 255, 255, 0.05); }
.fleet-tray__diagnostics { justify-content: space-between; padding: 0 10px 9px; color: #7893a0; font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.56rem; }

.fleet-tray--minimized { width: min(320px, calc(100vw - 160px)); }
.fleet-tray__compact { width: 100%; gap: 8px; padding: 9px 10px; border: 0; color: #eaf6fb; background: transparent; cursor: pointer; text-align: left; }
.fleet-tray__compact strong { min-width: 0; flex: 1; overflow: hidden; font-size: 0.7rem; text-overflow: ellipsis; white-space: nowrap; }
.fleet-tray__compact span { color: #7893a0; font-size: 0.59rem; white-space: nowrap; }
.fleet-tray__compact b { color: #6dc7e8; font-size: 0.9rem; }
.fleet-tray__beacon { width: 8px; height: 8px; border-radius: 50%; background: #5dd5a4; box-shadow: 0 0 9px rgba(93, 213, 164, 0.8); }
.fleet-tray__beacon.is-live { background: #6dc7e8; box-shadow: 0 0 9px rgba(109, 199, 232, 0.8); }

@media (max-width: 640px) {
  .fleet-tray { top: 12px; right: 68px; width: calc(100vw - 82px); }
  .fleet-tray__list { max-height: 152px; }
  .fleet-tray__add { grid-template-columns: 1fr auto; }
  .fleet-tray__add select { grid-column: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .fleet-tray,
  .fleet-tray * { animation: none !important; transition: none !important; }
}
</style>
