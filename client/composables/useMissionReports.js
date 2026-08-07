import { ref } from 'vue';
import { apiFetch } from './useAuth.js';

const reports = ref([]);
const loading = ref(false);
const saving = ref(false);
const error = ref('');

function filenameFor(report) {
  const base = String(report?.title || 'mission-report')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .slice(0, 80);
  return `${base || 'mission-report'}.pdf`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function readError(res, fallback) {
  try {
    const payload = await res.json();
    return payload?.detail || fallback;
  } catch {
    return fallback;
  }
}

export function useMissionReports() {
  async function fetchReports() {
    loading.value = true;
    error.value = '';
    try {
      const res = await apiFetch('/api/reports');
      if (!res.ok) throw new Error(await readError(res, 'reports_fetch_failed'));
      reports.value = await res.json();
      return reports.value;
    } catch (err) {
      error.value = err.message || 'reports_fetch_failed';
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function createReport(payload) {
    saving.value = true;
    error.value = '';
    try {
      const res = await apiFetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(await readError(res, 'report_create_failed'));
      const created = await res.json();
      reports.value = [created, ...reports.value.filter((item) => item.id !== created.id)];
      return created;
    } catch (err) {
      error.value = err.message || 'report_create_failed';
      throw err;
    } finally {
      saving.value = false;
    }
  }

  async function downloadReport(report) {
    if (!report?.id) return false;
    error.value = '';
    const res = await apiFetch(`/api/reports/${encodeURIComponent(report.id)}/download`);
    if (!res.ok) {
      error.value = await readError(res, 'report_download_failed');
      return false;
    }
    downloadBlob(await res.blob(), filenameFor(report));
    return true;
  }

  return {
    reports,
    loading,
    saving,
    error,
    fetchReports,
    createReport,
    downloadReport,
  };
}
