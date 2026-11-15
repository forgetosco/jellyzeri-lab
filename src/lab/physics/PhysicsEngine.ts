import * as CANNON from 'cannon-es';
import RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from '../math/cameraControls';

export type PhysicsEngineKind = 'cannon' | 'rapier';

export interface BodyTransform {
  position: Vec3;
  quaternion: { x: number; y: number; z: number; w: number };
  velocity: Vec3;
}

export interface PhysicsBodyHandle {
  id: string;
  applyImpulse(impulse: Vec3): void;
  applyForce(force: Vec3): void;
  setVelocity(vel: Vec3): void;
  getVelocity(): Vec3;
  getTransform(): BodyTransform;
  setPosition(pos: Vec3): void;
  wakeUp(): void;
}

export interface IPhysicsWorld {
  readonly kind: PhysicsEngineKind;
  readonly gravity: number;
  lastStepMs: number;
  bodyCount(): number;
  addStaticBox(id: string, pos: Vec3, halfExtents: Vec3, restitution?: number): void;
  addDynamicSphere(
    id: string,
    pos: Vec3,
    radius: number,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
      angularDamping?: number;
    }
  ): PhysicsBodyHandle;
  addDynamicBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
    }
  ): PhysicsBodyHandle;
  step(dt: number): void;
  dispose(): void;
}

class CannonPhysicsWorld implements IPhysicsWorld {
  public readonly kind: PhysicsEngineKind = 'cannon';
  public readonly gravity = 9.81;
  public lastStepMs = 0;

  private world: CANNON.World;
  private defaultMat: CANNON.Material;
  private bouncyMat: CANNON.Material;

  constructor() {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -this.gravity, 0),
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    (this.world.solver as CANNON.GSSolver).iterations = 8;

    this.defaultMat = new CANNON.Material('default');
    this.bouncyMat = new CANNON.Material('bouncy');

    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.defaultMat, this.defaultMat, {
        friction: 0.45,
        restitution: 0.25,
      })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.defaultMat, this.bouncyMat, {
        friction: 0.3,
        restitution: 0.55,
      })
    );
    this.world.addContactMaterial(
      new CANNON.ContactMaterial(this.bouncyMat, this.bouncyMat, {
        friction: 0.25,
        restitution: 0.65,
      })
    );
  }

  public bodyCount(): number {
    return this.world.bodies.length;
  }

  public addStaticBox(id: string, pos: Vec3, halfExtents: Vec3, restitution = 0.25): void {
    const body = new CANNON.Body({
      mass: 0,
      material: restitution > 0.4 ? this.bouncyMat : this.defaultMat,
      shape: new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    });
    (body as unknown as { userDataId: string }).userDataId = id;
    this.world.addBody(body);
  }

  public addDynamicSphere(
    id: string,
    pos: Vec3,
    radius: number,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
      angularDamping?: number;
    }
  ): PhysicsBodyHandle {
    const mat = (options?.restitution ?? 0.3) > 0.4 ? this.bouncyMat : this.defaultMat;
    const body = new CANNON.Body({
      mass,
      material: mat,
      shape: new CANNON.Sphere(radius),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      linearDamping: options?.linearDamping ?? 0.22,
      angularDamping: options?.angularDamping ?? 0.4,
    });
    body.sleepSpeedLimit = 0.08;
    body.sleepTimeLimit = 1.0;
    this.world.addBody(body);
    return this.wrapBody(id, body);
  }

  public addDynamicBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
    }
  ): PhysicsBodyHandle {
    const mat = (options?.restitution ?? 0.3) > 0.4 ? this.bouncyMat : this.defaultMat;
    const body = new CANNON.Body({
      mass,
      material: mat,
      shape: new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      linearDamping: options?.linearDamping ?? 0.15,
      angularDamping: 0.3,
    });
    this.world.addBody(body);
    return this.wrapBody(id, body);
  }

  private wrapBody(id: string, body: CANNON.Body): PhysicsBodyHandle {
    return {
      id,
      applyImpulse(impulse: Vec3) {
        body.wakeUp();
        body.applyImpulse(new CANNON.Vec3(impulse.x, impulse.y, impulse.z));
      },
      applyForce(force: Vec3) {
        body.wakeUp();
        body.applyForce(new CANNON.Vec3(force.x, force.y, force.z));
      },
      setVelocity(vel: Vec3) {
        body.wakeUp();
        body.velocity.set(vel.x, vel.y, vel.z);
      },
      getVelocity(): Vec3 {
        return { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z };
      },
      getTransform(): BodyTransform {
        return {
          position: { x: body.position.x, y: body.position.y, z: body.position.z },
          quaternion: {
            x: body.quaternion.x,
            y: body.quaternion.y,
            z: body.quaternion.z,
            w: body.quaternion.w,
          },
          velocity: { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z },
        };
      },
      setPosition(pos: Vec3) {
        body.wakeUp();
        body.position.set(pos.x, pos.y, pos.z);
        body.velocity.set(0, 0, 0);
        body.angularVelocity.set(0, 0, 0);
      },
      wakeUp() {
        body.wakeUp();
      },
    };
  }

  public step(dt: number): void {
    const t0 = performance.now();
    this.world.step(1 / 60, Math.min(dt, 0.05), 3);
    this.lastStepMs = performance.now() - t0;
  }

  public dispose(): void {
    while (this.world.bodies.length > 0) {
      this.world.removeBody(this.world.bodies[0]);
    }
  }
}

