import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankCapture,
  blankLocation,
  buildReportPayload,
  routeDistanceMeters,
  summarizeCaptureSafety,
  summarizeReportDraft,
} from '../composables/missionReportPayload.js';

test('buildReportPayload groups photos by location and computes route distance', () => {
  const location = blankLocation(1);
  location.title = 'MIT Dome';
  location.route.origin.lat = 42.3601;
  location.route.origin.lon = -71.0942;
  location.route.destination.lat = 42.3602;
  location.route.destination.lon = -71.0941;
  location.route.instructionsText = 'Walk to the observation point\nFace north';
  location.captures.push(blankCapture({
    filename: 'north.png',
    dataUrl: 'data:image/png;base64,abc',
    droneId: 'cf-01',
  }));

  const payload = buildReportPayload({
    title: 'Customer report',
    roomId: 'local-flight-room',
    missionId: 'mission-1',
    locations: [location],
  });

  assert.equal(payload.locations.length, 1);
  assert.equal(payload.locations[0].captures.length, 1);
  assert.equal(payload.locations[0].route.instructions.length, 2);
  assert.ok(payload.locations[0].route.distanceMeters > 0);
  assert.equal(routeDistanceMeters(location.route), payload.locations[0].route.distanceMeters);
});

test('summarizeCaptureSafety warns when different drones submit close telemetry', () => {
  const location = blankLocation(1);
  location.captures.push(
    blankCapture({ droneId: 'cf-01', lat: 42.36, lon: -71.09, alt: 30 }),
    blankCapture({ droneId: 'cf-02', lat: 42.3600001, lon: -71.0900001, alt: 30 }),
  );
  const safety = summarizeCaptureSafety([location]);

  assert.equal(safety.status, 'warning');
  assert.equal(safety.warningCount, 1);
  assert.equal(safety.checkedPairs, 1);
});

test('summarizeReportDraft counts locations and captures', () => {
  const location = blankLocation(1);
  location.captures.push(blankCapture({ droneId: 'cf-01' }));
  const summary = summarizeReportDraft({ title: 'Draft', locations: [location] });

  assert.equal(summary.locationCount, 1);
  assert.equal(summary.captureCount, 1);
});
