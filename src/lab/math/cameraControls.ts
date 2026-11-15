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
 * Computes a predictable launch impulse vector given analog direction, camera yaw,
 * and normalized charge ratio [0..1].
 */
export function computeImpulseVector(
  stickX: number,
  stickY: number,
  cameraYaw: number,
  chargeRatio: number,
  maxHorizontalImpulse = 12,
  minVerticalImpulse = 6.5,
  maxVerticalImpulse = 13.5
): Vec3 {
  const clampedCharge = Math.max(0.15, Math.min(1, chargeRatio));
  // Smooth ease-out curve gives predictable short taps and strong full charges
  const powerCurve = Math.pow(clampedCharge, 0.85);

  const dir = computeCameraRelativeDirection(stickX, stickY, cameraYaw);
  const hasDir = Math.hypot(dir.x, dir.z) > 0.01;

  // If no stick input, launch slightly forward relative to camera facing direction
  const fx = hasDir ? dir.x : -Math.sin(cameraYaw) * 0.45;
  const fz = hasDir ? dir.z : -Math.cos(cameraYaw) * 0.45;

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
 * Computes net upward buoyancy force (N) for the blue balloon baby with weakened buoyancy.
 * Counteracts ~89% of gravity at target hover height, creating gentle downward sink unless nudged,
 * plus a soft ground-cushion spring and subtle sinusoidal float oscillation.
 */
export function computeBalloonBuoyancyForce(
  altitude: number,
  targetAltitude: number,
  mass: number,
  gravity: number,
  elapsedTime: number
): number {
  const weight = mass * gravity;
  // Weakened lift: 89% of weight -> baby slowly descends unless bumped or lifted
  const baseLift = weight * 0.89;
  // Soft low-altitude cushion so baby hovers weakly near floor (~0.75m) rather than gluing to ground
  const floorDeficit = Math.max(0, 0.85 - altitude);
  const floorCushion = floorDeficit * weight * 0.42;
  // Subtle height-band damping near target altitude
  const altitudeBias = Math.max(-0.15, Math.min(0.15, (targetAltitude - altitude) * 0.04)) * weight;
  // Gentle organic bobbing oscillation
  const wave = Math.sin(elapsedTime * 2.4) * weight * 0.06;

  return Math.max(0, baseLift + floorCushion + altitudeBias + wave);
}