let rapierInitPromise: Promise<void> | null = null;
function ensureRapierInit(): Promise<void> {
  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init();
  }
  return rapierInitPromise;
}

class RapierPhysicsWorld implements IPhysicsWorld {
  public readonly kind: PhysicsEngineKind = 'rapier';
  public readonly gravity = 9.81;
  public lastStepMs = 0;

  private world: RAPIER.World;
  private dynamicBodies: RAPIER.RigidBody[] = [];

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -this.gravity, z: 0 });
  }

  public bodyCount(): number {
    return this.world.bodies.len();
  }

  public addStaticBox(_id: string, pos: Vec3, halfExtents: Vec3, restitution = 0.25): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setRestitution(restitution)
      .setFriction(0.5);
    this.world.createCollider(colliderDesc, body);
  }

  public addDynamicSphere(
    id: string,
    pos: Vec3,
    radius: number,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
      angularDamping?: number;
    }
  ): PhysicsBodyHandle {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(options?.linearDamping ?? 0.22)
      .setAngularDamping(options?.angularDamping ?? 0.4);
    const body = this.world.createRigidBody(bodyDesc);
    const volume = (4 / 3) * Math.PI * Math.pow(radius, 3);
    const density = Math.max(0.05, mass / Math.max(0.001, volume));
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setDensity(density)
      .setRestitution(options?.restitution ?? 0.35)
      .setFriction(options?.friction ?? 0.45);
    this.world.createCollider(colliderDesc, body);
    this.dynamicBodies.push(body);
    return this.wrapBody(id, body);
  }

  public addDynamicBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    mass: number,
    options?: {
      restitution?: number;
      friction?: number;
      linearDamping?: number;
    }
  ): PhysicsBodyHandle {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(options?.linearDamping ?? 0.15)
      .setAngularDamping(0.3);
    const body = this.world.createRigidBody(bodyDesc);
    const volume = 8 * halfExtents.x * halfExtents.y * halfExtents.z;
    const density = Math.max(0.05, mass / Math.max(0.001, volume));
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(density)
      .setRestitution(options?.restitution ?? 0.3)
      .setFriction(options?.friction ?? 0.45);
    this.world.createCollider(colliderDesc, body);
    this.dynamicBodies.push(body);
    return this.wrapBody(id, body);
  }

  private wrapBody(id: string, body: RAPIER.RigidBody): PhysicsBodyHandle {
    return {
      id,
      applyImpulse(impulse: Vec3) {
        body.applyImpulse({ x: impulse.x, y: impulse.y, z: impulse.z }, true);
      },
      applyForce(force: Vec3) {
        body.resetForces(true);
        body.addForce({ x: force.x, y: force.y, z: force.z }, true);
      },
      setVelocity(vel: Vec3) {
        body.setLinvel({ x: vel.x, y: vel.y, z: vel.z }, true);
      },
      getVelocity(): Vec3 {
        const v = body.linvel();
        return { x: v.x, y: v.y, z: v.z };
      },
      getTransform(): BodyTransform {
        const t = body.translation();
        const r = body.rotation();
        const v = body.linvel();
        return {
          position: { x: t.x, y: t.y, z: t.z },
          quaternion: { x: r.x, y: r.y, z: r.z, w: r.w },
          velocity: { x: v.x, y: v.y, z: v.z },
        };
      },
      setPosition(pos: Vec3) {
        body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      },
      wakeUp() {
        body.wakeUp();
      },
    };
  }

  public step(dt: number): void {
    const t0 = performance.now();
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step();
    // Clear one-frame forces after step so buoyancy force never accumulates across frames
    for (let i = 0; i < this.dynamicBodies.length; i++) {
      this.dynamicBodies[i].resetForces(false);
    }
    this.lastStepMs = performance.now() - t0;
  }

  public dispose(): void {
    this.dynamicBodies = [];
    this.world.free();
  }
}

export async function createPhysicsWorld(kind: PhysicsEngineKind): Promise<IPhysicsWorld> {
  if (kind === 'rapier') {
    await ensureRapierInit();
    return new RapierPhysicsWorld();
  }
  return new CannonPhysicsWorld();
}
