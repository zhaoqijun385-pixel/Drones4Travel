<script setup>
import { computed, h, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ViewComposer from '@shared/_ViewComposer.vue';
import DockMenuButton from '@shared/DockMenuButton.vue';
import { useDockRegistry } from '@shared-composables/useDockRegistry.js';
import { usePageRegistry } from '@shared-composables/usePageRegistry.js';
import { useMissionReports } from '@shared-composables/useMissionReports.js';
import {
  blankCapture,
  blankLocation,
  buildReportPayload,
  fileToDataUrl,
  summarizeReportDraft,
} from '@shared-composables/missionReportPayload.js';

const { t } = useI18n();
const { leftItems, registerLeft, clear } = useDockRegistry();
const { pages, registerPage, unregisterPage } = usePageRegistry();
const {
  reports,
  loading,
  saving,
  error,
  fetchReports,
  createReport,
  downloadReport,
} = useMissionReports();

const selectedReportId = ref('');
const formError = ref('');
const createdNotice = ref('');

const draft = reactive({
  title: `Low-altitude observation ${new Date().toISOString().slice(0, 10)}`,
  summary: '',
  roomId: 'local-flight-room',
  missionId: '',
  locations: [blankLocation(1)],
});

const draftSummary = computed(() => summarizeReportDraft(draft));
const selectedReport = computed(() =>
  reports.value.find((report) => report.id === selectedReportId.value) || reports.value[0] || null,
);
const canCreate = computed(() =>
  !saving.value
  && String(draft.title || '').trim()
  && draft.locations.length
  && draftSummary.value.captureCount > 0,
);

function registerCorePages() {
  registerPage({ id: 'aerial', nameKey: 'aerialview.page_aerial', route: '/' });
  registerPage({ id: 'map', nameKey: 'aerialview.page_map', route: '/map' });
  registerPage({ id: 'realdrone', nameKey: 'aerialview.page_realdrone', route: '/real-drone' });
  registerPage({ id: 'reports', nameKey: 'aerialview.page_reports', route: '/reports' });
  registerPage({ id: 'extensions', nameKey: 'aerialview.page_extensions', route: '/extensions' });
  registerPage({ id: 'chat', nameKey: 'aerialview.page_chat', route: '/chat' });
  registerPage({ id: 'myspace', nameKey: 'aerialview.page_myspace', route: '/myspace' });
}

function unregisterCorePages() {
  ['aerial', 'realdrone', 'map', 'reports', 'myspace', 'chat', 'extensions'].forEach(unregisterPage);
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
}

function statusText(status) {
  return t(`reportsview.safety_${status || 'insufficient_telemetry'}`);
}

function addLocation() {
  draft.locations.push(blankLocation(draft.locations.length + 1));
}

function removeLocation(index) {
  if (draft.locations.length <= 1) return;
  draft.locations.splice(index, 1);
}

function addBlankCapture(location) {
  location.captures.push(blankCapture({
    vantageLabel: `View ${location.captures.length + 1}`,
    capturedAt: new Date().toISOString().slice(0, 16),
  }));
}

function removeCapture(location, index) {
  location.captures.splice(index, 1);
}

async function onPhotoFiles(location, event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    location.captures.push(blankCapture({
      filename: file.name,
      contentType: file.type || 'image/png',
      dataUrl,
      vantageLabel: `View ${location.captures.length + 1}`,
      capturedAt: new Date().toISOString().slice(0, 16),
    }));
  }
  event.target.value = '';
}

async function submitReport() {
  formError.value = '';
  createdNotice.value = '';
  if (!canCreate.value) {
    formError.value = t('reportsview.error_need_photo');
    return;
  }
  try {
    const created = await createReport(buildReportPayload(draft));
    selectedReportId.value = created.id;
    createdNotice.value = t('reportsview.created');
  } catch {
    formError.value = t('reportsview.error_create');
  }
}

watch(reports, (items) => {
  if (!selectedReportId.value && items.length) selectedReportId.value = items[0].id;
});

