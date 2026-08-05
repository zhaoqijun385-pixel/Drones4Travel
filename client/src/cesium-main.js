import config from '../config.json';
import { useAppSettings } from '@shared-composables/useAppSettings.js';
import { applyNeutralSphericalHarmonics, pinSceneSphericalHarmonics } from '@shared-composables/useTilesetSource.js';

// ── Spherical-harmonics uniform shim (the reliable uniform3fv fix) ──
// Root cause (confirmed in Cesium 1.125 source): ImageBasedLightingPipelineStage
// captures `imageBasedLighting.sphericalHarmonicCoefficients ??
// environmentMapManager.sphericalHarmonicCoefficients` as a LIVE reference into
// each Model's shader uniform closure, once at shader-build time. The
// DynamicEnvironmentMapManager then recomputes those coefficients ON THE GPU and
// its array is EMPTIED IN PLACE when the irradiance readback never completes —
// which is exactly what happens on this machine's integrated GPU. Every frame the
// built shader feeds that now-empty vec3[9] to uniform3fv →
// "WebGL: INVALID_VALUE: uniform3fv: no array" (main AND pick passes), once per
// drawn model. Object-level fixes (setting tileset IBL / pinning the manager
// getter) cannot reach shader closures that were already built, so the reliable
// fix is at the GL boundary: when an empty vec3 array is about to be uploaded to
// a program that declares a sphericalHarmonicCoefficients uniform, substitute a
// neutral 9-coefficient set (flat ambient) — visually equivalent to the explicit
// coefficients we intended, and it makes the call valid. Patched on the WebGL
// prototypes so it covers every current and future GL context in the page.
(function installSphericalHarmonicsShim() {
    // Neutral 3rd-order SH (L0,0 … L2,2) as 9 vec3 = 27 floats: base ambient
    // irradiance with a slightly brighter sky overhead. Matches getNeutralSphericalHarmonics().
    const NEUTRAL = new Float32Array([
        0.5, 0.5, 0.5,  0.0, 0.0, 0.0,  0.2, 0.2, 0.2,
        0.0, 0.0, 0.0,  0.0, 0.0, 0.0,  0.0, 0.0, 0.0,
        0.0, 0.0, 0.0,  0.0, 0.0, 0.0,  0.0, 0.0, 0.0,
    ]);
    const patch = (proto) => {
        if (!proto || !proto.uniform3fv) return;
        const orig = proto.uniform3fv;
        const progHasSH = new WeakMap(); // WebGLProgram → declares a sphericalHarmonicCoefficients vec3 uniform
        proto.uniform3fv = function (location, value) {
            // Fast path: non-empty uploads pass straight through. Only an empty
            // vec3 array (always a GL error for uniform3fv) is intercepted.
            if (value && value.length === 0) {
                try {
                    const gl = this;
                    const prog = gl.getParameter(gl.CURRENT_PROGRAM);
                    let has = prog ? progHasSH.get(prog) : false;
                    if (has === undefined) {
                        has = false;
                        const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
                        for (let i = 0; i < n; i++) {
                            const info = gl.getActiveUniform(prog, i);
                            if (info.type === gl.FLOAT_VEC3 && info.name.indexOf('sphericalHarmonicCoefficients') !== -1) {
                                has = true;
                                break;
                            }
                        }
                        progHasSH.set(prog, has);
                    }
                    if (has) value = NEUTRAL;
                } catch (e) { /* never break rendering */ }
            }
            return orig.call(this, location, value);
        };
    };
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
})();

Cesium.GoogleMaps.defaultApiKey = config.googleApiKey;
Cesium.Ion.defaultAccessToken = config.cesiumIonToken;

// Initialize with standard terrain mapping configuration profiles
let googleTileset = null;
const viewer = new Cesium.Viewer('cesiumContainer', {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    infoBox: false,
    selectionIndicator: false,
    // Hide default Cesium toolbar widgets
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    // Provide baseline imagery mapping vectors to map standard ground heights
    imageryProvider: new Cesium.TileMapServiceImageryProvider({
        url: Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
    })
});

