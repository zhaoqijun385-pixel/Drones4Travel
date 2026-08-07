<script setup>
/**
 * Tourism survey — Task1 plan/sim + Task2 dry-run execute & gallery.
 * Street View forbidden. Same-origin /api via Vite proxy.
 */
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';
import ViewComposer from '@shared/_ViewComposer.vue';
import DockMenuButton from '@shared/DockMenuButton.vue';
import PageMenu from '@shared/PageMenu.vue';
import { useDockRegistry } from '@shared-composables/useDockRegistry.js';
import { usePageRegistry } from '@shared-composables/usePageRegistry.js';
import { clearSurveyCesium, syncSurveyCesium, simulateTask1Flight } from '@/survey/useSurveyCesium.js';

const { t } = useI18n();
const router = useRouter();
const API_BASE = '';
const { leftItems, registerLeft, clear } = useDockRegistry();
const { pages, registerPage, unregisterPage } = usePageRegistry();
const showPages = ref(false);

const place = ref('西湖 Hangzhou');
const radiusM = ref(80);
const minAltM = ref(25);
const photoCount = ref(5);
const droneCount = ref(1);
const dryRun = ref(true);

const plan = ref(null);
const mission = ref(null);
const busy = ref(false);
const err = ref('');
const simMsg = ref('');
const simPose = ref(null);
const cancelSim = ref(null);
const ws = ref(null);
const apiOk = ref(null);
const followCam = ref(true);
const autoSim = ref(false);
const placeHints = ref([]);


const statusLabel = computed(() => mission.value?.status || '—');
const phaseLabel = computed(() => mission.value?.phase || '—');
const shotProgress = computed(() => {
  const shots = mission.value?.shots || [];
  if (!shots.length) return { done: 0, total: 0, pct: 0 };
  const done = shots.filter((s) => s.status === 'done' || s.photo_url).length;
  return { done, total: shots.length, pct: Math.round((done / shots.length) * 100) };
});
const step = computed(() => {
  if (mission.value?.status === 'completed') return 4;
  if (mission.value && ['running', 'paused'].includes(mission.value.status)) return 3;
  if (mission.value) return 3;
  if (plan.value && simMsg.value) return 2;
  if (plan.value) return 2;
  return 1;
});

function goPage(page) {
  showPages.value = false;
  if (page?.route) router.push(page.route);
}
function togglePages() {
  showPages.value = !showPages.value;
}
function mediaUrl(u) {
  if (!u) return u;
  if (u.startsWith('http')) return u;
  return `${API_BASE}${u}`;
}
function friendlyError(e) {
  const msg = String(e?.message || e || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return t('surveymissionview.err_network');
  }
  if (/Not Found|404/i.test(msg)) {
    return t('surveymissionview.err_api');
  }
  return msg.slice(0, 240);
}

