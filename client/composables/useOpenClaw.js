import { ref, computed, onUnmounted } from 'vue';
import config from '../config.json';
import { apiFetch, useAuth } from './useAuth.js';

const DEFAULT_URL = 'ws://127.0.0.1:18789';
const DEFAULT_SESSION_KEY = 'agent:main:main';
const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_DELAY_MS = 30000;

// config.json is bundled at build time (static JSON import), so its URL is
// only correct for the machine the build was made on. Resolve at runtime:
//   1. An explicitly configured non-loopback URL always wins (custom gateway).
//   2. Pages served over HTTPS must use wss:// (browsers block ws:// as mixed
//      content), and 127.0.0.1 in a visitor's browser means THEIR machine —
//      so go through Caddy's /ws reverse proxy on the same origin instead.
//   3. Otherwise (local dev) keep the loopback gateway on this machine.
function resolveGatewayUrl() {
  const configured = config.openclaw?.url || '';
  const isLoopback = /^wss?:\/\/(127\.0\.0\.1|localhost)([:/]|$)/.test(configured);
  if (configured && !isLoopback) return configured;
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${window.location.host}/ws`;
  }
  return configured || DEFAULT_URL;
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function formatTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function extractText(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.text === 'string' && message.text.length > 0) return message.text;
  if (typeof message.content === 'string' && message.content.length > 0) return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((block) => block && (block.type === 'text' || typeof block.text === 'string'))
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

// The OpenClaw gateway periodically emits a keep-alive assistant message whose
// text is "HEARTBEAT_OK". It is protocol plumbing, not conversation, so it must
// never be rendered as a chat bubble (live events or loaded history).
const HEARTBEAT_TEXT = 'HEARTBEAT_OK';

function isHeartbeatMessage(text) {
  return typeof text === 'string' && text.trim().toUpperCase() === HEARTBEAT_TEXT;
}

// True when a (possibly still-streaming) chunk can only be the keep-alive token,
// e.g. "HEART", "HEARTBEAT", "HEARTBEAT_OK". Used to suppress the partial bubble
// before the full token has arrived.
function isHeartbeatPrefix(text) {
  if (typeof text !== 'string') return false;
  const t = text.trim().toUpperCase();
  return t.length > 0 && HEARTBEAT_TEXT.startsWith(t);
}

export function useOpenClaw({ autoConnect = true, autoReconnect = true, clientId = 'openclaw-control-ui' } = {}) {
  const { isAuthenticated } = useAuth();
  const ws = ref(null);
  const status = ref('idle'); // idle | connecting | connected | auth_required | error | closed
  const error = ref(null);
  const messages = ref([]);
  const sessionKey = ref(null);
  const activeAgentId = ref('main');
  const preferredSessionKey = ref(DEFAULT_SESSION_KEY);
  const conversations = ref([]);
  const conversationId = ref('');
  const pendingRequests = new Map();
  const sessionMessages = new Map();

  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_DELAY_MS;
  let challengeResolved = false;
  let intentionallyClosed = false;
  let partialRunIds = new Map();
  let heartbeatRunIds = new Set();

  const isConnected = computed(() => status.value === 'connected');

  const gatewayUrl = resolveGatewayUrl();
  const gatewayToken = config.openclaw?.token || '';

  async function refreshConversations() {
    if (!isAuthenticated.value) return [];
    try {
      const res = await apiFetch('/api/openclaw/conversations');
      if (!res.ok) return [];
      conversations.value = await res.json();
    } catch {
      /* The gateway remains usable if the optional transcript index is offline. */
    }
    return conversations.value;
  }

  async function ensureConversation() {
    if (!isAuthenticated.value || !sessionKey.value) return null;
    try {
      const res = await apiFetch('/api/openclaw/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_id: activeAgentId.value,
          session_key: sessionKey.value,
          title: activeAgentId.value === 'main' ? 'OpenClaw 客服' : `Drone ${activeAgentId.value}`,
        }),
      });
      if (!res.ok) return null;
      const row = await res.json();
      conversationId.value = row.id || '';
      await refreshConversations();
      return row;
    } catch {
      return null;
    }
  }

  async function persistMessage(message, externalId = '') {
    if (!conversationId.value || !isAuthenticated.value || !message?.text) return;
    try {
      await apiFetch(`/api/openclaw/conversations/${conversationId.value}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: message.sender === 'user' ? 'user' : 'assistant',
          content: message.text,
          external_id: externalId || message.id || null,
        }),
      });
    } catch {
      /* Transcript persistence is best effort and must not block live chat. */
    }
  }

  function appendMessage(message) {
    messages.value.push(message);
    if (messages.value.length > 200) {
      messages.value.shift();
    }
    if (sessionKey.value) sessionMessages.set(sessionKey.value, messages.value);
  }

  function sendRaw(obj) {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('WebSocket is not open'));
    }
    const id = generateId();
    const frame = { ...obj, id };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Request ${obj.method || obj.event} timed out`));
      }, 30000);
      pendingRequests.set(id, { resolve, reject, timeout });
      ws.value.send(JSON.stringify(frame));
    });
  }

  function sendRequest(method, params = {}) {
    return sendRaw({ type: 'req', method, params });
  }

  function handleFrame(data) {
    let frame;
    try {
      frame = JSON.parse(data);
    } catch (e) {
      console.warn('[OpenClaw] Invalid JSON frame:', data);
      return;
    }

    if (frame.type === 'event') {
      if (frame.event === 'connect.challenge') {
        performHandshake(frame.payload);
        return;
      }
      if (frame.event === 'chat') {
        handleChatEvent(frame.payload);
        return;
      }
      return;
    }

    if (frame.type === 'res') {
      const pending = pendingRequests.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(frame.id);
      if (frame.ok) {
        pending.resolve(frame.payload);
      } else {
        pending.reject(new Error(frame.error?.message || 'OpenClaw request failed'));
      }
    }
  }

  async function performHandshake(challengePayload) {
    if (challengeResolved) return;
    challengeResolved = true;

    try {
      await sendRequest('connect', {
        minProtocol: 4,
        maxProtocol: 4,
        client: {
          id: clientId,
          version: '1.0.0',
          platform: 'web',
          mode: 'webchat',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        caps: [],
        auth: { token: gatewayToken },
      });

      status.value = 'connected';
      error.value = null;
      reconnectDelay = RECONNECT_DELAY_MS;
      await initSession();
      await ensureConversation();
      await loadHistory();
      await refreshConversations();
    } catch (e) {
      error.value = e.message || 'Handshake failed';
      status.value = 'error';
      close();
    }
  }

  async function initSession() {
    if (preferredSessionKey.value && preferredSessionKey.value !== DEFAULT_SESSION_KEY) {
      sessionKey.value = preferredSessionKey.value;
      return;
    }
    if (activeAgentId.value !== 'main') {
      const key = preferredSessionKey.value || `agent:${activeAgentId.value}:main`;
      try {
        const created = await sendRequest('sessions.create', {
          key,
          agentId: activeAgentId.value,
        });
        sessionKey.value = created?.key || key;
      } catch (e) {
        // Existing sessions may reject a duplicate create. The deterministic
        // key is still valid and chat.history confirms availability.
        sessionKey.value = key;
      }
      return;
    }
    try {
      const list = await sendRequest('sessions.list', { limit: 1 });
      if (list?.sessions && list.sessions.length > 0 && list.sessions[0]?.key) {
        sessionKey.value = list.sessions[0].key;
        return;
      }
    } catch (e) {
      console.warn('[OpenClaw] sessions.list failed:', e.message);
    }

    try {
      const created = await sendRequest('sessions.create', {
        key: DEFAULT_SESSION_KEY,
        agentId: 'main',
      });
      if (created?.key) {
        sessionKey.value = created.key;
        return;
      }
    } catch (e) {
      console.warn('[OpenClaw] sessions.create failed:', e.message);
    }

    sessionKey.value = DEFAULT_SESSION_KEY;
  }

  async function loadHistory() {
    if (!sessionKey.value) return;
    try {
      const history = await sendRequest('chat.history', {
        sessionKey: sessionKey.value,
        limit: 50,
      });
      if (history?.messages && Array.isArray(history.messages)) {
        const restored = history.messages
          .filter((entry) => {
            const role = typeof entry.role === 'string' ? entry.role.toLowerCase() : '';
            if (role !== 'user' && role !== 'assistant') return false;
            // Drop gateway keep-alive messages from the rendered history.
            return !isHeartbeatMessage(extractText(entry));
          })
          .map((entry) => ({
            id: entry.messageId || entry.id || generateId(),
            sender: entry.role.toLowerCase() === 'user' ? 'user' : 'bot',
            text: extractText(entry),
            time: formatTime(entry.timestamp),
            externalId: entry.messageId || entry.id || '',
          }));
        messages.value = restored;
        sessionMessages.set(sessionKey.value, messages.value);
        await Promise.all(restored.map((entry) => persistMessage(entry, entry.externalId)));
      }
    } catch (e) {
      console.warn('[OpenClaw] Failed to load history:', e.message);
    }
  }

  function handleChatEvent(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.sessionKey && sessionKey.value && payload.sessionKey !== sessionKey.value) return;
    const state = payload.state;
    const message = payload.message;
    const runId = payload.runId;
    const role = message?.role ? String(message.role).toLowerCase() : '';
    const text = extractText(message);

    if (role !== 'assistant' || !text) return;

    if (state === 'partial' && runId) {
      // A run that only ever streams the keep-alive token must not produce a
      // bubble. Track it and suppress every subsequent chunk for this run.
      if (heartbeatRunIds.has(runId)) return;
      if (isHeartbeatPrefix(text)) {
        heartbeatRunIds.add(runId);
        return;
      }
      const existing = partialRunIds.get(runId);
      if (existing) {
        existing.text = text;
      } else {
        const msg = {
          id: generateId(),
          sender: 'bot',
          text,
          time: formatTime(),
          runId,
        };
        partialRunIds.set(runId, msg);
        appendMessage(msg);
      }
      return;
    }

    if (state === 'final') {
      if (runId && heartbeatRunIds.has(runId)) {
        heartbeatRunIds.delete(runId);
        return;
      }
      // Ignore the gateway keep-alive message; it is not part of the conversation.
      if (isHeartbeatMessage(text)) return;
      if (runId && partialRunIds.has(runId)) {
        const partial = partialRunIds.get(runId);
        partial.text = text;
        partialRunIds.delete(runId);
        void persistMessage(partial, message.messageId || message.id || runId || partial.id);
        return;
      }
      const finalMessage = {
        id: generateId(),
        sender: 'bot',
        text,
        time: formatTime(),
      };
      appendMessage(finalMessage);
      void persistMessage(finalMessage, message.messageId || message.id || runId || finalMessage.id);
    }
  }

  async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (!isConnected.value || !sessionKey.value) {
      error.value = 'Not connected to OpenClaw gateway';
      return false;
    }

    const outgoing = {
      id: generateId(),
      sender: 'user',
      text: trimmed,
      time: formatTime(),
    };
    appendMessage(outgoing);

    try {
      await sendRequest('chat.send', {
        sessionKey: sessionKey.value,
        message: trimmed,
        idempotencyKey: generateId(),
      });
      void persistMessage(outgoing, outgoing.id);
      return true;
    } catch (e) {
      error.value = e.message || 'Failed to send message';
      return false;
    }
  }

  // Explicit, user-triggered bridge from the flight deck to OpenClaw. The
  // payload is read-only context; it never calls the flight-command socket.
  async function sendFleetContext(context) {
    const payload = JSON.stringify(context);
    const sent = await sendMessage(
      `[DRONE_FLEET_CONTEXT]\n${payload}\n[/DRONE_FLEET_CONTEXT]\n` +
      'Use this as read-only situational context. Do not issue flight commands from this message.'
    );
    if (!sent) throw new Error('OpenClaw context was not sent');
    return sent;
  }

  async function selectAgent({ agentId = 'main', sessionKey: nextSessionKey = '' } = {}) {
    if (sessionKey.value) sessionMessages.set(sessionKey.value, messages.value);
    activeAgentId.value = agentId || 'main';
    preferredSessionKey.value = nextSessionKey
      || (activeAgentId.value === 'main' ? DEFAULT_SESSION_KEY : `agent:${activeAgentId.value}:main`);
    partialRunIds = new Map();
    heartbeatRunIds = new Set();
    messages.value = sessionMessages.get(preferredSessionKey.value) || [];
    if (!isConnected.value) {
      sessionKey.value = preferredSessionKey.value;
      return;
    }
    await initSession();
    await ensureConversation();
    messages.value = sessionMessages.get(sessionKey.value) || [];
    await loadHistory();
  }

  function connect() {
    if (ws.value) return;
    if (!isAuthenticated.value) {
      status.value = 'auth_required';
      error.value = 'login_required';
      return;
    }
    // Manual reconnect after an intentional close is allowed. The existing
    // auto-reconnect path still remains gated by intentionallyClosed.
    intentionallyClosed = false;
    status.value = 'connecting';
    error.value = null;
    challengeResolved = false;

    try {
      ws.value = new WebSocket(gatewayUrl);
    } catch (e) {
      error.value = e.message;
      status.value = 'error';
      scheduleReconnect();
      return;
    }

    ws.value.addEventListener('message', (event) => {
      handleFrame(event.data);
    });

    ws.value.addEventListener('close', () => {
      status.value = 'closed';
      ws.value = null;
      if (!intentionallyClosed) {
        scheduleReconnect();
      }
    });

    ws.value.addEventListener('error', () => {
      error.value = 'WebSocket error';
      status.value = 'error';
    });
  }

  function scheduleReconnect() {
    if (!autoReconnect || reconnectTimer || intentionallyClosed) return;
    status.value = 'closed';
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY_MS);
  }

  function close() {
    intentionallyClosed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }
  }

  onUnmounted(() => {
    close();
    pendingRequests.forEach((pending) => clearTimeout(pending.timeout));
    pendingRequests.clear();
  });

  if (autoConnect) connect();

  return {
    status,
    error,
    messages,
    isConnected,
    sendMessage,
    sendFleetContext,
    selectAgent,
    activeAgentId,
    sessionKey,
    conversations,
    conversationId,
    refreshConversations,
    connect,
    close,
  };
}
