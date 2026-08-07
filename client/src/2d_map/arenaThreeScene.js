/**
 * True-3D Mission Arena (Three.js) — visible map + FPV observer camera.
 * Independent of Cesium / Map2D / Node-8.
 */
import * as THREE from 'three';

const COLORS = {
  blue: 0x4db6ff,
  red: 0xff6b5a,
  vip: 0xd4c56a,
  observer: 0xb8f0d0,
  ground: 0x2d4a40,
  ground2: 0x243d36,
  building: 0x5a7368,
  keep: 0xff5555,
  jam: 0xffaa44,
  path: 0x7dffc0,
};

function makeQuadcopter(color, scale = 1) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.4 * scale, 0.4 * scale, 1.4 * scale), bodyMat);
  body.position.y = 0.25 * scale;
  body.castShadow = true;
  g.add(body);
  const armMat = new THREE.MeshStandardMaterial({ color: 0x111814, metalness: 0.5, roughness: 0.4 });
  const armGeo = new THREE.BoxGeometry(3.6 * scale, 0.14 * scale, 0.2 * scale);
  const a1 = new THREE.Mesh(armGeo, armMat);
  const a2 = new THREE.Mesh(armGeo, armMat);
  a2.rotation.y = Math.PI / 2;
  a1.position.y = a2.position.y = 0.28 * scale;
  g.add(a1, a2);
  const rotorGeo = new THREE.CylinderGeometry(0.65 * scale, 0.65 * scale, 0.07 * scale, 20);
  const rotorMat = new THREE.MeshStandardMaterial({
    color, transparent: true, opacity: 0.5, metalness: 0.2, roughness: 0.35,
  });
  for (const [x, z] of [[-1.55, 1.55], [1.55, 1.55], [-1.55, -1.55], [1.55, -1.55]]) {
    const r = new THREE.Mesh(rotorGeo, rotorMat);
    r.position.set(x * scale, 0.42 * scale, z * scale);
    r.userData.spin = true;
    g.add(r);
  }
  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(0.28 * scale, 0.7 * scale, 10),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 0.3 * scale, -1.05 * scale);
  g.add(nose);
  return g;
}

function makeCheckerTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = 32;
  for (let y = 0; y < size / cell; y++) {
    for (let x = 0; x < size / cell; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#2f5248' : '#26443c';
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }
  // faint road lines
  ctx.strokeStyle = 'rgba(180,220,200,0.25)';
  ctx.lineWidth = 2;
  for (let i = 0; i < size; i += cell * 4) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(14, 10);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createArenaThreeScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87a8b8); // daylight sky so “empty” is never pure black
  scene.fog = new THREE.Fog(0x9bb8c4, 180, 520);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.4, 900);
  camera.position.set(0, 60, 90);

  scene.add(new THREE.HemisphereLight(0xe8f4ff, 0x3a4a40, 1.1));
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.25);
  sun.position.set(60, 140, 40);
  sun.castShadow = true;
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  let mapW = 220;
  let mapH = 160;
  const world = new THREE.Group();
  scene.add(world);

  const groundMat = new THREE.MeshStandardMaterial({
    map: makeCheckerTexture(),
    roughness: 0.9,
    metalness: 0.05,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  const grid = new THREE.GridHelper(1, 22, 0x6a9a88, 0x3a5a50);
  grid.position.y = 0.08;
  world.add(grid);

  // Sky dome hint
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x7e9eb0, side: THREE.BackSide }),
  );
  scene.add(sky);

  const buildings = new THREE.Group();
  world.add(buildings);
  const zones = new THREE.Group();
  world.add(zones);
  const pathLine = new THREE.Group();
  world.add(pathLine);
  const drones = new Map();
  const trails = new Map();

  // FPV look state (client-side)
  let followObserver = true;
  let lookPitch = -0.35; // rad, negative = look down
  let fov = 70;
  let builtStatic = false;
  let raf = 0;
  let lastState = null;

  const DEFAULT_WALLS = [
    { x: 28, y: 12, w: 22, h: 40, height: 22 },
    { x: 28, y: 108, w: 22, h: 40, height: 20 },
    { x: 70, y: 8, w: 26, h: 48, height: 26 },
    { x: 70, y: 104, w: 26, h: 48, height: 24 },
    { x: 115, y: 25, w: 20, h: 35, height: 18 },
    { x: 115, y: 100, w: 20, h: 35, height: 18 },
    { x: 155, y: 10, w: 24, h: 42, height: 28 },
    { x: 155, y: 108, w: 24, h: 42, height: 28 },
    { x: 95, y: 70, w: 14, h: 20, height: 14 },
  ];
  const DEFAULT_WPS = [
    [20, 80], [50, 80], [60, 55], [85, 45], [110, 55],
    [130, 80], [145, 100], [165, 90], [190, 80],
  ];

  function localToWorld(x, y, alt = 0) {
    return new THREE.Vector3(x - mapW / 2, alt, y - mapH / 2);
  }

  function clearGroup(g) {
    while (g.children.length) {
      const c = g.children.pop();
      c.geometry?.dispose?.();
      if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
      else c.material?.dispose?.();
    }
  }

  function rebuildStatic(state) {
    mapW = state?.map?.w || 220;
    mapH = state?.map?.h || 160;
    ground.scale.set(mapW, mapH, 1);
    grid.scale.set(mapW, 1, mapH);

    clearGroup(buildings);
    clearGroup(zones);
    clearGroup(pathLine);

    const walls = state?.walls?.length ? state.walls : DEFAULT_WALLS;
    for (const w of walls) {
      const h = w.height || 18;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(w.w, h, w.h),
        new THREE.MeshStandardMaterial({ color: COLORS.building, roughness: 0.8, metalness: 0.12 }),
      );
      mesh.position.copy(localToWorld(w.x + w.w / 2, w.y + w.h / 2, h / 2));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      buildings.add(mesh);
    }

    const kz = state?.keep_zone || { x: 185, y: 80, r: 11 };
    const jz = state?.jam_zone || { x: 185, y: 80, r: 22 };

    const keepRing = new THREE.Mesh(
      new THREE.RingGeometry(kz.r * 0.9, kz.r, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.keep, transparent: true, opacity: 0.45, side: THREE.DoubleSide }),
    );
    keepRing.rotation.x = -Math.PI / 2;
    keepRing.position.copy(localToWorld(kz.x, kz.y, 0.25));
    zones.add(keepRing);

    const jamRing = new THREE.Mesh(
      new THREE.RingGeometry(jz.r * 0.92, jz.r, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.jam, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    jamRing.rotation.x = -Math.PI / 2;
    jamRing.position.copy(localToWorld(jz.x, jz.y, 0.2));
    zones.add(jamRing);

    const wps = (state?.waypoints?.length ? state.waypoints.map((p) => [p.x, p.y]) : DEFAULT_WPS);
    const pts = wps.map(([x, y]) => localToWorld(x, y, 2));
    if (pts.length > 1) {
      const curve = new THREE.CatmullRomCurve3(pts);
      pathLine.add(new THREE.Mesh(
        new THREE.TubeGeometry(curve, 80, 0.55, 8, false),
        new THREE.MeshStandardMaterial({ color: COLORS.path, emissive: COLORS.path, emissiveIntensity: 0.35 }),
      ));
      pts.forEach((p) => {
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(1.3, 12, 12),
          new THREE.MeshStandardMaterial({ color: 0xe8ffe8, emissive: 0x44aa66, emissiveIntensity: 0.3 }),
        );
        m.position.copy(p);
        pathLine.add(m);
      });
    }

    builtStatic = true;
  }

  // Show map immediately (before websocket)
  rebuildStatic(null);
  // Place a preview camera overlooking the field
  camera.position.set(0, 75, 110);
  camera.lookAt(0, 0, 0);

  function ensureDrone(uid, unit) {
    if (drones.has(uid)) return drones.get(uid);
    let color = COLORS.blue;
    let scale = 1.4;
    if (unit.faction === 'red') { color = COLORS.red; scale = 1.35; }
    if (unit.faction === 'vip') { color = COLORS.vip; scale = 1.55; }
    if (unit.faction === 'observer') { color = COLORS.observer; scale = 1.8; }
    const mesh = makeQuadcopter(color, scale);
    world.add(mesh);
    drones.set(uid, mesh);
    return mesh;
  }

  function syncTrails(state) {
    const all = state.trails || {};
    for (const [uid, pts] of Object.entries(all)) {
      if (!pts?.length) continue;
      const positions = [];
      for (const p of pts) {
        const v = localToWorld(p.x, p.y, p.alt || 10);
        positions.push(v.x, v.y, v.z);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const faction = state.units?.[uid]?.faction;
      const col = faction === 'red' ? COLORS.red : faction === 'vip' ? COLORS.vip : COLORS.blue;
      let line = trails.get(uid);
      if (!line) {
        line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.75 }));
        world.add(line);
        trails.set(uid, line);
      } else {
        line.geometry.dispose();
        line.geometry = geo;
      }
    }
  }

  function applyFpvCamera(obs) {
    const eye = localToWorld(obs.x, obs.y, obs.alt);
    const yaw = obs.yaw || 0;
    // Look direction from yaw + pitch
    const cp = Math.cos(lookPitch);
    const sp = Math.sin(lookPitch);
    const dir = new THREE.Vector3(
      Math.cos(yaw) * cp,
      sp,
      Math.sin(yaw) * cp,
    );
    const target = eye.clone().add(dir.multiplyScalar(40));
    camera.position.copy(eye);
    camera.lookAt(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  function sync(state) {
    if (!state) return;
    lastState = state;
    if (!builtStatic || (state.map && (state.map.w !== mapW || state.map.h !== mapH))) {
      rebuildStatic(state);
    }

    for (const [uid, unit] of Object.entries(state.units || {})) {
      const mesh = ensureDrone(uid, unit);
      mesh.position.copy(localToWorld(unit.x, unit.y, unit.alt));
      mesh.rotation.y = -(unit.yaw || 0) + Math.PI;
      // Hide own airframe in true FPV
      mesh.visible = !(followObserver && uid === 'observer');
      mesh.traverse((ch) => {
        if (ch.userData?.spin) ch.rotation.y += 0.85;
      });
    }
    syncTrails(state);

    if (followObserver && state.units?.observer) {
      applyFpvCamera(state.units.observer);
    } else if (state.units?.observer) {
      // chase cam behind observer
      const obs = state.units.observer;
      const eye = localToWorld(obs.x, obs.y, obs.alt);
      const yaw = obs.yaw || 0;
      const back = new THREE.Vector3(-Math.cos(yaw) * 18, 8, -Math.sin(yaw) * 18);
      camera.position.copy(eye).add(back);
      camera.lookAt(eye);
    }
  }

  function setFollowObserver(v) { followObserver = !!v; }
  function setLookPitch(p) {
    lookPitch = Math.max(-1.2, Math.min(0.6, p));
  }
  function addLookPitch(dp) { setLookPitch(lookPitch + dp); }
  function setFov(v) {
    fov = Math.max(40, Math.min(100, v));
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  function getLookState() {
    return { pitch: lookPitch, fov };
  }

  function resize() {
    const w = Math.max(1, container.clientWidth || container.offsetWidth || 1);
    const h = Math.max(1, container.clientHeight || container.offsetHeight || 1);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
  }

  function frame() {
    raf = requestAnimationFrame(frame);
    if (lastState?.units?.observer && followObserver) {
      applyFpvCamera(lastState.units.observer);
      for (const mesh of drones.values()) {
        mesh.traverse((ch) => {
          if (ch.userData?.spin) ch.rotation.y += 0.55;
        });
      }
    } else if (!lastState) {
      const t = performance.now() * 0.00015;
      camera.position.set(Math.cos(t) * 120, 70, Math.sin(t) * 120);
      camera.lookAt(0, 0, 0);
    }
    renderer.render(scene, camera);
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  // Multiple resize passes — ViewComposer may layout late
  resize();
  requestAnimationFrame(resize);
  setTimeout(resize, 50);
  setTimeout(resize, 250);
  setTimeout(resize, 800);
  frame();

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const dragHandlers = { onYawDelta: null, onPitchDelta: null, onZoom: null };

  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    renderer.domElement.setPointerCapture(e.pointerId);
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    dragHandlers.onYawDelta?.(dx * 0.006);
    // Vertical drag = look pitch (immediate, client-side)
    addLookPitch(-dy * 0.004);
    dragHandlers.onPitchDelta?.(-dy * 0.004);
  });
  const endDrag = () => { dragging = false; };
  renderer.domElement.addEventListener('pointerup', endDrag);
  renderer.domElement.addEventListener('pointercancel', endDrag);

  renderer.domElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    dragHandlers.onZoom?.(e.deltaY);
  }, { passive: false });

  function destroy() {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    if (renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
    drones.clear();
    trails.clear();
  }

  function resetStatic() { builtStatic = false; }

  return {
    sync,
    setFollowObserver,
    setLookPitch,
    addLookPitch,
    setFov,
    getLookState,
    destroy,
    resize,
    resetStatic,
    dragHandlers,
    get camera() { return camera; },
  };
}
