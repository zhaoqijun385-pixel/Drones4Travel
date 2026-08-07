import { createRouter, createWebHistory } from 'vue-router';
import AerialView from '@/views/AerialView.vue';
import RealDroneView from '@/views/RealDroneView.vue';
import MeshView from '@/views/MeshView.vue';
import Map2DView from '@/views/Map2DView.vue';
import Satellite2DView from '@/views/Satellite2DView.vue';
import ChatView from '@/views/ChatView.vue';
import SettingsView from '@/views/SettingsView.vue';
import MySpaceView from '@/views/MySpaceView.vue';
import ExtensionsView from '@/views/ExtensionsView.vue';
import ReportsView from '@/views/ReportsView.vue';
import { useAuth } from '@shared-composables/useAuth.js';
import MissionArenaView from '@/views/MissionArenaView.vue';
import SurveyMissionView from '@/views/SurveyMissionView.vue';
import MultiViewDashboard from '@/views/MultiViewDashboard.vue';

const routes = [
  {
  path: '/multiview',
  name: 'MultiView',
  component: () => import('@/views/MultiViewDashboard.vue'),
  },
  {
    path: '/',
    name: 'Aerial',
    component: AerialView,
  },
  {
    path: '/real-drone',
    name: 'RealDrone',
    component: RealDroneView,
  },
  {
    path: '/mesh',
    name: 'Mesh3D',
    component: MeshView,
  },
  {
    path: '/map',
    name: 'Map2D',
    component: Map2DView,
  },
  {
    path: '/satellite',
    name: 'Satellite2D',
    component: Satellite2DView,
  },
  {
    path: '/chat',
    name: 'Chat',
    component: ChatView,
    meta: { requiresAuth: true },
  },
  {
    path: '/customer-service',
    name: 'CustomerService',
    component: () => import('@/views/CustomerServiceView.vue'),
    meta: { requiresAuth: true },
  },
  {
    path: '/settings',
    name: 'Settings',
    component: SettingsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/myspace',
    name: 'MySpace',
    component: MySpaceView,
  },
  {
    // Auth flow action pages (email links + Google OAuth landing)
    path: '/verify-email',
    name: 'VerifyEmail',
    component: () => import('@/views/VerifyEmailView.vue'),
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/views/ResetPasswordView.vue'),
  },
  {
    path: '/auth/callback',
    name: 'AuthCallback',
    component: () => import('@/views/AuthCallbackView.vue'),
  },
  {
    path: '/extensions',
    name: 'Extensions',
    component: ExtensionsView,
  },
  {
    path: '/reports',
    name: 'Reports',
    component: ReportsView,
    meta: { requiresAuth: true },
  },
  {
    path: '/mission-arena',
    name: 'MissionArena',
    component: MissionArenaView,
  },
  {
    path: '/survey-mission',
    name: 'SurveyMission',
    component: SurveyMissionView,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach(async (to) => {
  if (!to.meta.requiresAuth) return true;
  const { token, user, fetchMe } = useAuth();
  if (!token.value) {
    return { path: '/myspace', query: { sub: 'account', redirect: to.fullPath } };
  }
  if (!user.value) {
    try {
      const me = await fetchMe();
      if (!me) return { path: '/myspace', query: { sub: 'account', redirect: to.fullPath } };
    } catch {
      // Preserve the route during a temporary API outage; the page can show
      // its own retry state while the token remains available locally.
    }
  }
  return true;
});

export default router;
