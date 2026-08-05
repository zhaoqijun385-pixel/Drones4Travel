import { computed, reactive } from 'vue';
import { useAuth } from './useAuth.js';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';
const records = reactive({});

export function useDroneAgents() {
  const { token } = useAuth();

  async function request(path, options = {}) {
    if (!token.value) throw new Error('login_required');
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.value}`,
        ...(options.headers || {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.detail || `agent_http_${response.status}`);
    return body;
  }

  async function refresh() {
    if (!token.value) return [];
    const list = await request('/api/fleet/agents');
    Object.keys(records).forEach((key) => delete records[key]);
    list.forEach((record) => { records[record.droneId] = record; });
    return list;
  }

  async function provision(drone) {
    if (!drone?.droneId) throw new Error('invalid_drone');
    records[drone.droneId] = {
      droneId: drone.droneId,
      agentId: '',
      sessionKey: '',
      status: token.value ? 'provisioning' : 'login_required',
    };
    if (!token.value) return records[drone.droneId];
    try {
      const record = await request(`/api/fleet/agents/${encodeURIComponent(drone.droneId)}`, {
        method: 'POST',
        body: JSON.stringify({ name: drone.name || drone.droneId }),
      });
      records[drone.droneId] = record;
      return record;
    } catch (error) {
      records[drone.droneId] = {
        ...records[drone.droneId],
        status: 'error',
        error: error.message,
      };
      throw error;
    }
  }

  async function archive(droneId) {
    if (!token.value || !records[droneId]) return null;
    const record = await request(`/api/fleet/agents/${encodeURIComponent(droneId)}`, {
      method: 'DELETE',
    });
    records[droneId] = record;
    return record;
  }

  return {
    records,
    list: computed(() => Object.values(records)),
    refresh,
    provision,
    archive,
  };
}