onMounted(() => {
  registerCorePages();
  registerLeft({
    id: 'router',
    render: () => h(DockMenuButton, {
      icon: 'MENU_ROUTER',
      titleKey: 'aerialview.pages',
      pages,
    }),
  });
  fetchReports().catch(() => {});
});

onUnmounted(() => {
  clear();
  unregisterCorePages();
});
</script>

<template>
  <ViewComposer
    :left-items="leftItems"
    :right-items="[]"
    :show-flight="false"
    :show-camera="false"
    :show-hud="false"
    :flight="{ mode: '-', vx: 0, vy: 0, yaw: 0, vz: 0 }"
    :camera="{ mode: '-', yaw: 0, pitch: 0, roll: 0 }"
  >
    <template #background>
      <div class="reports-page">
        <aside class="reports-sidebar">
          <div class="reports-sidebar__header">
            <h1>{{ t('reportsview.title') }}</h1>
            <button
              type="button"
              class="compact-action"
              :disabled="loading"
              @click="fetchReports"
            >
              {{ t('reportsview.refresh') }}
            </button>
          </div>

          <div class="report-stats">
            <span>{{ reports.length }}</span>
            <span>{{ t('reportsview.saved_reports') }}</span>
          </div>

          <div class="report-list">
            <button
              v-for="report in reports"
              :key="report.id"
              type="button"
              class="report-list__item"
              :class="{ 'report-list__item--active': selectedReport?.id === report.id }"
              @click="selectedReportId = report.id"
            >
              <strong>{{ report.title }}</strong>
              <span>{{ formatDate(report.createdAt) }}</span>
              <span>{{ report.locationCount }} {{ t('reportsview.locations') }} / {{ report.captureCount }} {{ t('reportsview.photos') }}</span>
            </button>
            <p v-if="!loading && !reports.length" class="empty-state">{{ t('reportsview.empty') }}</p>
          </div>
        </aside>

        <main class="reports-workspace">
          <section class="report-detail">
            <div>
              <p class="eyebrow">{{ t('reportsview.latest_report') }}</p>
              <h2>{{ selectedReport?.title || t('reportsview.no_report') }}</h2>
              <p v-if="selectedReport" class="muted">{{ selectedReport.summary || t('reportsview.no_summary') }}</p>
            </div>
            <div class="detail-actions">
              <span v-if="selectedReport" class="detail-pill">{{ selectedReport.captureCount }} {{ t('reportsview.photos') }}</span>
              <button
                type="button"
                class="primary-action"
                :disabled="!selectedReport"
                @click="downloadReport(selectedReport)"
              >
                {{ t('reportsview.download_pdf') }}
              </button>
            </div>
          </section>

          <section class="draft-overview">
            <div>
              <p class="eyebrow">{{ t('reportsview.draft') }}</p>
              <h2>{{ t('reportsview.generate_pdf') }}</h2>
            </div>
            <div class="summary-grid">
              <div>
                <span>{{ draftSummary.locationCount }}</span>
                <small>{{ t('reportsview.locations') }}</small>
              </div>
              <div>
                <span>{{ draftSummary.captureCount }}</span>
                <small>{{ t('reportsview.photos') }}</small>
              </div>
              <div :class="`safety-${draftSummary.safety.status}`">
                <span>{{ draftSummary.safety.warningCount }}</span>
                <small>{{ statusText(draftSummary.safety.status) }}</small>
              </div>
            </div>
          </section>

          <form class="report-form" @submit.prevent="submitReport">
            <div class="form-grid form-grid--top">
              <label>
                <span>{{ t('reportsview.report_title') }}</span>
                <input v-model="draft.title" type="text" maxlength="180">
              </label>
              <label>
                <span>{{ t('reportsview.room_id') }}</span>
                <input v-model="draft.roomId" type="text" maxlength="120">
              </label>
              <label>
                <span>{{ t('reportsview.mission_id') }}</span>
                <input v-model="draft.missionId" type="text" maxlength="160">
              </label>
            </div>

            <label class="full-label">
              <span>{{ t('reportsview.summary') }}</span>
              <textarea v-model="draft.summary" rows="3" maxlength="2000" />
            </label>

            <section
              v-for="(location, locationIndex) in draft.locations"
              :key="location.id"
              class="location-section"
            >
              <div class="location-section__header">
                <h3>{{ t('reportsview.location') }} {{ locationIndex + 1 }}</h3>
                <button
                  type="button"
                  class="compact-action"
                  :disabled="draft.locations.length <= 1"
                  @click="removeLocation(locationIndex)"
                >
                  {{ t('reportsview.remove') }}
                </button>
              </div>

              <div class="form-grid">
                <label>
                  <span>{{ t('reportsview.location_title') }}</span>
                  <input v-model="location.title" type="text" maxlength="180">
                </label>
                <label>
                  <span>{{ t('reportsview.address') }}</span>
                  <input v-model="location.address" type="text" maxlength="500">
                </label>
              </div>

              <label class="full-label">
                <span>{{ t('reportsview.description') }}</span>
                <textarea v-model="location.description" rows="2" maxlength="1200" />
              </label>

              <div class="route-panel">
                <h4>{{ t('reportsview.route') }}</h4>
                <div class="form-grid">
                  <label>
                    <span>{{ t('reportsview.origin') }}</span>
                    <input v-model="location.route.origin.label" type="text">
                  </label>
                  <label>
                    <span>{{ t('reportsview.destination') }}</span>
                    <input v-model="location.route.destination.label" type="text">
                  </label>
                  <label>
                    <span>{{ t('reportsview.mode') }}</span>
                    <select v-model="location.route.mode">
                      <option value="walk">{{ t('reportsview.mode_walk') }}</option>
                      <option value="drive">{{ t('reportsview.mode_drive') }}</option>
                      <option value="fly">{{ t('reportsview.mode_fly') }}</option>
                      <option value="teleport">{{ t('reportsview.mode_teleport') }}</option>
                      <option value="mixed">{{ t('reportsview.mode_mixed') }}</option>
                    </select>
                  </label>
                </div>
                <div class="coordinate-grid">
                  <label><span>{{ t('reportsview.origin_lat') }}</span><input v-model="location.route.origin.lat" type="number" step="any"></label>
                  <label><span>{{ t('reportsview.origin_lon') }}</span><input v-model="location.route.origin.lon" type="number" step="any"></label>
                  <label><span>{{ t('reportsview.dest_lat') }}</span><input v-model="location.route.destination.lat" type="number" step="any"></label>
                  <label><span>{{ t('reportsview.dest_lon') }}</span><input v-model="location.route.destination.lon" type="number" step="any"></label>
                  <label><span>{{ t('reportsview.distance') }}</span><input v-model="location.route.distanceMeters" type="number" min="0" step="any"></label>
                  <label><span>{{ t('reportsview.duration') }}</span><input v-model="location.route.durationMinutes" type="number" min="0" step="any"></label>
                </div>
                <label class="full-label">
                  <span>{{ t('reportsview.route_steps') }}</span>
                  <textarea v-model="location.route.instructionsText" rows="3" />
                </label>
              </div>

              <div class="photo-toolbar">
                <label class="file-picker">
                  <input type="file" accept="image/*" multiple @change="onPhotoFiles(location, $event)">
                  <span>{{ t('reportsview.add_photos') }}</span>
                </label>
                <button type="button" class="compact-action" @click="addBlankCapture(location)">
                  {{ t('reportsview.add_capture') }}
                </button>
              </div>

              <div class="capture-list">
                <div
                  v-for="(capture, captureIndex) in location.captures"
                  :key="`${location.id}-${captureIndex}`"
                  class="capture-row"
                >
                  <img
                    v-if="capture.dataUrl"
                    class="capture-thumb"
                    :src="capture.dataUrl"
                    :alt="capture.filename || capture.vantageLabel"
                  >
                  <div v-else class="capture-thumb capture-thumb--empty">{{ t('reportsview.no_image') }}</div>
                  <div class="capture-fields">
                    <div class="form-grid">
                      <label><span>{{ t('reportsview.vantage') }}</span><input v-model="capture.vantageLabel" type="text"></label>
                      <label><span>{{ t('reportsview.drone_id') }}</span><input v-model="capture.droneId" type="text"></label>
                      <label><span>{{ t('reportsview.captured_at') }}</span><input v-model="capture.capturedAt" type="datetime-local"></label>
                    </div>
                    <div class="coordinate-grid">
                      <label><span>{{ t('reportsview.lat') }}</span><input v-model="capture.lat" type="number" step="any"></label>
                      <label><span>{{ t('reportsview.lon') }}</span><input v-model="capture.lon" type="number" step="any"></label>
                      <label><span>{{ t('reportsview.alt') }}</span><input v-model="capture.alt" type="number" step="any"></label>
                      <label><span>{{ t('reportsview.yaw') }}</span><input v-model="capture.yaw" type="number" step="any"></label>
                      <label><span>{{ t('reportsview.pitch') }}</span><input v-model="capture.pitch" type="number" step="any"></label>
                      <label><span>{{ t('reportsview.roll') }}</span><input v-model="capture.roll" type="number" step="any"></label>
                    </div>
                    <label class="full-label">
                      <span>{{ t('reportsview.note') }}</span>
                      <textarea v-model="capture.note" rows="2" maxlength="800" />
                    </label>
                  </div>
                  <button type="button" class="remove-capture" @click="removeCapture(location, captureIndex)">
                    {{ t('reportsview.remove') }}
                  </button>
                </div>
              </div>
            </section>

            <div class="form-actions">
              <button type="button" class="secondary-action" @click="addLocation">
                {{ t('reportsview.add_location') }}
              </button>
              <button type="submit" class="primary-action" :disabled="!canCreate">
                {{ saving ? t('reportsview.creating') : t('reportsview.create_pdf') }}
              </button>
            </div>

            <p v-if="formError || error" class="form-message form-message--error">{{ formError || error }}</p>
            <p v-if="createdNotice" class="form-message form-message--ok">{{ createdNotice }}</p>
          </form>
        </main>
      </div>
    </template>
  </ViewComposer>
