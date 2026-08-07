/**
 * Survey Cesium overlays — Task1 routes & shot markers on shared viewer.
 * Does NOT use Street View.
 *
 * Strategy:
 * 1) Keep Google Photorealistic tiles (globe hidden) — best for Stanford etc.
 * 2) Only after fly + wait, if tiles still empty, enable satellite globe fallback.
 */
let dataSource = null;
let staticKey = "";
let surveyGlobeOwned = false;
let previousGlobeShow = false;
let imageryReady = null;
let fallbackEnabled = false;

function getViewer() {
  return window.cesiumViewer || window.viewer || null;
}

function ensureSource() {
  const Cesium = window.Cesium;
  const viewer = getViewer();
  if (!Cesium || !viewer) return null;
  if (!dataSource) {
    dataSource = new Cesium.CustomDataSource("survey-mission");
    viewer.dataSources.add(dataSource);
  }
  return dataSource;
}

async function enableGlobeFallback() {
  const Cesium = window.Cesium;
  const viewer = getViewer();
  if (!Cesium || !viewer || fallbackEnabled) return;

  if (!surveyGlobeOwned) {
    previousGlobeShow = viewer.scene.globe.show;
    surveyGlobeOwned = true;
  }
  viewer.scene.globe.show = true;
  // Do NOT enable depthTestAgainstTerrain — it can hide photorealistic tiles.
  viewer.scene.globe.depthTestAgainstTerrain = false;
  fallbackEnabled = true;

  if (!imageryReady) {
    imageryReady = (async () => {
      try {
        const provider = await Cesium.createWorldImageryAsync({
          style: Cesium.IonWorldImageryStyle.AERIAL,
        });
        viewer.imageryLayers.addImageryProvider(provider);
      } catch (err) {
        console.warn("[survey] world imagery unavailable:", err);
      }
      try {
        viewer.terrainProvider = await Cesium.createWorldTerrainAsync();
      } catch (err) {
        console.warn("[survey] world terrain unavailable:", err);
      }
    })();
  }
  await imageryReady;
}

function restoreSurveyGlobe() {
  const viewer = getViewer();
  if (viewer && surveyGlobeOwned) {
    viewer.scene.globe.show = previousGlobeShow;
  }
  surveyGlobeOwned = false;
  fallbackEnabled = false;
}

export function clearSurveyCesium() {
  const viewer = getViewer();
  if (viewer && dataSource) {
    try {
      viewer.dataSources.remove(dataSource, true);
    } catch (_) { /* ignore */ }
  }
  dataSource = null;
  staticKey = "";
  restoreSurveyGlobe();
}

