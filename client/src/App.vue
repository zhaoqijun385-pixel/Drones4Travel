<script setup>
import { RouterView } from 'vue-router';
import { watchEffect, onMounted } from 'vue';
import { useAppSettings } from '@shared-composables/useAppSettings.js';

const { settings } = useAppSettings();

const GOOGLE_FONTS = {
  'Calibri':      'Lato',
  'Segoe UI':     'Roboto',
  'Tahoma':       'Open Sans',
  'Verdana':      'Lora',
  'Noto Sans SC': 'Noto Sans SC',
  'Microsoft YaHei': 'Noto Sans SC',
};

let loadedFonts = new Set();

function loadGoogleFont(family) {
  const gFont = GOOGLE_FONTS[family];
  if (!gFont || loadedFonts.has(gFont)) return;
  loadedFonts.add(gFont);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(gFont)}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

onMounted(() => {
  document.documentElement.style.fontSize = settings.fontSize;
  loadGoogleFont(settings.fontFamily);
});

watchEffect(() => {
  loadGoogleFont(settings.fontFamily);
});

function buildFontFamily(selected) {
  const gFont = GOOGLE_FONTS[selected];
  const parts = [`'${selected}'`];
  if (gFont && gFont !== selected) parts.push(`'${gFont}'`);
  parts.push('sans-serif');
  return parts.join(', ');
}
</script>

<template>
  <div id="app" :style="{ fontFamily: buildFontFamily(settings.fontFamily), fontSize: settings.fontSize }">
    <nav class="app-nav">
      <router-link to="/" class="app-nav__link">3D Aerial</router-link>
      <router-link to="/multiview" class="app-nav__link">Tourism Observer</router-link>
    </nav>
    <RouterView />
  </div>
</template>

<style>
#app {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  font-family: Calibri, 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
}
.app-nav {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  width: 100%;
  padding: 8px 20px;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(6px);
  display: flex;
  gap: 20px;
  pointer-events: auto;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
}
.app-nav__link {
  color: #e0f0ff;
  text-decoration: none;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}
.app-nav__link:hover { background: rgba(255,255,255,0.1); color: #fff; }
.app-nav__link.router-link-active { color: #53b7ff; background: rgba(83,183,255,0.15); }
</style>
