<script setup>
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import ConfigurableIcon from './ConfigurableIcon.vue';

const { t } = useI18n();

const props = defineProps({
  open: { type: Boolean, default: false },
  status: { type: String, default: 'idle' },
  isConnected: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] },
  drones: { type: Array, default: () => [] },
  selectedDroneId: { type: String, default: '' },
  selectedDrone: { type: Object, default: null },
  fleetEnabled: { type: Boolean, default: false },
  pendingCommand: { type: Object, default: null },
  notice: { type: String, default: '' },
});

const emit = defineEmits([
  'close',
  'connect',
  'send',
  'select-drone',
  'prepare-command',
  'confirm-command',
  'cancel-command',
]);

const input = ref('');
const messagesRef = ref(null);

const commandSuggestions = [
  { action: 'hover', labelKey: 'aerialview.command_hover' },
  { action: 'forward', labelKey: 'aerialview.command_forward' },
  { action: 'left', labelKey: 'aerialview.command_left' },
  { action: 'up', labelKey: 'aerialview.command_up' },
  { action: 'land', labelKey: 'aerialview.command_land' },
];

function sendMessage() {
  const text = input.value.trim();
  if (!text || !props.isConnected) return;
  emit('send', text);
  input.value = '';
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesRef.value) messagesRef.value.scrollTop = messagesRef.value.scrollHeight;
  });
}

watch(() => props.messages.length, scrollToBottom);
watch(() => props.open, (open) => {
  if (open) scrollToBottom();
});
</script>

<template>
  <aside v-if="open" class="openclaw-panel" aria-label="OpenClaw flight assistant">
    <header class="openclaw-panel__header">
      <div class="openclaw-panel__identity">
        <span class="openclaw-panel__avatar"><ConfigurableIcon name="AGENT_OPENCLAW" :size="22" /></span>
        <div>
          <strong>OpenClaw</strong>
          <span class="openclaw-panel__subtitle">{{ t('aerialview.openclaw_flight_assistant') }}</span>
        </div>
      </div>
      <div class="openclaw-panel__header-actions">
        <span class="openclaw-panel__status" :class="`openclaw-panel__status--${status}`">
          {{ isConnected ? t('aerialview.openclaw_connected') : t('aerialview.openclaw_offline') }}
        </span>
        <button type="button" class="openclaw-panel__close" :aria-label="t('aerialview.openclaw_close')" @click="emit('close')">×</button>
      </div>
    </header>

    <div class="openclaw-panel__target">
      <label for="openclaw-target">{{ t('aerialview.openclaw_target') }}</label>
      <select
        id="openclaw-target"
        :value="selectedDroneId"
        :disabled="!fleetEnabled || !drones.length"
        @change="emit('select-drone', $event.target.value)"
      >
        <option v-if="!fleetEnabled" value="">{{ t('aerialview.openclaw_enable_fleet_first') }}</option>
        <option v-else-if="!drones.length" value="">{{ t('aerialview.openclaw_no_drones') }}</option>
        <option v-for="drone in drones" :key="drone.droneId" :value="drone.droneId">
          {{ drone.name }}{{ drone.local ? ` · ${t('aerialview.openclaw_local')}` : '' }}
        </option>
      </select>
      <span v-if="selectedDrone" class="openclaw-panel__target-meta">
        {{ selectedDrone.battery.toFixed(0) }}% · {{ selectedDrone.online ? t('aerialview.openclaw_online') : t('aerialview.openclaw_offline_short') }}
      </span>
    </div>

    <div ref="messagesRef" class="openclaw-panel__messages">
      <div v-if="!messages.length" class="openclaw-panel__empty">
        {{ t('aerialview.openclaw_empty') }}
      </div>
      <div
        v-for="message in messages"
        :key="message.id"
        class="openclaw-panel__message"
        :class="`openclaw-panel__message--${message.sender}`"
      >
        <span class="openclaw-panel__message-role">{{ message.sender === 'user' ? t('aerialview.openclaw_you') : 'OpenClaw' }}</span>
        <p>{{ message.text }}</p>
      </div>
    </div>

    <div class="openclaw-panel__commands">
      <span class="openclaw-panel__section-label">{{ t('aerialview.openclaw_command_shortcuts') }}</span>
      <div class="openclaw-panel__command-grid">
        <button
          v-for="suggestion in commandSuggestions"
          :key="suggestion.action"
          type="button"
          :disabled="!fleetEnabled || !selectedDrone || selectedDrone.local || !selectedDrone.online"
          @click="emit('prepare-command', suggestion.action)"
        >
          {{ t(suggestion.labelKey) }}
        </button>
      </div>
    </div>

    <div v-if="pendingCommand" class="openclaw-panel__confirm">
      <strong>{{ t('aerialview.openclaw_confirm_title') }}</strong>
      <p>{{ t('aerialview.openclaw_confirm_body', { drone: pendingCommand.droneName, command: pendingCommand.label }) }}</p>
      <div class="openclaw-panel__confirm-actions">
        <button type="button" class="openclaw-panel__confirm-cancel" @click="emit('cancel-command')">{{ t('aerialview.openclaw_cancel') }}</button>
        <button type="button" class="openclaw-panel__confirm-ok" @click="emit('confirm-command')">{{ t('aerialview.openclaw_confirm') }}</button>
      </div>
    </div>

    <p v-if="notice" class="openclaw-panel__notice">{{ notice }}</p>

    <footer class="openclaw-panel__composer">
      <textarea
        v-model="input"
        rows="1"
        :disabled="!isConnected"
        :placeholder="isConnected ? t('aerialview.openclaw_input') : t('aerialview.openclaw_connect_hint')"
        @keydown="handleKeydown"
      />
      <button type="button" class="openclaw-panel__send" :disabled="!isConnected || !input.trim()" @click="sendMessage">
        <ConfigurableIcon name="CHAT_SEND" :size="17" />
      </button>
    </footer>
    <button v-if="!isConnected" type="button" class="openclaw-panel__connect" @click="emit('connect')">
      {{ t('aerialview.openclaw_reconnect') }}
    </button>
  </aside>
