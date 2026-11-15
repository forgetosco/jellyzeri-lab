import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBalloonImpactImpulse,
  computeWeakenedBalloonForce,
  DEFAULT_BALLOON_PARAMS,
} from './balloonPhysics';

test('computeWeakenedBalloonForce compensates gravity only partially so average net force is downward', () => {
  const weight = DEFAULT_BALLOON_PARAMS.mass * DEFAULT_BALLOON_PARAMS.gravity;
  let sum = 0;
  const samples = 100;
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * ((Math.PI * 2) / DEFAULT_BALLOON_PARAMS.oscillationFreq);
    sum += computeWeakenedBalloonForce(0, t);
  }
  const avgLift = sum / samples;
  assert.ok(avgLift > weight * 0.75, 'balloon should have substantial upward buoyancy');
  assert.ok(avgLift < weight * 0.95, 'weakened balloon must average less than weight so it descends');
});

test('computeWeakenedBalloonForce provides gentle vertical air damping when descending', () => {
  const atRest = computeWeakenedBalloonForce(0, 0);
  const falling = computeWeakenedBalloonForce(-1.2, 0);
  const rising = computeWeakenedBalloonForce(1.5, 0);
  assert.ok(falling > atRest, 'downward motion should experience upward air drag');
  assert.ok(rising < atRest, 'upward motion should experience downward air drag');
});

test('computeBalloonImpactImpulse transfers impulse along true contact angle and scales with intensity', () => {
  const mass = 0.48;
  // Direct upward hit from below
  const upWeak = computeBalloonImpactImpulse(
    { x: 0, y: 1.0, z: 0 },
    { x: 0, y: 3.0, z: 0 },
    { x: 0, y: 2.1, z: 0 },
    { x: 0, y: -0.4, z: 0 },
    mass
  );
  const upStrong = computeBalloonImpactImpulse(
    { x: 0, y: 1.0, z: 0 },
    { x: 0, y: 8.0, z: 0 },
    { x: 0, y: 2.1, z: 0 },
    { x: 0, y: -0.4, z: 0 },
    mass
  );
  assert.ok(upWeak && upStrong);
  assert.ok(Math.abs(upWeak.x) < 1e-6 && Math.abs(upWeak.z) < 1e-6);
  assert.ok(upStrong.y > upWeak.y, 'stronger slam must produce proportionally stronger upward impulse');

  // Angled 45-degree hit from -X / -Y -> pushes +X / +Y
  const angled = computeBalloonImpactImpulse(
    { x: -0.8, y: 1.2, z: 0 },
    { x: 5.0, y: 5.0, z: 0 },
    { x: 0.0, y: 2.0, z: 0 },
    { x: 0, y: 0, z: 0 },
    mass
  );
  assert.ok(angled);
  assert.ok(angled.x > 0 && angled.y > 0, 'angled impact must push along positive X and Y');
  assert.ok(Math.abs(angled.x - angled.y) < 0.8, '45-degree contact should give symmetric X/Y push');
});

test('computeBalloonImpactImpulse returns null when separating', () => {
  const separating = computeBalloonImpactImpulse(
    { x: 0, y: 1.0, z: 0 },
    { x: 0, y: -2.0, z: 0 },
    { x: 0, y: 2.1, z: 0 },
    { x: 0, y: 2.0, z: 0 }
  );
  assert.equal(separating, null);
});
