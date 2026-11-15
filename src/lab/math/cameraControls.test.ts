import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStickInput,
  computeCameraRelativeDirection,
  computeImpulseVector,
  stepSquashSpring,
  isSupportContactValid,
  stepChargeState,
  computeGroundedVelocity,
  computeAirborneVelocity,
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
  const fwd0 = computeCameraRelativeDirection(0, 1, 0);
  assert.ok(Math.abs(fwd0.x) < 1e-6);
  assert.ok(fwd0.z < -0.99);

  const right0 = computeCameraRelativeDirection(1, 0, 0);
  assert.ok(right0.x > 0.99);
  assert.ok(Math.abs(right0.z) < 1e-6);

  const fwd90 = computeCameraRelativeDirection(0, 1, Math.PI / 2);
  assert.ok(fwd90.x < -0.99);
  assert.ok(Math.abs(fwd90.z) < 1e-6);
});

test('isSupportContactValid accepts floor/ramp contacts and rejects walls, ceilings, and upward launch', () => {
  // Resting on flat ground
  assert.equal(
    isSupportContactValid({ x: 0, y: 1, z: 0 }, { x: 2, y: 0, z: -1 }),
    true
  );

  // Moving up a 22-deg ramp: velocity is tangent to ramp so dot(v, n) == 0
  const rad = (22 * Math.PI) / 180;
  const rampNormal = { x: 0, y: Math.cos(rad), z: Math.sin(rad) };
  const rampVel = { x: 0, y: 6 * Math.sin(rad), z: -6 * Math.cos(rad) };
  assert.equal(isSupportContactValid(rampNormal, rampVel), true);

  // Lateral wall collision during fall -> rejected
  assert.equal(
    isSupportContactValid({ x: 1, y: 0.05, z: 0 }, { x: 0, y: -3, z: 0 }),
    false
  );

  // Ceiling collision -> rejected
  assert.equal(
    isSupportContactValid({ x: 0, y: -1, z: 0 }, { x: 0, y: 4, z: 0 }),
    false
  );

  // Frame immediately after upward launch -> rejected
  assert.equal(
    isSupportContactValid({ x: 0, y: 1, z: 0 }, { x: 0, y: 7.5, z: 0 }),
    false
  );
});

test('stepChargeState strictly blocks charging and launching while airborne', () => {
  let state = { isCharging: false, chargeRatio: 0 };

  // Hold while grounded -> charges progressively up to 1.0
  let res = stepChargeState(state, true, true, 0.4, 1.0);
  state = res.nextState;
  assert.equal(state.isCharging, true);
  assert.ok(Math.abs(state.chargeRatio - 0.4) < 1e-6);
  assert.equal(res.shouldLaunch, false);

  res = stepChargeState(state, true, true, 1.0, 1.0);
  state = res.nextState;
  assert.equal(state.chargeRatio, 1.0);

  // Release while grounded -> launches once with ratio 1.0
  res = stepChargeState(state, false, true, 0.016, 1.0);
  state = res.nextState;
  assert.equal(res.shouldLaunch, true);
  assert.equal(res.launchRatio, 1.0);
  assert.equal(state.isCharging, false);
  assert.equal(state.chargeRatio, 0);

  // Try pressing & holding while airborne -> blocked!
  res = stepChargeState(state, true, false, 0.5, 1.0);
  state = res.nextState;
  assert.equal(state.isCharging, false);
  assert.equal(state.chargeRatio, 0);
  assert.equal(res.shouldLaunch, false);

  // Release while airborne -> no launch!
  res = stepChargeState(state, false, false, 0.016, 1.0);
  assert.equal(res.shouldLaunch, false);

  // Walk off a ledge while holding charge -> charge cancels immediately without mid-air launch
  const chargedOnEdge = { isCharging: true, chargeRatio: 0.7 };
  res = stepChargeState(chargedOnEdge, true, false, 0.016, 1.0);
  assert.equal(res.nextState.isCharging, false);
  assert.equal(res.nextState.chargeRatio, 0);
  assert.equal(res.shouldLaunch, false);

  // Land back on ground -> can charge again immediately
  res = stepChargeState(res.nextState, true, true, 0.25, 1.0);
  assert.equal(res.nextState.isCharging, true);
  assert.ok(res.nextState.chargeRatio > 0);
});

test('computeImpulseVector scales predictably with short vs long charge', () => {
  const shortJump = computeImpulseVector(0, 1, 0, 0.15);
  const longJump = computeImpulseVector(0, 1, 0, 1.0);
  assert.ok(longJump.y > shortJump.y);
  assert.ok(Math.abs(longJump.z) > Math.abs(shortJump.z));
  assert.ok(longJump.z < 0);
});

test('computeGroundedVelocity and computeAirborneVelocity preserve vertical gravity velocity', () => {
  const gVel = computeGroundedVelocity({ x: 0, y: -0.2, z: 0 }, { x: 1, y: 0, z: 0 }, 6.5, 12, 0.016);
  assert.ok(gVel.x > 0);
  assert.equal(gVel.y, -0.2);

  const airVel = computeAirborneVelocity({ x: 0, y: 5.5, z: -6 }, { x: 1, y: 0, z: 0 }, 5.0, 6.0, 0.016);
  assert.ok(airVel.x > 0 && airVel.x < 0.2);
  assert.equal(airVel.y, 5.5);
  assert.ok(airVel.z < -5.8);
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