// ── Optional multi-drone flight-deck layer ────────────────────────────────
// Uses a small, cached Entity set instead of creating a model per telemetry
// packet. Cesium handles the normal view-frustum traversal; this layer adds a
// conservative distance cutoff and hides labels earlier than points so the
// mobile path stays cheap. It is only updated when the Vue flight deck opts in
// with ?fleet=demo, so the original single-drone scene is unchanged by default.
const fleetEntities = new Map();
const fleetRouteEntities = new Map();
const fleetColors = new Map();
let fleetStats = { objects: 0, visible: 0 };

function fleetColor(value, fallback = '#53b7ff') {
    const key = String(value || fallback);
    if (!fleetColors.has(key)) fleetColors.set(key, Cesium.Color.fromCssColorString(key));
    return fleetColors.get(key);
}

function createFleetEntity(state) {
    const color = fleetColor(state.color);
    const entity = viewer.entities.add({
        id: `fleet:${state.droneId}`,
        position: Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt),
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
            Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt),
            new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(Number(state.heading ?? state.yaw ?? 0)), 0, 0),
        ),
        model: {
            uri: '/models/fleet-drone.gltf',
            scale: 0.72,
            minimumPixelSize: 22,
            maximumScale: 2.8,
            color,
            colorBlendMode: Cesium.ColorBlendMode.MIX,
            colorBlendAmount: 0.28,
            silhouetteColor: Cesium.Color.WHITE,
            silhouetteSize: 0,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 360),
        },
        point: {
            pixelSize: state.local ? 12 : 9,
            color,
            outlineColor: Cesium.Color.WHITE.withAlpha(0.88),
            outlineWidth: state.local ? 3 : 1,
            disableDepthTestDistance: 500,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(320, 500),
        },
        label: {
            text: state.name || state.droneId,
            font: '600 12px Calibri, sans-serif',
            fillColor: color,
            outlineColor: Cesium.Color.BLACK.withAlpha(0.86),
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -18),
            disableDepthTestDistance: 500,
            show: false,
        },
    });
    entity._fleetPosition = new Cesium.Cartesian3();
    entity._fleetLastColor = state.color;
    entity._fleetLastName = state.name;
    fleetEntities.set(state.droneId, entity);
    return entity;
}

function syncFleetRoute(state, color, inRange) {
    const route = Array.isArray(state.route) ? state.route : [];
    let entity = fleetRouteEntities.get(state.droneId);
    if (route.length < 2) {
        if (entity) {
            viewer.entities.remove(entity);
            fleetRouteEntities.delete(state.droneId);
        }
        return;
    }
    const positions = route
        .filter((point) => Number.isFinite(Number(point.lon)) && Number.isFinite(Number(point.lat)))
        .map((point) => Cesium.Cartesian3.fromDegrees(
            Number(point.lon),
            Number(point.lat),
            Math.max(0, Number(point.alt) || 0),
        ));
    if (positions.length < 2) return;
    if (!entity) {
        entity = viewer.entities.add({
            id: `fleet-route:${state.droneId}`,
            polyline: {
                positions,
                width: 2,
                material: color.withAlpha(0.72),
                clampToGround: false,
            },
        });
        fleetRouteEntities.set(state.droneId, entity);
    } else {
        entity.polyline.positions = positions;
        entity.polyline.material = color.withAlpha(0.72);
    }
    entity.show = inRange && state.phase !== 'parked';
}