</template>

<style scoped>
.openclaw-panel {
  position: fixed;
  right: 94px;
  bottom: 24px;
  z-index: 75;
  display: flex;
  flex-direction: column;
  width: min(390px, calc(100vw - 150px));
  max-height: min(650px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid rgba(164, 111, 255, 0.45);
  border-radius: 14px;
  background: rgba(12, 10, 25, 0.94);
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.48), inset 0 1px rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(18px);
  color: rgba(247, 243, 255, 0.94);
  font-family: Calibri, 'Segoe UI', sans-serif;
  pointer-events: auto;
}

.openclaw-panel__header,
.openclaw-panel__identity,
.openclaw-panel__header-actions,
.openclaw-panel__composer,
.openclaw-panel__confirm-actions {
  display: flex;
  align-items: center;
}

.openclaw-panel__header {
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.openclaw-panel__identity { gap: 9px; }
.openclaw-panel__avatar {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  color: #d8b4fe;
  background: rgba(168, 85, 247, 0.18);
}
.openclaw-panel__identity strong,
.openclaw-panel__subtitle { display: block; }
.openclaw-panel__identity strong { font-size: 0.86rem; letter-spacing: 0.04em; }
.openclaw-panel__subtitle { margin-top: 2px; color: rgba(232, 220, 255, 0.56); font-size: 0.68rem; }
.openclaw-panel__header-actions { gap: 8px; }
.openclaw-panel__status {
  padding: 4px 7px;
  border-radius: 99px;
  color: #f8d789;
  background: rgba(234, 179, 8, 0.14);
  font-size: 0.62rem;
  white-space: nowrap;
}
.openclaw-panel__status--connected { color: #a7f3d0; background: rgba(16, 185, 129, 0.16); }
.openclaw-panel__close {
  border: 0;
  color: rgba(247, 243, 255, 0.65);
  background: transparent;
  font-size: 1.4rem;
  line-height: 1;
  cursor: pointer;
}

.openclaw-panel__target { padding: 10px 14px 8px; }
.openclaw-panel__target label,
.openclaw-panel__section-label { display: block; margin-bottom: 5px; color: rgba(232, 220, 255, 0.55); font-size: 0.66rem; }
.openclaw-panel__target select {
  width: 100%;
  padding: 8px 9px;
  border: 1px solid rgba(164, 111, 255, 0.34);
  border-radius: 7px;
  color: #f7f3ff;
  background: rgba(255, 255, 255, 0.06);
  font: inherit;
  font-size: 0.76rem;
}
.openclaw-panel__target select:disabled { opacity: 0.55; }
.openclaw-panel__target-meta { display: block; margin-top: 4px; color: rgba(232, 220, 255, 0.5); font-size: 0.64rem; }

.openclaw-panel__messages {
  min-height: 110px;
  max-height: 230px;
  overflow-y: auto;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.14);
}
.openclaw-panel__empty { padding: 26px 8px; color: rgba(232, 220, 255, 0.52); font-size: 0.74rem; text-align: center; }
.openclaw-panel__message { max-width: 88%; margin: 7px 0; padding: 8px 10px; border-radius: 9px; background: rgba(255, 255, 255, 0.07); }
.openclaw-panel__message--user { margin-left: auto; background: rgba(124, 58, 237, 0.35); }
.openclaw-panel__message-role { color: rgba(232, 220, 255, 0.5); font-size: 0.6rem; }
.openclaw-panel__message p { margin: 3px 0 0; white-space: pre-wrap; word-break: break-word; font-size: 0.76rem; line-height: 1.4; }

.openclaw-panel__commands { padding: 9px 14px 7px; }
.openclaw-panel__command-grid { display: flex; flex-wrap: wrap; gap: 5px; }
.openclaw-panel__command-grid button,
.openclaw-panel__connect,
.openclaw-panel__confirm button {
  padding: 6px 8px;
  border: 1px solid rgba(164, 111, 255, 0.35);
  border-radius: 6px;
  color: #eee5ff;
  background: rgba(164, 111, 255, 0.1);
  font: inherit;
  font-size: 0.67rem;
  cursor: pointer;
}
.openclaw-panel__command-grid button:disabled { cursor: not-allowed; opacity: 0.35; }
.openclaw-panel__command-grid button:hover:not(:disabled),
.openclaw-panel__connect:hover,
.openclaw-panel__confirm button:hover { background: rgba(164, 111, 255, 0.25); }

.openclaw-panel__confirm { margin: 0 14px 8px; padding: 10px; border: 1px solid rgba(246, 196, 83, 0.55); border-radius: 8px; background: rgba(246, 196, 83, 0.1); }
.openclaw-panel__confirm strong { color: #f6d783; font-size: 0.75rem; }
.openclaw-panel__confirm p { margin: 5px 0 9px; color: rgba(255, 247, 220, 0.78); font-size: 0.7rem; line-height: 1.35; }
.openclaw-panel__confirm-actions { justify-content: flex-end; gap: 6px; }
.openclaw-panel__confirm-cancel { border-color: rgba(255, 255, 255, 0.18) !important; }
.openclaw-panel__confirm-ok { border-color: rgba(248, 113, 113, 0.6) !important; color: #fecaca !important; background: rgba(185, 28, 28, 0.25) !important; }
.openclaw-panel__notice { margin: 0 14px 8px; color: #a7f3d0; font-size: 0.68rem; line-height: 1.35; }

.openclaw-panel__composer { gap: 7px; padding: 10px 14px 8px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
.openclaw-panel__composer textarea { flex: 1; resize: none; min-height: 20px; max-height: 76px; padding: 8px 10px; border: 1px solid rgba(164, 111, 255, 0.28); border-radius: 8px; color: #f7f3ff; background: rgba(255, 255, 255, 0.06); font: inherit; font-size: 0.74rem; outline: none; }
.openclaw-panel__composer textarea:focus { border-color: #c084fc; }
.openclaw-panel__composer textarea:disabled { opacity: 0.5; }
.openclaw-panel__send { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border: 0; border-radius: 8px; color: #fff; background: #7c3aed; cursor: pointer; }
.openclaw-panel__send:disabled { cursor: not-allowed; opacity: 0.4; }
.openclaw-panel__connect { margin: 0 14px 12px; }

@media (max-width: 768px) {
  .openclaw-panel { right: 68px; bottom: 14px; width: min(350px, calc(100vw - 82px)); max-height: min(55vh, calc(100vh - 28px)); }
}
</style>
