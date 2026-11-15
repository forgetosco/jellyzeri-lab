import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld, type PhysicsEngineKind } from './PhysicsEngine';
import { computeWeakenedBalloonForce } from '../math/balloonPhysics';

for (const kind of ['rapier', 'cannon'] as PhysicsEngineKind[]) {
  test(`${kind}: detects ground contact, rejects airborne launch and lateral walls, recovers on landing`, async () => {
    const world = await createPhysicsWorld(kind);
    try {
      world.addStaticBox('floor', { x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 }, 0.1);
      world.addStaticBox('wall', { x: 2.5, y: 2, z: 0 }, { x: 0.5, y: 3, z: 5 }, 0.1);

      const slime = world.addDynamicSphere('slime', { x: 0, y: 0.72, z: 0 }, 0.65, 1.2, {
        restitution: 0.1,
        friction: 0.5,
        canSleep: false,
      });

      for (let i = 0; i < 25; i++) world.step(1 / 60);

      const onGround = world.getSupportContact(slime);
      assert.equal(onGround.grounded, true, `${kind} should detect ground support after settling`);
      assert.ok(onGround.normalY > 0.9, `expected upward normal, got ${onGround.normalY}`);

      slime.applyImpulse({ x: 0, y: 11, z: 0 });
      world.step(1 / 60);
      const midAir = world.getSupportContact(slime);
      assert.equal(midAir.grounded, false, `${kind} must immediately reject grounded state on launch`);

      for (let i = 0; i < 15; i++) world.step(1 / 60);
      assert.equal(world.getSupportContact(slime).grounded, false, `${kind} must stay ungrounded in flight`);

      for (let i = 0; i < 120; i++) world.step(1 / 60);
      const landed = world.getSupportContact(slime);
      assert.equal(landed.grounded, true, `${kind} must detect landing after falling back to floor`);

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

test('rapier: balloon weakened buoyancy sinks gently, distinguishes slime contact vs fatal surfaces, and prevents tunneling via CCD', async () => {
  const world = await createPhysicsWorld('rapier');
  try {
    world.addStaticBox('ground', { x: 0, y: -0.5, z: 0 }, { x: 10, y: 0.5, z: 10 }, 0.1);
    world.addStaticBox('thin-wall', { x: 0, y: 2.5, z: -3.0 }, { x: 4, y: 2.5, z: 0.12 }, 0.1);
    world.addStaticBox('ceiling-test', { x: 0, y: 5.0, z: 0 }, { x: 4, y: 0.15, z: 4 }, 0.1);

    const slime = world.addDynamicSphere('slime', { x: 0, y: 0.65, z: 0 }, 0.65, 1.2, {
      restitution: 0.1,
      friction: 0.55,
      canSleep: false,
      ccdEnabled: true,
    });

    const balloon = world.addDynamicSphere('balloon-baby', { x: 0, y: 2.8, z: 0 }, 0.5, 0.48, {
      restitution: 0.5,
      friction: 0.2,
      linearDamping: 0.65,
      angularDamping: 0.85,
      canSleep: false,
      ccdEnabled: true,
    });

    // 1. Check gentle descent without input
    const startY = balloon.getTransform().position.y;
    for (let i = 0; i < 60; i++) {
      const vy = balloon.getVelocity().y;
      balloon.applyForce({ x: 0, y: computeWeakenedBalloonForce(vy, i / 60), z: 0 });
      world.step(1 / 60);
    }
    const after1sY = balloon.getTransform().position.y;
    assert.ok(after1sY < startY - 0.15, `expected gentle sink after 1s, start=${startY}, after=${after1sY}`);
    assert.ok(after1sY > 1.2, `sink should be gentle (not free-fall), after=${after1sY}`);

    // 2. Contact with Slime is non-fatal (hitSurfaceId === null, hitBodyIds includes 'slime')
    balloon.setPosition({ x: 0, y: 1.78, z: 0 });
    balloon.setVelocity({ x: 0, y: -1.5, z: 0 });
    slime.setPosition({ x: 0, y: 0.65, z: 0 });
    world.step(1 / 60);
    const slimeReport = world.getBodyCollisions(balloon, ['slime']);
    assert.equal(slimeReport.hitSurfaceId, null, 'slime contact must NOT be fatal');
    assert.ok(slimeReport.hitBodyIds.includes('slime'), 'should report non-fatal contact with slime');

    // 3. Fast shot toward thin wall (0.24m thick) must detect collision without tunneling through
    balloon.setPosition({ x: 0, y: 2.5, z: -1.8 });
    balloon.setVelocity({ x: 0, y: 0, z: -32.0 });
    let wallHitId: string | null = null;
    let passedThroughWall = false;
    for (let i = 0; i < 15; i++) {
      world.step(1 / 60);
      const rep = world.getBodyCollisions(balloon, ['slime']);
      if (rep.hitSurfaceId) {
        wallHitId = rep.hitSurfaceId;
        break;
      }
      if (balloon.getTransform().position.z < -3.2) {
        passedThroughWall = true;
      }
    }
    assert.equal(passedThroughWall, false, 'balloon must not tunnel through thin wall');
    assert.equal(wallHitId, 'thin-wall', 'must detect fatal hit on thin-wall');

    // 4. Upward shot into ceiling must detect ceiling-test immediately
    balloon.setPosition({ x: 0, y: 4.1, z: 0 });
    balloon.setVelocity({ x: 0, y: 18.0, z: 0 });
    let ceilingHit: string | null = null;
    for (let i = 0; i < 10; i++) {
      world.step(1 / 60);
      const rep = world.getBodyCollisions(balloon, ['slime']);
      if (rep.hitSurfaceId) {
        ceilingHit = rep.hitSurfaceId;
        break;
      }
    }
    assert.equal(ceilingHit, 'ceiling-test', 'must detect fatal hit on ceiling');
  } finally {
    world.dispose();
  }
});
