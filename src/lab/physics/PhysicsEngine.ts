import * as CANNON from 'cannon-es';
import RAPIER from '@dimforge/rapier3d-compat';
import { isSupportContactValid, type Vec3 } from '../math/cameraControls';

export type PhysicsEngineKind = 'cannon' | 'rapier';

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface BodyTransform {
  position: Vec3;
  quaternion: Quat;
  velocity: Vec3;
}

export interface SupportContactInfo {
  grounded: boolean;
  normalY: number;
  contactCount: number;
}

export interface BodyCollisionReport {
  hitSurfaceId: string | null;
  hitBodyIds: string[];
}

export interface PhysicsBodyHandle {
  id: string;
  applyImpulse(impulse: Vec3): void;
  applyForce(force: Vec3): void;
  setVelocity(vel: Vec3): void;
  getVelocity(): Vec3;
  getTransform(): BodyTransform;
  setPosition(pos: Vec3): void;
  setEnabled(enabled: boolean): void;
  wakeUp(): void;
}

export interface IPhysicsWorld {
  readonly kind: PhysicsEngineKind;
  readonly gravity: number;
  lastStepMs: number;
  bodyCount(): number;
  addStaticBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    restitution?: number,
    rotation?: Quat
  ): void;
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
      canSleep?: boolean;
      ccdEnabled?: boolean;
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
  getSupportContact(handle: PhysicsBodyHandle, minNormalY?: number): SupportContactInfo;
  getBodyCollisions(handle: PhysicsBodyHandle, nonFatalBodyIds?: string[]): BodyCollisionReport;
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
  private bodiesById = new Map<string, CANNON.Body>();
  private idByBody = new Map<CANNON.Body, string>();

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
        restitution: 0.12,
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

  public addStaticBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    restitution = 0.25,
    rotation?: Quat
  ): void {
    const body = new CANNON.Body({
      mass: 0,
      material: restitution > 0.4 ? this.bouncyMat : this.defaultMat,
      shape: new CANNON.Box(new CANNON.Vec3(halfExtents.x, halfExtents.y, halfExtents.z)),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
    });
    if (rotation) {
      body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
    }
    (body as unknown as { userDataId: string }).userDataId = id;
    this.idByBody.set(body, id);
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
      canSleep?: boolean;
      ccdEnabled?: boolean;
    }
  ): PhysicsBodyHandle {
    const mat = (options?.restitution ?? 0.2) > 0.4 ? this.bouncyMat : this.defaultMat;
    const body = new CANNON.Body({
      mass,
      material: mat,
      shape: new CANNON.Sphere(radius),
      position: new CANNON.Vec3(pos.x, pos.y, pos.z),
      linearDamping: options?.linearDamping ?? 0.22,
      angularDamping: options?.angularDamping ?? 0.4,
    });
    body.allowSleep = options?.canSleep ?? true;
    body.sleepSpeedLimit = 0.08;
    body.sleepTimeLimit = 1.0;
    this.world.addBody(body);
    this.bodiesById.set(id, body);
    this.idByBody.set(body, id);
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
    this.bodiesById.set(id, body);
    this.idByBody.set(body, id);
    return this.wrapBody(id, body);
  }

  public getSupportContact(handle: PhysicsBodyHandle, minNormalY = 0.58): SupportContactInfo {
    const body = this.bodiesById.get(handle.id);
    if (!body) return { grounded: false, normalY: 0, contactCount: 0 };

    const vel: Vec3 = { x: body.velocity.x, y: body.velocity.y, z: body.velocity.z };
    let grounded = false;
    let bestNormalY = -1;
    let contactCount = 0;

    for (let i = 0; i < this.world.contacts.length; i++) {
      const c = this.world.contacts[i];
      if (c.bi !== body && c.bj !== body) continue;
      contactCount++;
      const sign = c.bj === body ? 1 : -1;
      const normalIntoBody: Vec3 = {
        x: c.ni.x * sign,
        y: c.ni.y * sign,
        z: c.ni.z * sign,
      };
      if (normalIntoBody.y > bestNormalY) {
        bestNormalY = normalIntoBody.y;
      }
      if (isSupportContactValid(normalIntoBody, vel, minNormalY)) {
        grounded = true;
      }
    }

    return {
      grounded,
      normalY: contactCount > 0 ? bestNormalY : 0,
      contactCount,
    };
  }

  public getBodyCollisions(
    handle: PhysicsBodyHandle,
    nonFatalBodyIds: string[] = []
  ): BodyCollisionReport {
    const body = this.bodiesById.get(handle.id);
    if (!body) return { hitSurfaceId: null, hitBodyIds: [] };

    const nonFatalSet = new Set(nonFatalBodyIds);
    let hitSurfaceId: string | null = null;
    const hitBodyIds: string[] = [];

    for (let i = 0; i < this.world.contacts.length; i++) {
      const c = this.world.contacts[i];
      if (c.bi !== body && c.bj !== body) continue;
      const other = c.bi === body ? c.bj : c.bi;
      const otherId = this.idByBody.get(other) ?? 'surface';
      if (nonFatalSet.has(otherId)) {
        if (!hitBodyIds.includes(otherId)) hitBodyIds.push(otherId);
      } else if (hitSurfaceId === null) {
        hitSurfaceId = otherId;
      }
    }

    return { hitSurfaceId, hitBodyIds };
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
      setEnabled(enabled: boolean) {
        body.collisionResponse = enabled;
        if (!enabled) {
          body.type = CANNON.Body.KINEMATIC;
          body.velocity.set(0, 0, 0);
          body.angularVelocity.set(0, 0, 0);
        } else {
          body.type = CANNON.Body.DYNAMIC;
          body.wakeUp();
        }
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
    this.bodiesById.clear();
    this.idByBody.clear();
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
  private eventQueue: RAPIER.EventQueue;
  private dynamicBodies: RAPIER.RigidBody[] = [];
  private trackedColliders = new Map<string, { body: RAPIER.RigidBody; collider: RAPIER.Collider }>();
  private colliderIdByHandle = new Map<number, string>();
  private stepStartedPairs = new Map<number, Set<number>>();

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -this.gravity, z: 0 });
    this.eventQueue = new RAPIER.EventQueue(true);
  }

  public bodyCount(): number {
    return this.world.bodies.len();
  }

  public addStaticBox(
    id: string,
    pos: Vec3,
    halfExtents: Vec3,
    restitution = 0.25,
    rotation?: Quat
  ): void {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (rotation) {
      bodyDesc.setRotation(rotation);
    }
    const body = this.world.createRigidBody(bodyDesc);
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setRestitution(restitution)
      .setFriction(0.55)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderIdByHandle.set(collider.handle, id);
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
      canSleep?: boolean;
      ccdEnabled?: boolean;
    }
  ): PhysicsBodyHandle {
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(options?.linearDamping ?? 0.22)
      .setAngularDamping(options?.angularDamping ?? 0.4);
    if (options?.canSleep !== undefined) {
      bodyDesc.setCanSleep(options.canSleep);
    }
    if (options?.ccdEnabled) {
      bodyDesc.setCcdEnabled(true);
    }
    const body = this.world.createRigidBody(bodyDesc);
    const volume = (4 / 3) * Math.PI * Math.pow(radius, 3);
    const density = Math.max(0.05, mass / Math.max(0.001, volume));
    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setDensity(density)
      .setRestitution(options?.restitution ?? 0.12)
      .setFriction(options?.friction ?? 0.55)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    const collider = this.world.createCollider(colliderDesc, body);
    this.dynamicBodies.push(body);
    this.trackedColliders.set(id, { body, collider });
    this.colliderIdByHandle.set(collider.handle, id);
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
    const collider = this.world.createCollider(colliderDesc, body);
    this.dynamicBodies.push(body);
    this.trackedColliders.set(id, { body, collider });
    this.colliderIdByHandle.set(collider.handle, id);
    return this.wrapBody(id, body);
  }

  public getSupportContact(handle: PhysicsBodyHandle, minNormalY = 0.58): SupportContactInfo {
    const entry = this.trackedColliders.get(handle.id);
    if (!entry) return { grounded: false, normalY: 0, contactCount: 0 };

    const { body, collider } = entry;
    const pos = body.translation();
    const lv = body.linvel();
    const vel: Vec3 = { x: lv.x, y: lv.y, z: lv.z };

    let grounded = false;
    let bestNormalY = -1;
    let contactCount = 0;

    this.world.contactPairsWith(collider, (otherCollider) => {
      this.world.contactPair(collider, otherCollider, (manifold, flipped) => {
        const solverCount = manifold.numSolverContacts();
        if (solverCount > 0) {
          for (let i = 0; i < solverCount; i++) {
            const cp = manifold.solverContactPoint(i);
            if (!cp) continue;
            const dx = pos.x - cp.x;
            const dy = pos.y - cp.y;
            const dz = pos.z - cp.z;
            const len = Math.hypot(dx, dy, dz);
            if (len < 1e-5) continue;
            contactCount++;
            const normalIntoBody: Vec3 = {
              x: dx / len,
              y: dy / len,
              z: dz / len,
            };
            if (normalIntoBody.y > bestNormalY) {
              bestNormalY = normalIntoBody.y;
            }
            if (isSupportContactValid(normalIntoBody, vel, minNormalY)) {
              grounded = true;
            }
          }
          return;
        }

        const rawCount = manifold.numContacts();
        if (rawCount > 0) {
          const n = manifold.normal();
          const sign = flipped ? 1 : -1;
          for (let i = 0; i < rawCount; i++) {
            if (manifold.contactDist(i) <= 0.03) {
              contactCount++;
              const normalIntoBody: Vec3 = {
                x: n.x * sign,
                y: n.y * sign,
                z: n.z * sign,
              };
              if (normalIntoBody.y > bestNormalY) {
                bestNormalY = normalIntoBody.y;
              }
              if (isSupportContactValid(normalIntoBody, vel, minNormalY)) {
                grounded = true;
              }
            }
          }
        }
      });
    });

    return {
      grounded,
      normalY: contactCount > 0 ? bestNormalY : 0,
      contactCount,
    };
  }

  public getBodyCollisions(
    handle: PhysicsBodyHandle,
    nonFatalBodyIds: string[] = []
  ): BodyCollisionReport {
    const entry = this.trackedColliders.get(handle.id);
    if (!entry) return { hitSurfaceId: null, hitBodyIds: [] };

    const { collider } = entry;
    const nonFatalSet = new Set(nonFatalBodyIds);
    let hitSurfaceId: string | null = null;
    const hitBodyIds: string[] = [];

    const recordOtherHandle = (otherHandle: number) => {
      const otherId = this.colliderIdByHandle.get(otherHandle) ?? 'surface';
      if (nonFatalSet.has(otherId)) {
        if (!hitBodyIds.includes(otherId)) hitBodyIds.push(otherId);
      } else if (hitSurfaceId === null) {
        hitSurfaceId = otherId;
      }
    };

    // 1. Check collision events captured during the latest physics step (catches fast TOI/CCD hits)
    const startedPeers = this.stepStartedPairs.get(collider.handle);
    if (startedPeers) {
      startedPeers.forEach((otherHandle) => recordOtherHandle(otherHandle));
    }

    // 2. Check active contact manifolds (catches sustained or resting contacts)
    this.world.contactPairsWith(collider, (otherCollider) => {
      this.world.contactPair(collider, otherCollider, (manifold) => {
        if (manifold.numSolverContacts() > 0) {
          recordOtherHandle(otherCollider.handle);
          return;
        }
        const count = manifold.numContacts();
        for (let i = 0; i < count; i++) {
          if (manifold.contactDist(i) <= 0.004) {
            recordOtherHandle(otherCollider.handle);
            return;
          }
        }
      });
    });

    return { hitSurfaceId, hitBodyIds };
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
      setEnabled(enabled: boolean) {
        body.setEnabled(enabled);
      },
      wakeUp() {
        body.wakeUp();
      },
    };
  }

  public step(dt: number): void {
    const t0 = performance.now();
    this.stepStartedPairs.clear();
    this.world.timestep = Math.min(dt, 1 / 30);
    this.world.step(this.eventQueue);

    this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      let set1 = this.stepStartedPairs.get(handle1);
      if (!set1) {
        set1 = new Set<number>();
        this.stepStartedPairs.set(handle1, set1);
      }
      set1.add(handle2);

      let set2 = this.stepStartedPairs.get(handle2);
      if (!set2) {
        set2 = new Set<number>();
        this.stepStartedPairs.set(handle2, set2);
      }
      set2.add(handle1);
    });

    for (let i = 0; i < this.dynamicBodies.length; i++) {
      this.dynamicBodies[i].resetForces(false);
    }
    this.lastStepMs = performance.now() - t0;
  }

  public dispose(): void {
    this.trackedColliders.clear();
    this.colliderIdByHandle.clear();
    this.stepStartedPairs.clear();
    this.dynamicBodies = [];
    this.eventQueue.free();
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
