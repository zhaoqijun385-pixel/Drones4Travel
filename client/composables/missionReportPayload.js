const EARTH_RADIUS_METERS = 6_371_000;
export const DEFAULT_COLLISION_THRESHOLD_METERS = 8;

export function emptyRoutePoint(label = '') {
  return { label, lat: '', lon: '', alt: '' };
}

export function blankCapture(overrides = {}) {
  return {
    filename: '',
    contentType: 'image/png',
    dataUrl: '',
    droneId: '',
    vantageLabel: '',
    capturedAt: '',
    lat: '',
    lon: '',
    alt: '',
    yaw: '',
    pitch: '',
    roll: '',
    note: '',
    ...overrides,
  };
}

export function blankLocation(index = 1) {
  return {
    id: `site-${Date.now().toString(36)}-${index}`,
    title: `Observation site ${index}`,
    address: '',
    description: '',
    route: {
      origin: emptyRoutePoint('Selected point'),
      destination: emptyRoutePoint(`Observation site ${index}`),
      mode: 'walk',
      distanceMeters: '',
      durationMinutes: '',
      instructionsText: '',
    },
    captures: [],
  };
}

export function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
}

function textOrNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('file_read_failed'));
    reader.readAsDataURL(file);
  });
}

export function haversineMeters(a, b) {
  const lat1 = numberOrNull(a?.lat);
  const lon1 = numberOrNull(a?.lon);
  const lat2 = numberOrNull(b?.lat);
  const lon2 = numberOrNull(b?.lon);
  if ([lat1, lon1, lat2, lon2].some((value) => value === null)) return null;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const h = Math.sin(dPhi / 2) ** 2
    + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function routeDistanceMeters(route) {
  const explicit = numberOrNull(route?.distanceMeters);
  if (explicit !== null) return explicit;
  return haversineMeters(route?.origin, route?.destination);
}

function pointPayload(point) {
  if (!point) return null;
  return {
    label: textOrNull(point.label),
    lat: numberOrNull(point.lat),
    lon: numberOrNull(point.lon),
    alt: numberOrNull(point.alt),
  };
}

function routePayload(route) {
  if (!route) return null;
  const instructions = String(route.instructionsText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    origin: pointPayload(route.origin),
    destination: pointPayload(route.destination),
    mode: route.mode || 'walk',
    distanceMeters: routeDistanceMeters(route),
    durationMinutes: numberOrNull(route.durationMinutes),
    instructions,
  };
}

function capturePayload(capture) {
  return {
    filename: textOrNull(capture.filename),
    contentType: capture.contentType || 'image/png',
    dataUrl: textOrNull(capture.dataUrl),
    droneId: textOrNull(capture.droneId),
    vantageLabel: textOrNull(capture.vantageLabel),
    capturedAt: textOrNull(capture.capturedAt),
    lat: numberOrNull(capture.lat),
    lon: numberOrNull(capture.lon),
    alt: numberOrNull(capture.alt),
    yaw: numberOrNull(capture.yaw),
    pitch: numberOrNull(capture.pitch),
    roll: numberOrNull(capture.roll),
    note: textOrNull(capture.note),
  };
}

export function buildReportPayload(draft) {
  const locations = (draft.locations || [])
    .filter((location) => textOrNull(location.title))
    .map((location) => ({
      id: textOrNull(location.id),
      title: textOrNull(location.title),
      address: textOrNull(location.address),
      description: textOrNull(location.description),
      route: routePayload(location.route),
      captures: (location.captures || []).map(capturePayload),
    }));
  return {
    title: textOrNull(draft.title) || `Mission report ${new Date().toISOString().slice(0, 10)}`,
    summary: textOrNull(draft.summary),
    roomId: textOrNull(draft.roomId),
    missionId: textOrNull(draft.missionId),
    locations,
  };
}

function capturePosition(capture) {
  const lat = numberOrNull(capture?.lat);
  const lon = numberOrNull(capture?.lon);
  if (lat === null || lon === null) return null;
  return { lat, lon, alt: numberOrNull(capture.alt) || 0 };
}

function captureDistanceMeters(first, second) {
  const a = capturePosition(first);
  const b = capturePosition(second);
  if (!a || !b) return null;
  const horizontal = haversineMeters(a, b);
  if (horizontal === null) return null;
  return Math.hypot(horizontal, a.alt - b.alt);
}

export function summarizeCaptureSafety(locations, threshold = DEFAULT_COLLISION_THRESHOLD_METERS) {
  const warnings = [];
  let checkedPairs = 0;
  (locations || []).forEach((location) => {
    const captures = (location.captures || []).filter(capturePosition);
    captures.forEach((first, index) => {
      captures.slice(index + 1).forEach((second) => {
        if (first.droneId && second.droneId && first.droneId === second.droneId) return;
        checkedPairs += 1;
        const distance = captureDistanceMeters(first, second);
        if (distance !== null && distance < threshold) {
          warnings.push({
            locationTitle: location.title,
            firstDroneId: first.droneId || '',
            secondDroneId: second.droneId || '',
            distanceMeters: Number(distance.toFixed(2)),
          });
        }
      });
    });
  });
  return {
    thresholdMeters: threshold,
    checkedPairs,
    warningCount: warnings.length,
    warnings,
    status: warnings.length ? 'warning' : checkedPairs ? 'clear' : 'insufficient_telemetry',
  };
}

export function summarizeReportDraft(draft) {
  const payload = buildReportPayload(draft);
  return {
    locationCount: payload.locations.length,
    captureCount: payload.locations.reduce((sum, location) => sum + location.captures.length, 0),
    safety: summarizeCaptureSafety(draft.locations || []),
  };
}