window.updateDroneFleet = function updateDroneFleet(states = [], options = {}) {
    const list = Array.isArray(states) ? states : [];
    const local = list.find((state) => state.droneId === options.localDroneId) || list.find((state) => state.local);
    const localPosition = local
        ? Cesium.Cartesian3.fromDegrees(local.lon, local.lat, local.alt)
        : null;
    const liveIds = new Set();
    let visible = 0;
    const renderDistance = Number(options.renderDistance || 500);
    const labelDistance = Number(options.labelDistance || 220);

    list.forEach((state) => {
        if (!state || !state.droneId || !Number.isFinite(Number(state.lat)) || !Number.isFinite(Number(state.lon))) return;
        liveIds.add(state.droneId);
        const entity = fleetEntities.get(state.droneId) || createFleetEntity(state);
        const position = Cesium.Cartesian3.fromDegrees(
            Number(state.lon),
            Number(state.lat),
            Math.max(0, Number(state.alt) || 0),
            Cesium.Ellipsoid.WGS84,
            entity._fleetPosition,
        );
        const distance = localPosition ? Cesium.Cartesian3.distance(localPosition, position) : 0;
        const inRange = Boolean(state.online !== false) && distance <= renderDistance;
        const color = fleetColor(state.color);
        entity.position.setValue(position);
        entity.orientation = Cesium.Transforms.headingPitchRollQuaternion(
            position,
            new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(Number(state.heading ?? state.yaw ?? 0)), 0, 0),
        );
        const firstPerson = state.droneId === options.firstPersonDroneId;
        entity.show = inRange && !firstPerson;
        entity.model.show = inRange && !firstPerson;
        entity.point.show = inRange;
        entity.label.show = inRange && distance <= labelDistance;
        if (state.name !== entity._fleetLastName) {
            entity.label.text = state.name || state.droneId;
            entity._fleetLastName = state.name;
        }
        if (state.color !== entity._fleetLastColor) {
            entity.point.color = color;
            entity.label.fillColor = color;
            entity.model.color = color;
            entity._fleetLastColor = state.color;
        }
        if (state.droneId === options.selectedDroneId) {
            entity.point.pixelSize = state.local ? 18 : 14;
            entity.point.outlineWidth = 3;
            entity.model.silhouetteSize = 2;
        } else {
            entity.point.pixelSize = state.local ? 14 : 10;
            entity.point.outlineWidth = state.local ? 3 : 1;
            entity.model.silhouetteSize = 0;
        }
        syncFleetRoute(state, color, inRange);
        if (inRange) visible += 1;
    });

    fleetEntities.forEach((entity, droneId) => {
        if (!liveIds.has(droneId)) {
            viewer.entities.remove(entity);
            fleetEntities.delete(droneId);
            const route = fleetRouteEntities.get(droneId);
            if (route) viewer.entities.remove(route);
            fleetRouteEntities.delete(droneId);
        }
    });
    fleetStats = { objects: list.length, visible };
};

window.clearDroneFleet = function clearDroneFleet() {
    fleetEntities.forEach((entity) => viewer.entities.remove(entity));
    fleetRouteEntities.forEach((entity) => viewer.entities.remove(entity));
    fleetEntities.clear();
    fleetRouteEntities.clear();
    fleetStats = { objects: 0, visible: 0 };
};

window.getDroneFleetStats = function getDroneFleetStats() {
    return { ...fleetStats };
};

// Explicitly hide the underlying base globe surface to expose clean Google Meshes.
// If the photorealistic tileset fails to load, we re-enable the globe as a fallback.
viewer.scene.globe.show = false;

// Disable atmospheric fog globally (both aerial and mesh sources). At the
// altitudes this drone operates at, fog density is negligible, and fog is
// purely cosmetic — turning it off yields a clearer view for navigation.
viewer.scene.fog.enabled = false;

// Pin the SCENE-level spherical-harmonic feed as well. The tileset pins only
// cover Model shaders; the globe surface shader (visible only in 3D Mesh mode,
// where globe.show = true) reads the vec3[9] automatic uniform
// czm_sphericalHarmonicCoefficients via uniformState ← frameState, and Cesium's
// scene-level coefficients can likewise come back EMPTY from the GPU on this
// machine's integrated GPU — the same "uniform3fv: no array" for every globe
// draw (main AND pick passes). See useTilesetSource.js for details.
pinSceneSphericalHarmonics(viewer.scene);

// NOTE: the "uniform3fv: no array" fix lives in useTilesetSource.js
// (applyNeutralSphericalHarmonics) and must be applied to EVERY 3D tileset's
// OWN imageBasedLighting — the Google tileset below AND the OSM tileset in
// useTilesetSource.js. Cesium's Scene has NO `imageBasedLighting` property, so
// it must NOT be assigned here — doing so throws a TypeError that halts this
// module before `window.cesiumViewer` is set, which is exactly what produced the
// splash's misleading "cannot connect to Cesium" error.

