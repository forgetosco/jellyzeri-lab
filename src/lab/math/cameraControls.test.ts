import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStickInput,
  computeCameraRelativeDirection,
  computeImpulseVector,
  stepSquashSpring,
  computeBalloonBuoyancyForce,
} from './cameraControls';

test('normalizeStickInput respects deadzone and clamps diagonal vectors', () => {
  const zero = normalizeStickInput(0.05, -0.05, 0.12);
  assert.equal(zero.magnitude, 0);
  assert.equal(zero.x, 0);
  assert.equal(zero.y, 0);

  const diag = normalizeStickInput(1, 1, 0.1);
  assert.ok(Math.abs(diag.magnitude - 1) < 1e-6);
  assert.ok(Math.hypot(diag.x, diag.y) <= 1.00001);
});

test('computeCameraRelativeDirection aligns forward/right with camera yaw', () => {
  // Camera yaw = 0 looks down -Z; forward stick (y = +1) => (0, 0, -1)
  const fwd0 = computeCameraRelativeDirection(0, 1, 0);
  assert.ok(Math.abs(fwd0.x) < 1e-6);
  assert.ok(fwd0.z < -0.99);

  // Right stick (x = +1) at yaw = 0 => (+1, 0, 0)
  const right0 = computeCameraRelativeDirection(1, 0, 0);
  assert.ok(right0.x > 0.99);
  assert.ok(Math.abs(right0.z) < 1e-6);

  // Camera rotated +90 deg (+PI/2) looks down -X; forward stick (y = +1) => (-1, 0, 0)
  const fwd90 = computeCameraRelativeDirection(0, 1, Math.PI / 2);
  assert.ok(fwd90.x < -0.99);
  assert.ok(Math.abs(fwd90.z) < 1e-6);
});

test('computeImpulseVector scales predictably with charge ratio and preserves direction', () => {
  const low = computeImpulseVector(0, 1, 0, 0.2);
  const high = computeImpulseVector(0, 1, 0, 1.0);
  assert.ok(high.y > low.y);
  assert.ok(Math.abs(high.z) > Math.abs(low.z));
  assert.ok(high.z < 0);
});

test('stepSquashSpring preserves volume and settles toward target', () => {
  let state = { scaleY: 0.55, velocityY: 0, scaleXZ: 1 / Math.sqrt(0.55) };
  for (let i = 0; i < 120; i++) {
    state = stepSquashSpring(state, 1.0, 220, 16, 1 / 60);
    const volume = state.scaleXZ * state.scaleXZ * state.scaleY;
    assert.ok(Math.abs(volume - 1) < 1e-5);
  }
  assert.ok(Math.abs(state.scaleY - 1.0) < 0.02);
});

test('computeBalloonBuoyancyForce models weakened buoyancy below full gravity', () => {
  const mass = 0.6;
  const gravity = 9.81;
  const weight = mass * gravity;
  const highAltForce = computeBalloonBuoyancyForce(3.0, 2.5, mass, gravity, 0);
  assert.ok(highAltForce < weight, 'Weakened balloon should not float away uncontrollably');
  assert.ok(highAltForce > weight * 0.7, 'Buoyancy should still support most of its weight');
});