function registerDockAndPages() {
  clear();
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
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const tx = await res.text();
    throw new Error(tx || res.statusText);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

async function loadPlaces() {
  try {
    const data = await api('/survey/places');
    placeHints.value = data.places || [];
  } catch (_) {
    placeHints.value = [];
  }
}

function pickPlace(p) {
  place.value = p.query || p.label;
}

async function checkHealth() {
  try {
    const h = await api('/survey/health');
    apiOk.value = h?.status === 'ok';
    if (!apiOk.value) err.value = t('surveymissionview.err_api');
  } catch (e) {
    apiOk.value = false;
    err.value = friendlyError(e);
  }
}

async function makePlan() {
  err.value = '';
  busy.value = true;
  try {
    plan.value = await api('/survey/plan', {
      method: 'POST',
      body: JSON.stringify({
        place: place.value,
        radius_m: Number(radiusM.value),
        min_alt_m: Number(minAltM.value),
        photo_count: Number(photoCount.value),
        drone_count: Number(droneCount.value),
      }),
    });
    mission.value = null;
    simMsg.value = t('surveymissionview.loading_map');
    await syncSurveyCesium(plan.value, { flyTo: true });
    simMsg.value = t('surveymissionview.plan_ready');
    apiOk.value = true;
    if (autoSim.value) {
      await nextTick();
      runTask1Sim();
    }
  } catch (e) {
    err.value = friendlyError(e);
  } finally {
    busy.value = false;
  }
}

function runTask1Sim() {
  if (!plan.value) return;
  cancelSim.value?.();
  simMsg.value = t('surveymissionview.sim_start');
  cancelSim.value = simulateTask1Flight(
    plan.value,
    (pose) => {
      simPose.value = pose;
      simMsg.value = pose.message;
      syncSurveyCesium(plan.value, {
        currentPose: pose,
        flyTo: false,
        follow: followCam.value,
      });
    },
    () => {
      simMsg.value = t('surveymissionview.sim_done');
      simPose.value = null;
      syncSurveyCesium(plan.value, { flyTo: true });
    },
  );
}

async function createAndConnectMission() {
  if (!plan.value) await makePlan();
  if (!plan.value) return;
  busy.value = true;
  err.value = '';
  try {
    mission.value = await api('/survey/missions', {
      method: 'POST',
      body: JSON.stringify({
        plan_id: plan.value.plan_id,
        dry_run: dryRun.value,
        drone_count: Number(droneCount.value),
      }),
    });
    openWs(mission.value.mission_id);
    await syncSurveyCesium(mission.value, { flyTo: true });
  } catch (e) {
    err.value = friendlyError(e);
  } finally {
    busy.value = false;
  }
}

function openWs(mid) {
  ws.value?.close();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${proto}://${location.host}/api/survey/missions/${mid}/ws`);
  ws.value = socket;
  socket.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'state' || msg.mission_id) {
        mission.value = msg;
        const cur = msg.shots?.find((s) => s.shot_id === msg.current_shot_id);
        const pose = cur
          ? { lat: cur.lat, lng: cur.lng, alt_m: cur.alt_m, shot_id: cur.shot_id, yaw_deg: cur.yaw_deg }
          : msg.home;
        syncSurveyCesium(msg, { currentPose: pose, flyTo: false, follow: followCam.value && msg.status === 'running' });
      }
    } catch (_) { /* ignore */ }
  };
}

async function startMission() {
  if (!mission.value) await createAndConnectMission();
  if (!mission.value) return;
  busy.value = true;
  err.value = '';
  try {
    mission.value = await api(`/survey/missions/${mission.value.mission_id}/start`, { method: 'POST', body: '{}' });
  } catch (e) {
    err.value = friendlyError(e);
  } finally {
    busy.value = false;
  }
}

/** One-click: plan → create → start dry-run */
async function runFullDemo() {
  err.value = '';
  busy.value = true;
  try {
    if (!plan.value) await makePlan();
    if (!plan.value) return;
    if (!mission.value || mission.value.plan_id !== plan.value.plan_id) {
      busy.value = true;
      mission.value = await api('/survey/missions', {
        method: 'POST',
        body: JSON.stringify({
          plan_id: plan.value.plan_id,
          dry_run: true,
          drone_count: Number(droneCount.value),
        }),
      });
      openWs(mission.value.mission_id);
    }
    mission.value = await api(`/survey/missions/${mission.value.mission_id}/start`, { method: 'POST', body: '{}' });
    dryRun.value = true;
  } catch (e) {
    err.value = friendlyError(e);
  } finally {
    busy.value = false;
  }
}

async function pauseMission() {
  if (!mission.value) return;
  try {
    mission.value = await api(`/survey/missions/${mission.value.mission_id}/pause`, { method: 'POST', body: '{}' });
  } catch (e) {
    err.value = friendlyError(e);
  }
}

async function cancelMission() {
  if (!mission.value) return;
  try {
    mission.value = await api(`/survey/missions/${mission.value.mission_id}/cancel`, { method: 'POST', body: '{}' });
  } catch (e) {
    err.value = friendlyError(e);
  }
}

async function retryMission() {
  if (!mission.value) return;
  try {
    mission.value = await api(`/survey/missions/${mission.value.mission_id}/retry`, { method: 'POST', body: '{}' });
  } catch (e) {
    err.value = friendlyError(e);
  }
}

onMounted(async () => {
  registerDockAndPages();
  await nextTick();
  registerDockAndPages();
  setTimeout(registerDockAndPages, 80);
  document.getElementById('cesiumContainer')?.classList.remove('hidden');
  checkHealth();
  loadPlaces();
});

onUnmounted(() => {
  clear();
  ['aerial', 'realdrone', 'map', 'missionarena', 'surveymission', 'myspace', 'chat', 'extensions']
    .forEach((id) => unregisterPage(id));
  cancelSim.value?.();
  ws.value?.close();
  clearSurveyCesium();
});