// ── WebGL context-loss detection ──
// If the GPU kills the WebGL context (memory pressure, driver reset), the
// canvas keeps showing its last frame while the rest of the app (physics,
// HUD, street view) keeps running — the 3D scene looks "frozen" even though
// nothing in the JS logic is broken. Surface it loudly instead of failing
// silently, and reload once the browser restores the context.
function showContextLostBanner() {
    if (document.getElementById('webgl-context-lost-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'webgl-context-lost-banner';
    banner.style.cssText =
        'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:100000;' +
        'background:rgba(185,28,28,0.95);color:#fff;padding:12px 18px;border-radius:10px;' +
        'font:14px/1.5 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,0.45);' +
        'display:flex;gap:14px;align-items:center;';
    const text = document.createElement('span');
    text.textContent = 'The 3D graphics context was lost (GPU overloaded), so the scene is frozen.';
    const button = document.createElement('button');
    button.textContent = 'Reload';
    button.style.cssText =
        'background:#fff;color:#b91c1c;border:none;border-radius:6px;' +
        'padding:6px 14px;font-weight:600;cursor:pointer;';
    button.onclick = () => location.reload();
    banner.appendChild(text);
    banner.appendChild(button);
    document.body.appendChild(banner);
}

viewer.canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault(); // allow the browser to attempt restoration
    console.error('[Cesium] WebGL context lost — the 3D canvas is frozen.');
    showContextLostBanner();
});
viewer.canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[Cesium] WebGL context restored — reloading for a clean state.');
    location.reload();
});

// Cesium swallows render errors when rethrowRenderErrors is false (default),
// which can also leave the canvas showing a stale frame. Log them so a
// dying render pipeline is visible in the console.
viewer.scene.renderError.addEventListener((scene, error) => {
    console.error('[Cesium] Render error:', error);
});

/**
 * Resolve once the tileset reports tilesLoaded (all tiles needed for the
 * current view are loaded and drawn), or after a safety timeout.
 * Without a tileset (fallback path), proceed after a short fixed delay.
 */
function waitForTilesRendered(tileset, timeoutMs = 8000) {
    return new Promise((resolve) => {
        if (!tileset) {
            setTimeout(resolve, 3000);
            return;
        }
        const start = performance.now();
        function check() {
            if (tileset.tilesLoaded) {
                console.log('[Cesium] Initial view fully rendered (tilesLoaded).');
                resolve();
                return;
            }
            if (performance.now() - start > timeoutMs) {
                console.warn(`[Cesium] Tile render wait timeout (${timeoutMs / 1000}s), proceeding.`);
                resolve();
                return;
            }
            requestAnimationFrame(check);
        }
        // Give the traversal a moment to start loading before the first check.
        setTimeout(() => requestAnimationFrame(check), 1000);
    });
}

