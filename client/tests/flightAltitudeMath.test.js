import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampDescentToSurface,
  groundContactFromRelative,
} from '../composables/flightAltitudeMath.js';

test('low-altitude flight is not classified as landed', () => {
  assert.equal(groundContactFromRelative(0.1, false), true);
  assert.equal(groundContactFromRelative(0.3, true), true);
  assert.equal(groundContactFromRelative(0.3, false), false);
  assert.equal(groundContactFromRelative(1, true), false);
  assert.equal(groundContactFromRelative(7, true), false);
});

test('descent stops at the sampled surface without blocking ascent', () => {
  assert.equal(clampDescentToSurface(12, 10, -3, true), -2);
  assert.equal(clampDescentToSurface(12, 10, -1, true), -1);
  assert.equal(clampDescentToSurface(12, 10, 1, true), 1);
  assert.equal(clampDescentToSurface(12, 10, -3, false), -3);
});
