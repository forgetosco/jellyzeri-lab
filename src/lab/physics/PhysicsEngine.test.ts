import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld, type PhysicsEngineKind } from './PhysicsEngine';

for (const kind of ['rapier', 'cannon'] as PhysicsEngineKind[]) {
  test(`${kind}: detects ground contact, rejects airborne launch and lateral walls, recovers on landing`, async () => {
    const world = await createPhysicsWorld(kind);
    try {
      // Flat floor top at y = 0
      world.addStaticBox('floor', { x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 }, 0.1);
      // Vertical wall at x = 2
      world.addStaticBox('wall', { x: 2.5, y: 2, z: 0 }, { x: 0.5, y: 3, z: 5 }, 0.1);

      const slime = world.addDynamicSphere('slime', { x: 0, y: 0.72, z: 0 }, 0.65, 1.2, {
        restitution: 0.1,
        friction: 0.5,
        canSleep: false,
      });

      // Settle onto floor
      for (let i = 0; i < 25; i++) world.step(1 / 60);

      const onGround = world.getSupportContact(slime);
      assert.equal(onGround.grounded, true, `${kind} should detect ground support after settling`);
      assert.ok(onGround.normalY > 0.9, `expected upward normal, got ${onGround.normalY}`);

      // Launch upward
      slime.applyImpulse({ x: 0, y: 11, z: 0 });
      world.step(1 / 60);
      const midAir = world.getSupportContact(slime);
      assert.equal(midAir.grounded, false, `${kind} must immediately reject grounded state on launch`);

      // Climb for several frames
      for (let i = 0; i < 15; i++) world.step(1 / 60);
      assert.equal(world.getSupportContact(slime).grounded, false, `${kind} must stay ungrounded in flight`);

      // Fall and land back on floor
      for (let i = 0; i < 120; i++) world.step(1 / 60);
      const landed = world.getSupportContact(slime);
      assert.equal(landed.grounded, true, `${kind} must detect landing after falling back to floor`);

      // Test lateral wall contact while falling (above floor, touching wall at x = 2.0 - 0.65 = 1.35)
      slime.setPosition({ x: 1.36, y: 3.0, z: 0 });
      slime.setVelocity({ x: 3.0, y: -1.0, z: 0 });
      for (let i = 0; i < 4; i++) world.step(1 / 60);
      const wallContact = world.getSupportContact(slime);
      assert.equal(wallContact.grounded, false, `${kind} must NOT treat lateral wall contact as walkable ground`);
    } finally {
      world.dispose();
    }
  });
}

test('rapier: detects rotated ramp support contact accurately', async () => {
  const world = await createPhysicsWorld('rapier');
  try {
    // 20 deg ramp tilted around Z or X: tilt around X so -Z goes up
    const angle = (20 * Math.PI) / 180;
    const halfAngle = angle / 2;
    world.addStaticBox(
      'ramp',
      { x: 0, y: 0.8, z: 0 },
      { x: 2, y: 0.2, z: 4 },
      0.1,
      { x: Math.sin(halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) }
    );

    const slime = world.addDynamicSphere('slime', { x: 0, y: 2.0, z: 0 }, 0.65, 1.2, {
      restitution: 0.05,
      friction: 0.7,
      canSleep: false,
    });

    for (let i = 0; i < 35; i++) world.step(1 / 60);
    const rampSupport = world.getSupportContact(slime);
    assert.equal(rampSupport.grounded, true, '20 deg ramp should be recognized as valid support');
    assert.ok(rampSupport.normalY > 0.88 && rampSupport.normalY < 0.98, `expected cos(20deg)≈0.94, got ${rampSupport.normalY}`);
  } finally {
    world.dispose();
  }
});
