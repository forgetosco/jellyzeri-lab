export interface StickVector {
  x: number;
  y: number;
  magnitude: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SquashSpringState {
  scaleY: number;
  velocityY: number;
  scaleXZ: number;
}

export interface ChargeState {
  isCharging: boolean;
  chargeRatio: number;
}

export interface ChargeStepResult {
  nextState: ChargeState;
  shouldLaunch: boolean;
  launchRatio: number;
}

/**
 * Applies circular deadzone and clamps stick magnitude to [0, 1].
 */
export function normalizeStickInput(
  rawX: number,
  rawY: number,
  deadzone = 0.12
): StickVector {
  const len = Math.hypot(rawX, rawY);
  if (len <= deadzone || len === 0) {
    return { x: 0, y: 0, magnitude: 0 };
  }
  const effective = Math.min(1, (len - deadzone) / (1 - deadzone));
  const nx = rawX / len;
  const ny = rawY / len;
  return {
    x: nx * effective,
    y: ny * effective,
    magnitude: effective,
  };
}

/**
 * Converts 2D analog input (x = right, y = forward) into a world-space XZ direction
 * relative to the camera yaw angle (right-handed Y-up coordinate system).
 * When yaw = 0, camera sits at +Z looking toward -Z.
 */
export function computeCameraRelativeDirection(
  stickX: number,
  stickY: number,
  cameraYaw: number
): Vec3 {
  const norm = normalizeStickInput(stickX, stickY, 0.05);
  if (norm.magnitude === 0) {
    return { x: 0, y: 0, z: 0 };
  }

  const sinYaw = Math.sin(cameraYaw);
  const cosYaw = Math.cos(cameraYaw);

  // Camera forward on XZ is (-sinYaw, -cosYaw); camera right on XZ is (cosYaw, -sinYaw)
  const worldX = norm.x * cosYaw - norm.y * sinYaw;
  const worldZ = -norm.x * sinYaw - norm.y * cosYaw;

  const mag = Math.hypot(worldX, worldZ) || 1;
  return {
    x: (worldX / mag) * norm.magnitude,
    y: 0,
    z: (worldZ / mag) * norm.magnitude,
  };
}

/**
 * Validates whether a physical contact manifold represents a valid supporting ground/platform
 * surface rather than a wall, ceiling, or rapid upward separation right after launch.
 *
 * @param normalIntoBody Unit contact normal pointing from surface into the slime center.
 * @param bodyVelocity Current rigid-body linear velocity.
 * @param minNormalY Minimum Y component (cos(maxSlopeAngle)), default 0.58 (~54 deg).
 * @param maxNormalSeparationSpeed Max upward velocity along normal before contact is separating.
 */
export function isSupportContactValid(
  normalIntoBody: Vec3,
  bodyVelocity: Vec3,
  minNormalY = 0.58,
  maxNormalSeparationSpeed = 1.6
): boolean {
  if (normalIntoBody.y < minNormalY) {
    return false;
  }
  const separationSpeed =
    bodyVelocity.x * normalIntoBody.x +
    bodyVelocity.y * normalIntoBody.y +
    bodyVelocity.z * normalIntoBody.z;
  return separationSpeed <= maxNormalSeparationSpeed;
}

/**
 * Advances the hold-to-charge / release-to-launch state machine.
 * Enforces strict grounded constraint: cannot start, hold, or release a charge in mid-air.
 */
export function stepChargeState(
  prev: ChargeState,
  chargingInput: boolean,
  isGrounded: boolean,
  dt: number,
  chargeRate = 0.95
): ChargeStepResult {
  if (!isGrounded) {
    // Strictly cancel any active charge if slime leaves the ground or is airborne
    return {
      nextState: { isCharging: false, chargeRatio: 0 },
      shouldLaunch: false,
      launchRatio: 0,
    };
  }

  if (chargingInput) {
    const nextRatio = Math.min(1, prev.chargeRatio + Math.max(0, dt) * chargeRate);
    return {
      nextState: { isCharging: true, chargeRatio: nextRatio },
      shouldLaunch: false,
      launchRatio: 0,
    };
  }

  if (prev.isCharging) {
    return {
      nextState: { isCharging: false, chargeRatio: 0 },
      shouldLaunch: true,
      launchRatio: prev.chargeRatio,
    };
  }

  return {
    nextState: { isCharging: false, chargeRatio: 0 },
    shouldLaunch: false,
    launchRatio: 0,
  };
}

/**
 * Computes responsive horizontal ground velocity with weighty acceleration/deceleration
 * while preserving the vertical component from the physics engine.
 */
export function computeGroundedVelocity(
  currentVel: Vec3,
  worldDir: Vec3,
  maxSpeed: number,
  accelRate: number,
  dt: number
): Vec3 {
  const targetX = worldDir.x * maxSpeed;
  const targetZ = worldDir.z * maxSpeed;
  const alpha = 1 - Math.exp(-accelRate * Math.min(dt, 0.05));
  return {
    x: currentVel.x + (targetX - currentVel.x) * alpha,
    y: currentVel.y,
    z: currentVel.z + (targetZ - currentVel.z) * alpha,
  };
}

/**
 * Gently steers horizontal velocity in mid-air without overriding launch momentum
 * or touching vertical gravity velocity.
 */
export function computeAirborneVelocity(
  currentVel: Vec3,
  worldDir: Vec3,
  airMaxSpeed: number,
  airAccel: number,
  dt: number
): Vec3 {
  const mag = Math.hypot(worldDir.x, worldDir.z);
  if (mag < 0.05) {
    return currentVel;
  }
  const safeDt = Math.min(dt, 0.05);
  const desiredX = worldDir.x * airMaxSpeed;
  const desiredZ = worldDir.z * airMaxSpeed;
  const dvX = desiredX - currentVel.x;
  const dvZ = desiredZ - currentVel.z;
  const dvLen = Math.hypot(dvX, dvZ);
  const maxStep = airAccel * safeDt;
  if (dvLen <= maxStep || dvLen === 0) {
    return { x: desiredX, y: currentVel.y, z: desiredZ };
  }
  const scale = maxStep / dvLen;
  return {
    x: currentVel.x + dvX * scale,
    y: currentVel.y,
    z: currentVel.z + dvZ * scale,
  };
}

/**
 * Computes a predictable launch impulse vector given analog direction, camera yaw,
 * and normalized charge ratio [0..1].
 */
export function computeImpulseVector(
  stickX: number,
  stickY: number,
  cameraYaw: number,
  chargeRatio: number,
  maxHorizontalImpulse = 10.5,
  minVerticalImpulse = 6.2,
  maxVerticalImpulse = 13.8
): Vec3 {
  const clampedCharge = Math.max(0.05, Math.min(1, chargeRatio));
  // Smooth ease-out curve gives predictable short taps and strong full charges
  const powerCurve = Math.pow(clampedCharge, 0.85);

  const dir = computeCameraRelativeDirection(stickX, stickY, cameraYaw);
  const hasDir = Math.hypot(dir.x, dir.z) > 0.01;

  // If no stick input, launch straight up with subtle forward hop along camera facing
  const fx = hasDir ? dir.x : -Math.sin(cameraYaw) * 0.25;
  const fz = hasDir ? dir.z : -Math.cos(cameraYaw) * 0.25;

  return {
    x: fx * maxHorizontalImpulse * powerCurve,
    y: minVerticalImpulse + (maxVerticalImpulse - minVerticalImpulse) * powerCurve,
    z: fz * maxHorizontalImpulse * powerCurve,
  };
}

/**
 * Second-order damped spring for volume-preserving gelatinous squash & stretch.
 * Visual deformation stays decoupled from the spherical physics collider.
 */
export function stepSquashSpring(
  state: SquashSpringState,
  targetScaleY: number,
  stiffness: number,
  damping: number,
  dt: number
): SquashSpringState {
  const safeDt = Math.min(dt, 0.05);
  const displacement = targetScaleY - state.scaleY;
  const accel = displacement * stiffness - state.velocityY * damping;
  const nextVel = state.velocityY + accel * safeDt;
  const nextScaleY = Math.max(0.42, Math.min(1.65, state.scaleY + nextVel * safeDt));
  // Volume preservation: V = scaleX * scaleY * scaleZ = 1 => scaleXZ = 1 / sqrt(scaleY)
  const scaleXZ = 1 / Math.sqrt(nextScaleY);
  return {
    scaleY: nextScaleY,
    velocityY: nextVel,
    scaleXZ,
  };
}

/**
 * Computes net upward buoyancy force (N) for optional Stage 0 reference tests.
 */
export function computeBalloonBuoyancyForce(
  altitude: number,
  targetAltitude: number,
  mass: number,
  gravity: number,
  elapsedTime: number
): number {
  const weight = mass * gravity;
  const baseLift = weight * 0.89;
  const floorDeficit = Math.max(0, 0.85 - altitude);
  const floorCushion = floorDeficit * weight * 0.42;
  const altitudeBias = Math.max(-0.15, Math.min(0.15, (targetAltitude - altitude) * 0.04)) * weight;
  const wave = Math.sin(elapsedTime * 2.4) * weight * 0.06;

  return Math.max(0, baseLift + floorCushion + altitudeBias + wave);
}
