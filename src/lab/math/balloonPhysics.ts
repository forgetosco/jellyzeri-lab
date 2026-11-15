import type { Vec3 } from './cameraControls';

export interface BalloonBuoyancyParams {
  mass: number;
  gravity: number;
  buoyancyRatio: number; // < 1.0 so balloon gently sinks
  oscillationRatio: number; // subtle deterministic vertical bob amplitude
  oscillationFreq: number; // rad/s
  verticalAirDrag: number; // N / (m/s) air cushion opposing vertical velocity
}

export const DEFAULT_BALLOON_PARAMS: BalloonBuoyancyParams = {
  mass: 0.48,
  gravity: 9.81,
  buoyancyRatio: 0.875,
  oscillationRatio: 0.045,
  oscillationFreq: 2.1,
  verticalAirDrag: 0.48,
};

/**
 * Computes net upward external force (N) applied to the weakened Balloon Baby.
 * Physics world already applies downward gravity (-mass * gravity).
 * Because buoyancyRatio < 1.0, average net acceleration is downward (gentle sink),
 * while vertical air drag keeps fall speed slow, floaty, and readable.
 */
export function computeWeakenedBalloonForce(
  verticalVelocity: number,
  elapsedTime: number,
  params: BalloonBuoyancyParams = DEFAULT_BALLOON_PARAMS
): number {
  const weight = params.mass * params.gravity;
  const baseLift = weight * params.buoyancyRatio;
  const bobWave = Math.sin(elapsedTime * params.oscillationFreq) * weight * params.oscillationRatio;
  const airCushion = -verticalVelocity * params.verticalAirDrag;
  return Math.max(0, baseLift + bobWave + airCushion);
}

/**
 * Computes deterministic, skill-based impulse transfer from Jellyzerī to the Balloon Baby
 * along the true 3D contact normal (slime -> balloon) with NO auto-aim assistance.
 *
 * Returns null if bodies are separating or closing speed is negligible.
 */
export function computeBalloonImpactImpulse(
  slimePos: Vec3,
  slimeVel: Vec3,
  balloonPos: Vec3,
  balloonVel: Vec3,
  balloonMass = DEFAULT_BALLOON_PARAMS.mass,
  restitutionBoost = 1.78,
  minLaunchSpeed = 3.6,
  maxLaunchSpeed = 12.0
): Vec3 | null {
  const dx = balloonPos.x - slimePos.x;
  const dy = balloonPos.y - slimePos.y;
  const dz = balloonPos.z - slimePos.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1e-4) {
    return null;
  }

  const nx = dx / dist;
  const ny = dy / dist;
  const nz = dz / dist;

  const relVx = slimeVel.x - balloonVel.x;
  const relVy = slimeVel.y - balloonVel.y;
  const relVz = slimeVel.z - balloonVel.z;

  // Closing speed along contact normal
  const closingSpeed = relVx * nx + relVy * ny + relVz * nz;
  if (closingSpeed <= 0.15) {
    return null;
  }

  // Tangential carry from slime movement (allows angled steering/curving by movement)
  const slimeProj = slimeVel.x * nx + slimeVel.y * ny + slimeVel.z * nz;
  const tanVx = slimeVel.x - slimeProj * nx;
  const tanVz = slimeVel.z - slimeProj * nz;

  const targetNormalSpeed = Math.max(
    minLaunchSpeed,
    Math.min(maxLaunchSpeed, closingSpeed * restitutionBoost)
  );

  // Desired post-impact velocity along contact normal + subtle tangential momentum transfer
  const desiredVx = nx * targetNormalSpeed + tanVx * 0.42;
  const desiredVy = ny * targetNormalSpeed + Math.max(0, slimeVel.y) * 0.28;
  const desiredVz = nz * targetNormalSpeed + tanVz * 0.42;

  return {
    x: (desiredVx - balloonVel.x) * balloonMass,
    y: (desiredVy - balloonVel.y) * balloonMass,
    z: (desiredVz - balloonVel.z) * balloonMass,
  };
}