</template>

<style scoped>
.reports-page {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: minmax(260px, 320px) 1fr;
  background: linear-gradient(135deg, #18202a 0%, #1e2b2f 48%, #202126 100%);
  color: #edf5f7;
  pointer-events: auto;
}

.reports-sidebar {
  min-width: 0;
  padding: 28px 18px 28px 84px;
  border-right: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(10, 15, 20, 0.45);
  overflow-y: auto;
}

.reports-sidebar__header,
.report-detail,
.draft-overview,
.location-section__header,
.photo-toolbar,
.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h1,
h2,
h3,
h4,
p {
  margin: 0;
}

h1 {
  font-size: 1.45rem;
  font-weight: 700;
}

h2 {
  font-size: 1.18rem;
  font-weight: 700;
}

h3 {
  font-size: 1rem;
}

h4 {
  font-size: 0.92rem;
  color: #cce3e6;
}

.eyebrow {
  margin-bottom: 4px;
  color: #8fd4c5;
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
}

.muted,
.empty-state {
  color: rgba(237, 245, 247, 0.68);
  font-size: 0.9rem;
}

.report-stats {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 20px 0 14px;
}

.report-stats span:first-child {
  font-size: 2rem;
  font-weight: 800;
  color: #f0c36a;
}

.report-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.report-list__item {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.report-list__item span {
  color: rgba(237, 245, 247, 0.64);
  font-size: 0.8rem;
}

.report-list__item--active {
  border-color: #8fd4c5;
  background: rgba(143, 212, 197, 0.14);
}

.reports-workspace {
  min-width: 0;
  padding: 28px 32px 42px;
  overflow-y: auto;
}

.report-detail,
.draft-overview,
.report-form {
  width: min(1120px, 100%);
}

.report-detail,
.draft-overview {
  margin-bottom: 16px;
  padding-bottom: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.detail-pill {
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(240, 195, 106, 0.18);
  color: #f4d28c;
  font-size: 0.82rem;
  font-weight: 700;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(100px, 1fr));
  gap: 10px;
  min-width: min(430px, 100%);
}

.summary-grid > div {
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
}

.summary-grid span {
  display: block;
  font-size: 1.3rem;
  font-weight: 800;
}

.summary-grid small {
  color: rgba(237, 245, 247, 0.65);
  font-size: 0.75rem;
}

.safety-warning span {
  color: #ffb86b;
}

.safety-clear span {
  color: #8fd4c5;
}

.safety-insufficient_telemetry span {
  color: #ccd6dd;
}

.report-form {
  display: grid;
  gap: 18px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  gap: 12px;
}

.form-grid--top {
  grid-template-columns: minmax(220px, 1.6fr) minmax(160px, 1fr) minmax(160px, 1fr);
}

.coordinate-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(92px, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 5px;
  min-width: 0;
  color: rgba(237, 245, 247, 0.72);
  font-size: 0.78rem;
  font-weight: 700;
}

input,
textarea,
select {
  width: 100%;
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  color: #f4fbfc;
  font: inherit;
  font-size: 0.9rem;
  padding: 9px 10px;
  box-sizing: border-box;
}

textarea {
  resize: vertical;
}

select option {
  color: #1d252b;
}

.full-label {
  width: 100%;
}

.location-section {
  display: grid;
  gap: 14px;
  padding: 18px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.14);
}

.route-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid rgba(143, 212, 197, 0.18);
  border-radius: 8px;
  background: rgba(143, 212, 197, 0.06);
}