watch(plan, (p) => {
  if (p) syncSurveyCesium(p, { flyTo: false });
});
</script>

<template>
  <ViewComposer
    :left-items="leftItems"
    :show-flight="false"
    :show-camera="false"
    :show-hud="false"
  >
    <template #background>
      <div class="survey view-composer__background">
        <header class="survey__top">
          <div>
            <div class="survey__title">{{ t('surveymissionview.title') }}</div>
            <div class="survey__sub">{{ t('surveymissionview.subtitle') }}</div>
          </div>
          <div class="survey__badges">
            <div class="pages-wrap">
              <button type="button" class="btn btn--pages" @click="togglePages">
                {{ t('surveymissionview.pages') }}
              </button>
              <PageMenu v-if="showPages" class="pages-pop" :pages="pages" @navigate="goPage" />
            </div>
            <span class="badge" :data-ok="apiOk === true" :data-bad="apiOk === false">
              {{ apiOk === false ? t('surveymissionview.api_down') : (apiOk ? t('surveymissionview.api_ok') : '…') }}
            </span>
            <span class="badge">{{ dryRun ? t('surveymissionview.dry_run') : t('surveymissionview.live') }}</span>
            <span class="badge">{{ t('surveymissionview.no_streetview') }}</span>
            <span class="badge" v-if="mission">{{ statusLabel }} / {{ phaseLabel }}</span>
          </div>
        </header>

        <div class="survey__panel">
          <section class="card card--steps">
            <div class="steps">
              <span :class="{ on: step >= 1 }">1 {{ t('surveymissionview.step_plan') }}</span>
              <span :class="{ on: step >= 2 }">2 {{ t('surveymissionview.step_sim') }}</span>
              <span :class="{ on: step >= 3 }">3 {{ t('surveymissionview.step_run') }}</span>
              <span :class="{ on: step >= 4 }">4 {{ t('surveymissionview.step_done') }}</span>
            </div>
            <button type="button" class="btn btn--go btn--block" :disabled="busy || apiOk === false" @click="runFullDemo">
              {{ t('surveymissionview.one_click') }}
            </button>
            <p class="hint">{{ t('surveymissionview.one_click_hint') }}</p>
          </section>

          <section class="card">
            <h3>{{ t('surveymissionview.task1') }}</h3>
            <label>
              {{ t('surveymissionview.place') }}
              <input v-model="place" type="text" @keyup.enter="makePlan" list="survey-places" />
            </label>
            <div v-if="placeHints.length" class="chips">
              <button
                v-for="p in placeHints.slice(0, 10)"
                :key="p.label"
                type="button"
                class="chip"
                @click="pickPlace(p)"
              >{{ p.label.split(',')[0] }}</button>
            </div>
            <div class="row">
              <label>
                {{ t('surveymissionview.radius') }}
                <input v-model.number="radiusM" type="number" min="20" max="500" />
              </label>
              <label>
                {{ t('surveymissionview.min_alt') }}
                <input v-model.number="minAltM" type="number" min="5" max="120" />
              </label>
              <label>
                {{ t('surveymissionview.photos') }}
                <input v-model.number="photoCount" type="number" min="5" max="12" />
              </label>
              <label>
                {{ t('surveymissionview.drones') }}
                <input v-model.number="droneCount" type="number" min="1" max="4" />
              </label>
            </div>
            <label class="check">
              <input v-model="followCam" type="checkbox" />
              {{ t('surveymissionview.follow_cam') }}
            </label>
            <label class="check">
              <input v-model="autoSim" type="checkbox" />
              {{ t('surveymissionview.auto_sim') }}
            </label>
            <div class="actions">
              <button type="button" class="btn" :disabled="busy" @click="makePlan">{{ t('surveymissionview.gen_plan') }}</button>
              <button type="button" class="btn btn--ghost" :disabled="!plan || busy" @click="runTask1Sim">{{ t('surveymissionview.sim_obs') }}</button>
            </div>
            <p v-if="err" class="err">{{ err }}</p>
            <p v-if="plan" class="hint ok">
              {{ plan.geo?.label }} · {{ plan.geo?.provider }} · {{ plan.geo?.lat?.toFixed?.(5) }}, {{ plan.geo?.lng?.toFixed?.(5) }} · {{ plan.viewpoints?.length }} pts
            </p>
            <p v-if="simMsg" class="hint">{{ simMsg }}</p>
            <p v-if="simPose" class="hint mono">
              {{ simPose.lat?.toFixed?.(5) }} , {{ simPose.lng?.toFixed?.(5) }} · {{ Math.round(simPose.alt_m || 0) }}m
              · {{ simPose.index + 1 }}/{{ simPose.total }}
            </p>
          </section>

          <section class="card">
            <h3>{{ t('surveymissionview.task2') }}</h3>
            <label class="check">
              <input v-model="dryRun" type="checkbox" />
              {{ t('surveymissionview.dry_run_opt') }}
            </label>
            <div class="actions">
              <button type="button" class="btn" :disabled="busy || !plan" @click="createAndConnectMission">{{ t('surveymissionview.create') }}</button>
              <button type="button" class="btn btn--go" :disabled="busy || !plan" @click="startMission">{{ t('surveymissionview.start') }}</button>
              <button type="button" class="btn btn--ghost" :disabled="mission?.status !== 'running'" @click="pauseMission">{{ t('surveymissionview.pause') }}</button>
              <button type="button" class="btn btn--ghost" :disabled="!mission || mission?.status === 'completed'" @click="cancelMission">{{ t('surveymissionview.cancel') }}</button>
              <button type="button" class="btn btn--ghost" :disabled="!mission" @click="retryMission">{{ t('surveymissionview.retry') }}</button>
            </div>
            <div v-if="mission" class="progress">
              <div class="progress__bar"><i :style="{ width: shotProgress.pct + '%' }" /></div>
              <span>{{ shotProgress.done }}/{{ shotProgress.total }} · {{ shotProgress.pct }}%</span>
            </div>
            <ul v-if="mission" class="shots">
              <li v-for="sh in mission.shots" :key="sh.shot_id" :data-st="sh.status">
                <span>{{ sh.shot_id }} · {{ sh.drone_id }} · {{ sh.status }}</span>
                <a v-if="sh.photo_url" :href="mediaUrl(sh.photo_url)" target="_blank" rel="noopener">{{ t('surveymissionview.view_photo') }}</a>
              </li>
            </ul>
          </section>

          <section class="card card--log" v-if="mission">
            <h3>{{ t('surveymissionview.commands') }}</h3>
            <div class="log">
              <div v-for="(c, i) in (mission.commands_tail || mission.commands || []).slice(-12).reverse()" :key="'c'+i">
                {{ (c.ts || '').slice(11, 19) }} · {{ c.action || c.type || c.cmd }}
              </div>
            </div>
            <h3>{{ t('surveymissionview.events') }}</h3>
            <div class="log">
              <div v-for="(e, i) in (mission.events_tail || mission.events || []).slice(-12).reverse()" :key="'e'+i">
                {{ (e.ts || '').slice(11, 19) }} · {{ e.kind }} {{ e.detail }}
              </div>
            </div>
          </section>

          <section class="card card--gallery" v-if="mission?.shots?.some(s => s.photo_url)">
            <h3>{{ t('surveymissionview.gallery') }}</h3>
            <p class="hint">{{ t('surveymissionview.gallery_hint') }}</p>
            <div class="gallery">
              <figure
                v-for="sh in mission.shots.filter(s => s.photo_url)"
                :key="sh.shot_id"
                class="gallery__item"
              >
                <a :href="mediaUrl(sh.photo_url)" target="_blank" rel="noopener" :title="t('surveymissionview.view_photo')">
                  <img :src="mediaUrl(sh.photo_url)" :alt="sh.shot_id" />
                </a>
                <figcaption>
                  <span>{{ sh.shot_id }}</span>
                  <a
                    class="dl"
                    :href="mediaUrl(sh.photo_url)"
                    :download="`${mission.mission_id || 'mission'}_${sh.shot_id}.jpg`"
                  >{{ t('surveymissionview.download_photo') }}</a>
                </figcaption>
              </figure>
            </div>
          </section>
        </div>
      </div>
    </template>
  </ViewComposer>