async function loadArena() {
    const { settings } = useAppSettings();
    const targetLatitude = settings.defaultLat;
    const targetLongitude = settings.defaultLon;
    const targetHeight = settings.defaultAlt;
    const initialPosition = Cesium.Cartesian3.fromDegrees(targetLongitude, targetLatitude, targetHeight);

    // Apply default direction from settings (yaw → heading, pitch, roll)
    const initialHeading = Cesium.Math.toRadians(settings.defaultYaw);
    const initialPitch = Cesium.Math.toRadians(settings.defaultPitch);
    const initialRoll = Cesium.Math.toRadians(settings.defaultRoll);

    // Position the camera at the default location and direction immediately
    // so that tiles for the correct viewport begin downloading.
    viewer.camera.setView({
        destination: initialPosition,
        orientation: {
            heading: initialHeading,
            pitch: initialPitch,
            roll: initialRoll
        }
    });

    try {
        // Attempt to load Google Photorealistic 3D Tiles.
        // This requires a valid Google API key with the Map Tiles API enabled and
        // a Cesium ion access token that is not expired.
        // onlyUsingWithGoogleGeocoder: the app disables the geocoder widget
        // entirely (geocoder: false in the Viewer options), so Cesium's
        // "only the Google geocoder can be used" compatibility warning does not
        // apply — acknowledge it explicitly to keep the console clean.
        googleTileset = await Cesium.createGooglePhotorealistic3DTileset({
            onlyUsingWithGoogleGeocoder: true,
        });
        // Prioritize a usable coarse scene. Fine photogrammetry keeps refining
        // after the controls are visible instead of blocking the splash.
        googleTileset.maximumScreenSpaceError = 24;
        googleTileset.dynamicScreenSpaceError = true;
        googleTileset.dynamicScreenSpaceErrorFactor = 4;
        googleTileset.cullRequestsWhileMoving = true;
        googleTileset.cullRequestsWhileMovingMultiplier = 60;
        // Explicit IBL spherical harmonics BEFORE the tileset enters the scene, so
        // every Google-tile model pipeline captures them when its shader is built —
        // otherwise scene.pickFromRay renders them with an empty vec3[9] uniform and
        // Chrome logs "WebGL: INVALID_VALUE: uniform3fv: no array" every frame.
        applyNeutralSphericalHarmonics(googleTileset);
        viewer.scene.primitives.add(googleTileset);
        console.log('[Cesium] Google Photorealistic 3D Tileset created.');
    } catch (error) {
        console.warn('[Cesium] Google Photorealistic 3D Tileset failed to load:', error);
        console.warn('[Cesium] Falling back to Cesium World Terrain + OSM Buildings.');

        // Re-enable the base globe so the map is not blank.
        viewer.scene.globe.show = true;

        // Add Cesium World Terrain for elevation data.
        try {
            const terrain = await Cesium.createWorldTerrainAsync();
            viewer.terrainProvider = terrain;
            console.log('[Cesium] Cesium World Terrain loaded.');
        } catch (terrainError) {
            console.warn('[Cesium] Cesium World Terrain failed to load:', terrainError);
        }

        // Add OSM Buildings as a fallback 3D dataset.
        try {
            const osmBuildings = await Cesium.createOsmBuildingsAsync();
            viewer.scene.primitives.add(osmBuildings);
            console.log('[Cesium] OSM Buildings loaded.');
        } catch (osmError) {
            console.warn('[Cesium] OSM Buildings failed to load:', osmError);
        }
    }

    // ── Wait until the tiles for the initial view are actually rendered ──
    // tileLoadProgressEvent is unavailable in newer Cesium releases, and even
    // when present an empty download queue is misleading: the tileset refines
    // in waves, so the queue can momentarily hit 0 between waves while finer
    // tiles are still streaming. Cesium3DTileset.tilesLoaded is the reliable
    // signal — it becomes true only when every tile needed for the current
    // view is loaded AND drawn. The splash keeps playing until then (with a
    // safety cap) so the user never lands on an empty sky.
    // Fleet demo gets the shortest coarse-scene budget. The default path also
    // becomes interactive before fine photogrammetry finishes; both continue
    // refining in the background.
    const fleetDemo = new URLSearchParams(window.location.search).get('fleet') === 'demo';
    await waitForTilesRendered(googleTileset, fleetDemo ? 6000 : 8000);

    // Signal splash screen that Cesium 3D scene is ready with tiles rendered
    window.dispatchEvent(new CustomEvent('cesiumReady'));
    // Once interaction is available, restore a balanced quality target without
    // making the initial render wait for the second refinement wave.
    if (googleTileset) {
        setTimeout(() => {
            if (!googleTileset || googleTileset.isDestroyed?.()) return;
            googleTileset.maximumScreenSpaceError = 12;
        }, 10000);
    }
}

/**
 * Update the Cesium camera to match the drone state and gimbal angles.
 * Called from the Vue dashboard on every animation frame.
 */
// Expose the viewer and tileset so the Vue dashboard can run collision raycasts.
window.cesiumViewer = viewer;
window.getGoogleTileset = function() {
    return googleTileset;
};

window.updateCesiumCamera = function(state) {
    if (!viewer) return;
    const position = Cesium.Cartesian3.fromDegrees(state.lon, state.lat, state.alt);
    const heading = Cesium.Math.toRadians(((state.heading + state.gimbalYaw) % 360 + 360) % 360);
    const pitch = Cesium.Math.toRadians(state.gimbalPitch);
    const roll = Cesium.Math.toRadians(state.gimbalRoll);

    viewer.camera.setView({
        destination: position,
        orientation: { heading, pitch, roll }
    });
};