function waitForTiles(timeoutMs = 12000) {
  const tileset = typeof window.getGoogleTileset === "function" ? window.getGoogleTileset() : null;
  return new Promise((resolve) => {
    if (!tileset) {
      setTimeout(() => resolve(false), 800);
      return;
    }
    const start = performance.now();
    function check() {
      if (tileset.tilesLoaded) {
        resolve(true);
        return;
      }
      if (performance.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(check);
    }
    check();
  });
}

function flyToPromise(viewer, options) {
  return new Promise((resolve) => {
    viewer.camera.flyTo({
      ...options,
      complete: () => resolve(),
      cancel: () => resolve(),
    });
  });
}

/**
 * Fly for photorealistic first; enable satellite globe only if tiles don't arrive.
 */
export async function flyOverview(geo, minAlt) {
  const Cesium = window.Cesium;
  const viewer = getViewer();
  if (!Cesium || !viewer || !geo) return false;

  // Prefer Google Photorealistic mode (same as Aerial).
  const tileset = typeof window.getGoogleTileset === "function" ? window.getGoogleTileset() : null;
  if (tileset && !fallbackEnabled) {
    viewer.scene.globe.show = false;
  }

  const overviewH = Math.max((minAlt || 25) + 900, 1000);
  const detailH = Math.max((minAlt || 25) + 280, 320);

  await flyToPromise(viewer, {
    destination: Cesium.Cartesian3.fromDegrees(geo.lng, geo.lat, overviewH),
    orientation: {
      heading: Cesium.Math.toRadians(25),
      pitch: Cesium.Math.toRadians(-50),
      roll: 0,
    },
    duration: 1.5,
  });

  let loaded = await waitForTiles(10000);

  await flyToPromise(viewer, {
    destination: Cesium.Cartesian3.fromDegrees(geo.lng, geo.lat, detailH),
    orientation: {
      heading: Cesium.Math.toRadians(15),
      pitch: Cesium.Math.toRadians(-35),
      roll: 0,
    },
    duration: 1.1,
  });

  loaded = (await waitForTiles(8000)) || loaded;

  // If Photorealistic still not ready, show satellite so the user isn't on empty sky.
  if (!loaded) {
    console.warn("[survey] Photorealistic tiles slow/missing — enabling satellite globe fallback");
    await enableGlobeFallback();
    await flyToPromise(viewer, {
      destination: Cesium.Cartesian3.fromDegrees(geo.lng, geo.lat, overviewH),
      orientation: {
        heading: Cesium.Math.toRadians(25),
        pitch: Cesium.Math.toRadians(-55),
        roll: 0,
      },
      duration: 0.9,
    });
  }

  viewer.scene.requestRender?.();
  return true;
}

export function syncSurveyCesium(planOrMission, opts = {}) {
  const Cesium = window.Cesium;
  const viewer = getViewer();
  const ds = ensureSource();
  if (!Cesium || !viewer || !ds || !planOrMission) return Promise.resolve(false);

  const geo = planOrMission.geo;
  const key = `${planOrMission.plan_id || planOrMission.mission_id}-${(planOrMission.shots || planOrMission.viewpoints || []).length}`;

  const run = async () => {
    // Do not force globe on boot — keep Photorealistic. Fallback only after fly fails.
    if (opts.forceGlobeFallback) {
      await enableGlobeFallback();
    }

    if (key !== staticKey) {
      ds.entities.removeAll();
      staticKey = key;

      const relative = Cesium.HeightReference.NONE;

      if (geo) {
        ds.entities.add({
          id: "survey-target",
          position: Cesium.Cartesian3.fromDegrees(geo.lng, geo.lat, 2),
          ellipse: {
            semiMajorAxis: planOrMission.radius_m || 80,
            semiMinorAxis: planOrMission.radius_m || 80,
            material: Cesium.Color.CYAN.withAlpha(0.22),
            outline: true,
            outlineColor: Cesium.Color.CYAN,
            height: 2,
            extrudedHeight: 6,
          },
          label: {
            text: geo.label?.slice(0, 48) || "TARGET",
            font: "bold 13px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, -16),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      const shots = planOrMission.shots || planOrMission.viewpoints || [];
      for (const sh of shots) {
        const id = sh.shot_id || sh.id;
        ds.entities.add({
          id: `survey-shot-${id}`,
          position: Cesium.Cartesian3.fromDegrees(sh.lng, sh.lat, sh.alt_m || 25),
          point: {
            pixelSize: 13,
            color: Cesium.Color.fromCssColorString("#7ec8ff"),
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            heightReference: relative,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: `${id}${sh.drone_id ? " · " + sh.drone_id : ""}`,
            font: "11px sans-serif",
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }

      const routes = planOrMission.routes || {};
      const colors = ["#78d2b4", "#f0c14a", "#e35d5d", "#a88cff"];
      let ci = 0;
      for (const [did, path] of Object.entries(routes)) {
        if (!path || path.length < 2) continue;
        const positions = path.map((p) =>
          Cesium.Cartesian3.fromDegrees(p.lng, p.lat, (p.alt_m || 20)),
        );
        ds.entities.add({
          id: `survey-route-${did}`,
          polyline: {
            positions,
            width: 3.5,
            material: new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.2,
              color: Cesium.Color.fromCssColorString(colors[ci % colors.length]),
            }),
          },
        });
        ci += 1;
      }
    }

    if (opts.flyTo !== false && geo) {
      await flyOverview(geo, planOrMission.min_alt_m);
    }

    const cur = opts.currentPose;
    if (cur) {
      let ent = ds.entities.getById("survey-drone-live");
      const pos = Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, cur.alt_m || 20);
      if (!ent) {
        ds.entities.add({
          id: "survey-drone-live",
          position: pos,
          point: {
            pixelSize: 18,
            color: Cesium.Color.LIME,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: {
            text: cur.shot_id ? `UAV · ${cur.shot_id}` : "UAV",
            font: "bold 11px sans-serif",
            fillColor: Cesium.Color.LIME,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -22),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        ent.position = pos;
        if (ent.label) ent.label.text = cur.shot_id ? `UAV · ${cur.shot_id}` : "UAV";
      }

      if (opts.follow) {
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(cur.lng, cur.lat, (cur.alt_m || 20) + 90),
          orientation: {
            heading: Cesium.Math.toRadians((cur.yaw_deg || 0) + 180),
            pitch: Cesium.Math.toRadians(-30),
            roll: 0,
          },
          duration: 0.35,
        });
      }

      if (cur.phase === "hover_photo" || cur.flash) {
        let ring = ds.entities.getById("survey-flash");
        if (!ring) {
          ds.entities.add({
            id: "survey-flash",
            position: pos,
            ellipse: {
              semiMajorAxis: 18,
              semiMinorAxis: 18,
              material: Cesium.Color.WHITE.withAlpha(0.35),
              height: (cur.alt_m || 20) - 2,
            },
          });
        } else {
          ring.position = pos;
        }
        setTimeout(() => {
          const r = ds.entities.getById("survey-flash");
          if (r) ds.entities.remove(r);
        }, 450);
      }
    }

    for (const sh of planOrMission.shots || []) {
      const ent = ds.entities.getById(`survey-shot-${sh.shot_id}`);
      if (!ent || !ent.point) continue;
      const st = sh.status || "pending";
      const color =
        st === "done" ? "#6dffa8" :
        st === "failed" ? "#ff6a4a" :
        st === "capturing" || st === "hovering" || st === "flying" ? "#ffe08a" :
        "#7ec8ff";
      ent.point.color = Cesium.Color.fromCssColorString(color);
    }
    return true;
  };

  return run();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function simulateTask1Flight(plan, onTick, onDone) {
  const home = plan.home;
  const shots = plan.shots || plan.viewpoints || [];
  const nodes = [{ ...home, kind: "home" }];
  for (const sh of shots) {
    nodes.push({
      lat: sh.lat, lng: sh.lng, alt_m: sh.alt_m,
      kind: "shot", shot_id: sh.shot_id || sh.id, yaw_deg: sh.yaw_deg,
    });
  }
  nodes.push({ ...home, kind: "home" });

  const frames = [];
  for (let i = 0; i < nodes.length; i += 1) {
    const cur = nodes[i];
    if (i > 0) {
      const prev = nodes[i - 1];
      for (let s = 1; s <= 4; s += 1) {
        const t = s / 4;
        frames.push({
          lat: lerp(prev.lat, cur.lat, t),
          lng: lerp(prev.lng, cur.lng, t),
          alt_m: lerp(prev.alt_m || 20, cur.alt_m || 20, t),
          kind: "transit",
          phase: "transit",
          message: i === nodes.length - 1 ? "模拟返航" : "模拟转场",
        });
      }
    }
    if (cur.kind === "shot") {
      frames.push({
        ...cur,
        phase: "hover_photo",
        flash: true,
        message: `模拟悬停并拍摄 ${cur.shot_id}`,
      });
    } else if (i === 0) {
      frames.push({ ...cur, phase: "takeoff", message: "模拟起飞" });
    }
  }

  let i = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    if (i >= frames.length) {
      onDone?.();
      return;
    }
    const p = frames[i];
    onTick?.({ ...p, index: i, total: frames.length });
    i += 1;
    setTimeout(step, p.phase === "hover_photo" ? 850 : 280);
  };
  step();
  return () => { cancelled = true; };
}