.file-picker input {
  display: none;
}

.compact-action,
.secondary-action,
.primary-action,
.file-picker span,
.remove-capture {
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.08);
  color: #edf5f7;
  font-weight: 700;
  cursor: pointer;
}

.compact-action,
.file-picker span,
.remove-capture {
  padding: 8px 11px;
  font-size: 0.82rem;
}

.secondary-action,
.primary-action {
  padding: 11px 15px;
  font-size: 0.92rem;
}

.primary-action {
  border-color: rgba(143, 212, 197, 0.7);
  background: #8fd4c5;
  color: #142125;
}

button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.capture-list {
  display: grid;
  gap: 12px;
}

.capture-row {
  display: grid;
  grid-template-columns: 142px 1fr auto;
  gap: 14px;
  align-items: start;
  padding: 14px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.capture-thumb {
  width: 142px;
  aspect-ratio: 4 / 3;
  border-radius: 8px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.1);
}

.capture-thumb--empty {
  display: grid;
  place-items: center;
  color: rgba(237, 245, 247, 0.55);
  font-size: 0.78rem;
}

.capture-fields {
  display: grid;
  gap: 10px;
}

.form-message {
  padding: 10px 12px;
  border-radius: 8px;
  font-weight: 700;
}

.form-message--error {
  background: rgba(239, 68, 68, 0.14);
  color: #ffc3c3;
}

.form-message--ok {
  background: rgba(143, 212, 197, 0.14);
  color: #baf0e4;
}

@media (max-width: 980px) {
  .reports-page {
    grid-template-columns: 1fr;
  }

  .reports-sidebar {
    padding: 24px 18px 16px 84px;
    max-height: 280px;
  }

  .reports-workspace {
    padding: 22px 18px 36px 84px;
  }

  .form-grid,
  .form-grid--top,
  .coordinate-grid,
  .summary-grid,
  .capture-row {
    grid-template-columns: 1fr;
  }

  .capture-thumb {
    width: min(220px, 100%);
  }
}
</style>