function fleetCameraOffset(state, mode = 'follow', range = 24) {
    const heading = mode === 'top'
        ? Cesium.Math.toRadians(Number(state.gimbalYaw || 0))
        : Cesium.Math.toRadians(((Number(state.heading ?? state.yaw ?? 0) + 180 + Number(state.gimbalYaw || 0)) % 360 + 360) % 360);
    const pitch = mode === 'top'
        ? Cesium.Math.toRadians(-89)
        : Cesium.Math.toRadians(Math.max(-80, Math.min(-8, -24 + Number(state.gimbalPitch || 0))));
    return new Cesium.HeadingPitchRange(heading, pitch, Math.max(5, Number(range) || 24));
}

window.updateFleetCamera = function updateFleetCamera(state, options = {}) {
    if (!viewer || !state || options.mode === 'free') return;
    if (options.mode === 'fpv') {
        const destination = Cesium.Cartesian3.fromDegrees(
            Number(state.lon),
            Number(state.lat),
            Math.max(0, Number(state.alt) || 0) + 0.28,
        );
        viewer.camera.setView({
            destination,
            orientation: {
                heading: Cesium.Math.toRadians(((Number(state.heading || state.yaw || 0) + Number(options.gimbalYaw || 0)) % 360 + 360) % 360),
                pitch: Cesium.Math.toRadians(Number(options.gimbalPitch || 0)),
                roll: Cesium.Math.toRadians(Number(options.gimbalRoll || 0)),
            },
        });
        return;
    }
    const cameraState = {
        ...state,
        gimbalYaw: options.gimbalYaw,
        gimbalPitch: options.gimbalPitch,
    };
    const target = Cesium.Cartesian3.fromDegrees(
        Number(state.lon),
        Number(state.lat),
        Math.max(0, Number(state.alt) || 0),
    );
    viewer.camera.lookAt(target, fleetCameraOffset(cameraState, options.mode, options.range));
};

window.flyFleetCamera = function flyFleetCamera(state, options = {}) {
    if (!viewer || !state) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    if (options.mode === 'fpv') {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
                Number(state.lon),
                Number(state.lat),
                Math.max(0, Number(state.alt) || 0) + 0.28,
            ),
            orientation: {
                heading: Cesium.Math.toRadians(((Number(state.heading || state.yaw || 0) + Number(options.gimbalYaw || 0)) % 360 + 360) % 360),
                pitch: Cesium.Math.toRadians(Number(options.gimbalPitch || 0)),
                roll: Cesium.Math.toRadians(Number(options.gimbalRoll || 0)),
            },
            duration: Number(options.duration ?? 0.55),
        });
        return;
    }
    const target = Cesium.Cartesian3.fromDegrees(
        Number(state.lon),
        Number(state.lat),
        Math.max(0, Number(state.alt) || 0),
    );
    viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 1), {
        duration: Number(options.duration ?? 0.7),
        offset: fleetCameraOffset({
            ...state,
            gimbalYaw: options.gimbalYaw,
            gimbalPitch: options.gimbalPitch,
        }, options.mode, options.range),
    });
};

window.showFleetOverview = function showFleetOverview(states = [], options = {}) {
    if (!viewer) return;
    const positions = states
        .filter((state) => state && Number.isFinite(Number(state.lon)) && Number.isFinite(Number(state.lat)))
        .map((state) => Cesium.Cartesian3.fromDegrees(
            Number(state.lon),
            Number(state.lat),
            Math.max(0, Number(state.alt) || 0),
        ));
    if (!positions.length) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    const sphere = Cesium.BoundingSphere.fromPoints(positions);
    const range = Math.max(Number(options.range) || 0, sphere.radius * 2.6, 36);
    viewer.camera.flyToBoundingSphere(sphere, {
        duration: Number(options.duration ?? 0.8),
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-72), range),
    });
};

window.releaseFleetCamera = function releaseFleetCamera() {
    if (!viewer) return;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
};

window.addEventListener('load', loadArena);