</template>

<style scoped>
.survey.view-composer__background,
.survey {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 0;
  display: flex;
  flex-direction: column;
  color: #e8f0ec;
  font-family: "Segoe UI", system-ui, sans-serif;
  background: transparent;
}
.survey__top {
  pointer-events: none;
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px 12px 88px;
  background: linear-gradient(180deg, rgba(8, 16, 14, 0.75), transparent);
  z-index: 3;
}
.survey__title { font-size: 1.15rem; font-weight: 700; }
.survey__sub { font-size: 0.8rem; opacity: 0.85; max-width: 42rem; }
.survey__badges {
  pointer-events: auto;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: flex-start;
  position: relative;
}
.pages-wrap { position: relative; }
.btn--pages { background: #1e4d7b !important; font-weight: 600; }
.pages-pop {
  position: absolute !important;
  right: 0;
  top: calc(100% + 6px);
  z-index: 200;
}
.badge {
  pointer-events: none;
  font-size: 0.72rem;
  padding: 4px 8px;
  border: 1px solid rgba(255,255,255,0.25);
  background: rgba(0,0,0,0.35);
  border-radius: 4px;
}
.badge[data-ok="true"] { border-color: #6dffa8; color: #b8ffd4; }
.badge[data-bad="true"] { border-color: #ff8a7a; color: #ffb4a8; }
.survey__panel {
  pointer-events: auto;
  margin: 0 12px 12px auto;
  width: min(420px, 92vw);
  max-height: calc(100% - 72px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  background: rgba(10, 18, 16, 0.82);
  border: 1px solid rgba(140, 180, 160, 0.25);
  border-radius: 8px;
  padding: 12px;
  backdrop-filter: blur(6px);
}
.card--steps { border-color: rgba(61, 142, 207, 0.45); }
.steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  margin-bottom: 10px;
}
.steps span {
  font-size: 0.68rem;
  text-align: center;
  padding: 6px 2px;
  border-radius: 4px;
  background: rgba(255,255,255,0.06);
  opacity: 0.55;
}
.steps span.on {
  opacity: 1;
  background: rgba(61, 142, 207, 0.35);
  color: #d7ecff;
}
.btn--block { width: 100%; padding: 10px; font-weight: 600; }
.card h3 { margin: 0 0 8px; font-size: 0.95rem; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 0.75rem; margin-bottom: 8px; }
input[type="text"], input[type="number"] {
  background: rgba(0,0,0,0.35);
  border: 1px solid rgba(255,255,255,0.2);
  color: inherit;
  border-radius: 4px;
  padding: 6px 8px;
}
.row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.chip {
  border: 1px solid rgba(120, 180, 200, 0.35);
  background: rgba(30, 70, 90, 0.55);
  color: #d7ecf5;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.7rem;
  cursor: pointer;
}
.chip:hover { background: rgba(40, 100, 120, 0.75); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.btn {
  border: 0;
  border-radius: 4px;
  padding: 6px 10px;
  background: #2a6b5a;
  color: #fff;
  cursor: pointer;
  font-size: 0.78rem;
}
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.btn--ghost { background: rgba(255,255,255,0.12); }
.btn--go { background: #3d8f3a; }
.check { flex-direction: row; align-items: center; gap: 8px; }
.hint { font-size: 0.72rem; opacity: 0.85; margin: 6px 0 0; }
.hint.ok { color: #9dffc2; }
.hint.mono { font-family: ui-monospace, Consolas, monospace; opacity: 0.75; }
.err { color: #ff8a7a; font-size: 0.75rem; margin-top: 6px; }
.progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 0.72rem;
}
.progress__bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: rgba(0,0,0,0.35);
  overflow: hidden;
}
.progress__bar i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #2a6b5a, #6dffa8);
  transition: width 0.25s ease;
}
.shots { list-style: none; padding: 0; margin: 8px 0 0; font-size: 0.75rem; }
.shots li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
.shots li[data-st="done"] { color: #8dffb0; }
.shots li[data-st="failed"] { color: #ff8a7a; }
.shots a { color: #9ad4ff; }
.log { font-size: 0.7rem; max-height: 120px; overflow: auto; opacity: 0.9; margin-bottom: 8px; }
.gallery { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.gallery__item { margin: 0; }
.gallery__item a { color: inherit; text-decoration: none; }
.gallery img { width: 100%; height: 88px; object-fit: cover; border-radius: 4px; background: #111; display: block; }
.gallery figcaption { display: flex; justify-content: space-between; gap: 6px; font-size: 0.7rem; margin-top: 4px; }
.gallery .dl { color: #8fd4c8; text-decoration: underline; }
.hint { margin: 0 0 8px; font-size: 0.72rem; opacity: 0.75; line-height: 1.35; }
</style>
