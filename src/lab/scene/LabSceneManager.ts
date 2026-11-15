import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { TestId } from '../i18n/translations';
import {
  computeBalloonImpactImpulse,
  computeWeakenedBalloonForce,
  DEFAULT_BALLOON_PARAMS,
} from '../math/balloonPhysics';
import {
  computeAirborneVelocity,
  computeCameraRelativeDirection,
  computeGroundedVelocity,
  computeImpulseVector,
  normalizeStickInput,
  stepChargeState,
  stepSquashSpring,
  type ChargeState,
  type SquashSpringState,
  type Vec3,
} from '../math/cameraControls';
import {
  createPhysicsWorld,
  type IPhysicsWorld,
  type PhysicsBodyHandle,
  type PhysicsEngineKind,
} from '../physics/PhysicsEngine';
import {
  createArenaFloorTextures,
  createBalloonBabyRig,
  createContactShadowTexture,
  createImpulseArrow,
  createPurpleSlimeRig,
  createRampChevronTexture,
  updateBalloonPopEffect,
  updateBalloonVisuals,
  updateSlimeVisuals,
  type BalloonRig,
  type ImpulseArrowRig,
  type SlimeExpressionState,
  type SlimeRig,
} from './JellyMeshes';
import type { WebAudioSynth } from '../audio/WebAudioSynth';

export type AttemptState = 'playing' | 'popped';

export interface LabTelemetry {
  fps: number;
  frameMs: number;
  physicsMs: number;
  bodyCount: number;
  drawCalls: number;
  triangles: number;
  heapMb: number | null;
  rendererName: string;
  isSoftwareGl: boolean;
  cameraYawDeg: number;
  chargeRatio: number;
  isGrounded: boolean;
  supportNormalY: number;
  slimePos: Vec3;
  slimeVelY: number;
  balloonPos: Vec3;
  balloonVelY: number;
  attemptState: AttemptState;
  popSurfaceId: string | null;
  impulseVec: Vec3;
  gamepadName: string | null;
  engineKind: PhysicsEngineKind;
  rapierReady: boolean;
}

interface DynamicProp {
  body: PhysicsBodyHandle;
  type: 'box' | 'sphere';
}

interface PlatformBoxSpec {
  id: string;
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
  trimColor?: string;
  restitution?: number;
}

const _dummyObj = new THREE.Object3D();
const _targetCamPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();

const FIXED_SUBSTEP_DT = 1 / 60;
const MAX_SUBSTEPS_PER_FRAME = 4;

// Arena surfaces (single source of truth for visuals, colliders, and shadow projection)
const ARENA_PLATFORMS: PlatformBoxSpec[] = [
  { id: 'plat-low', pos: [-4.8, 0.3, -1.5], size: [3.8, 0.6, 3.8], color: '#1e293b', trimColor: '#38bdf8' },
  { id: 'plat-med', pos: [5.5, 0.7, -4.5], size: [4.6, 1.4, 4.6], color: '#273549', trimColor: '#22d3ee' },
  { id: 'plat-high', pos: [0.0, 1.25, -9.2], size: [4.8, 2.5, 3.8], color: '#334155', trimColor: '#a855f7' },
  // Vertical test walls (lateral contact check + fatal balloon wall check)
  { id: 'wall-test-a', pos: [-2.6, 1.3, 1.8], size: [1.1, 2.6, 2.4], color: '#475569', trimColor: '#f59e0b', restitution: 0.2 },
  { id: 'wall-test-b', pos: [2.4, 1.3, -6.5], size: [1.1, 2.6, 2.4], color: '#475569', trimColor: '#f59e0b', restitution: 0.2 },
  // Overhead ceiling test beam above low platform so ceiling collisions can be tested cleanly
  { id: 'ceiling-test', pos: [-4.8, 4.35, -1.5], size: [3.6, 0.34, 2.2], color: '#334155', trimColor: '#fb7185', restitution: 0.15 },
];

// Inclined ramp connecting floor (y=0, z=1.8) up to plat-med front edge (y=1.4, z=-2.2)
const RAMP_RISE = 1.4;
const RAMP_RUN = 4.0;
const RAMP_ANGLE = Math.atan2(RAMP_RISE, RAMP_RUN); // ~19.3 deg
const RAMP_LENGTH = Math.hypot(RAMP_RUN, RAMP_RISE);
const RAMP_THICKNESS = 0.24;
const RAMP_WIDTH = 2.6;
const RAMP_POS: [number, number, number] = [
  5.5,
  RAMP_RISE / 2 - (RAMP_THICKNESS / 2) * Math.cos(RAMP_ANGLE),
  -0.2 - (RAMP_THICKNESS / 2) * Math.sin(RAMP_ANGLE),
];

function detectSoftwareWebGL(): { isSoftware: boolean; rendererLabel: string } {
  if (typeof document === 'undefined') {
    return { isSoftware: false, rendererLabel: 'Unknown' };
  }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) {
    return { isSoftware: true, rendererLabel: 'No WebGL' };
  }
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) || 'WebGL2');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  const isSoftware = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  return { isSoftware, rendererLabel: gpu };
}

export class LabSceneManager {
  private container: HTMLElement;
  private audio: WebAudioSynth;
  private onTelemetry: (t: LabTelemetry) => void;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private rendererLabel: string;

  private shadowTexture: THREE.CanvasTexture;
  private slimeRig: SlimeRig;
  private balloonRig: BalloonRig | null = null;
  private impulseArrow: ImpulseArrowRig;

  private dynamicGroup = new THREE.Group();
  private stressBoxesMesh: THREE.InstancedMesh | null = null;
  private stressSpheresMesh: THREE.InstancedMesh | null = null;
  private stressProps: DynamicProp[] = [];

  private physics: IPhysicsWorld | null = null;
  private slimeBody: PhysicsBodyHandle | null = null;
  private balloonBody: PhysicsBodyHandle | null = null;

  private activeTest: TestId = 'ARENA';
  private engineKind: PhysicsEngineKind = 'rapier';
  private stressCount = 24;
  private rapierReady = false;
  private rebuilding = false;

  // Controls state (no Q/E camera keys; strict pointerId isolation for multitouch)
  private keys = new Set<string>();
  private leftStick = { x: 0, y: 0 };
  private touchCharging = false;
  private keyCharging = false;
  private cameraPointerId: number | null = null;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Camera state
  private cameraYaw = 0.25;
  private cameraPitch = 0.4;
  private cameraDistance = 8.8;
  private smoothedCamPos = new THREE.Vector3(2.0, 4.4, 11.8);
  private smoothedLookTarget = new THREE.Vector3(0, 1.3, 3.2);

  // Slime physics, charge & squash state
  private chargeState: ChargeState = { isCharging: false, chargeRatio: 0 };
  private isGrounded = true;
  private supportNormalY = 1;
  private wasGrounded = true;
  private landingExprTimer = 0;
  private squashState: SquashSpringState = { scaleY: 1, velocityY: 0, scaleXZ: 1 };
  private wobbleEnergy = 0;

  // Balloon Baby state (Stage 2)
  private attemptState: AttemptState = 'playing';
  private popSurfaceId: string | null = null;
  private popElapsed = 0;
  private balloonWobble = 0;
  private balloonBumpCooldown = 0;
  private simTime = 0;
  private physicsAccum = 0;
  private elapsed = 0;

  // Loop & telemetry
  private frameId = 0;
  private disposed = false;
  private lastFrameTs = performance.now();
  private lastTelemetryTs = 0;
  private fpsSamples: number[] = [];
  private currentFrameMs = 16.6;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    audio: WebAudioSynth,
    onTelemetry: (t: LabTelemetry) => void
  ) {
    this.container = container;
    this.audio = audio;
    this.onTelemetry = onTelemetry;

    const probe = detectSoftwareWebGL();
    this.isSoftwareGl = probe.isSoftware;
    this.rendererLabel = probe.rendererLabel;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 1.5)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(240, container.clientHeight);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d1526');
    this.scene.fog = new THREE.FogExp2('#0d1526', 0.017);

    this.camera = new THREE.PerspectiveCamera(54, width / height, 0.1, 140);
    this.camera.position.copy(this.smoothedCamPos);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    this.setupLighting();
    this.setupStaticArenaVisuals();

    this.shadowTexture = createContactShadowTexture();
    this.slimeRig = createPurpleSlimeRig(0.65, this.shadowTexture);
    this.scene.add(this.slimeRig.root);

    this.impulseArrow = createImpulseArrow();
    this.scene.add(this.impulseArrow.group);
    this.scene.add(this.dynamicGroup);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.bindInputEvents();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    void this.rebuildScenario();
    this.lastFrameTs = performance.now();
    this.scheduleNextTick();
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight('#93c5fd', '#1e293b', 0.9);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff4e6', 1.85);
    keyLight.position.set(10, 16, 8);
    keyLight.castShadow = !this.isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 45;
    keyLight.shadow.camera.left = -16;
    keyLight.shadow.camera.right = 16;
    keyLight.shadow.camera.top = 16;
    keyLight.shadow.camera.bottom = -16;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#c084fc', 0.8);
    rimLight.position.set(-12, 8, -10);
    this.scene.add(rimLight);
  }

  private setupStaticArenaVisuals() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const { map, bumpMap } = createArenaFloorTextures(maxAniso);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(36, 1, 36),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map,
        bumpMap,
        bumpScale: 0.02,
        roughness: 0.78,
        metalness: 0.08,
      })
    );
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const skirtGeo = new THREE.RingGeometry(18, 80, 48);
    skirtGeo.rotateX(-Math.PI / 2);
    const skirt = new THREE.Mesh(
      skirtGeo,
      new THREE.MeshStandardMaterial({
        color: '#0f172a',
        roughness: 0.92,
        metalness: 0.05,
      })
    );
    skirt.position.y = -0.06;
    this.scene.add(skirt);

    ARENA_PLATFORMS.forEach((p) => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(...p.size),
        new THREE.MeshStandardMaterial({
          color: p.color,
          roughness: 0.5,
          metalness: 0.18,
        })
      );
      mesh.position.set(...p.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      if (p.trimColor) {
        const trim = new THREE.Mesh(
          new THREE.BoxGeometry(p.size[0] + 0.05, 0.06, p.size[2] + 0.05),
          new THREE.MeshStandardMaterial({
            color: p.trimColor,
            emissive: p.trimColor,
            emissiveIntensity: 0.3,
            roughness: 0.3,
          })
        );
        trim.position.set(p.pos[0], p.pos[1] + p.size[1] / 2 - 0.055, p.pos[2]);
        this.scene.add(trim);
      }
    });

    const rampTex = createRampChevronTexture(maxAniso);
    const rampMesh = new THREE.Mesh(
      new THREE.BoxGeometry(RAMP_WIDTH, RAMP_THICKNESS, RAMP_LENGTH),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: rampTex,
        roughness: 0.55,
        metalness: 0.14,
      })
    );
    rampMesh.position.set(...RAMP_POS);
    rampMesh.rotation.x = RAMP_ANGLE;
    rampMesh.castShadow = true;
    rampMesh.receiveShadow = true;
    this.scene.add(rampMesh);

    const padGeo = new THREE.RingGeometry(1.05, 1.22, 32);
    padGeo.rotateX(-Math.PI / 2);
    const padMat = new THREE.MeshBasicMaterial({
      color: '#a855f7',
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.position.set(0, 0.02, 4.0);
    this.scene.add(pad);

    const pillarMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.75 });
    const capMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      emissive: '#0284c7',
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const dist = 16.5;
      const h = 2.4 + (i % 3) * 1.1;
      const group = new THREE.Group();
      group.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);

      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, h, 8), pillarMat);
      col.position.y = h / 2;
      col.castShadow = true;

      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.36, 0), capMat);
      cap.position.y = h + 0.55;

      group.add(col, cap);
      this.scene.add(group);
    }
  }

  public async setActiveTest(testId: TestId) {
    if (this.activeTest === testId) return;
    this.activeTest = testId;
    await this.rebuildScenario();
  }

  public async setEngineKind(kind: PhysicsEngineKind) {
    if (this.engineKind === kind) return;
    this.engineKind = kind;
    await this.rebuildScenario();
  }

  public async setStressCount(count: number) {
    if (this.stressCount === count) return;
    this.stressCount = count;
    if (this.activeTest === 'STRESS') {
      await this.rebuildScenario();
    }
  }

  public async resetScenario() {
    await this.rebuildScenario();
  }

  public setTouchLeftStick(x: number, y: number) {
    this.leftStick.x = x;
    this.leftStick.y = y;
  }

  public setTouchCharge(charging: boolean) {
    if (charging && !this.touchCharging) {
      void this.audio.unlock();
    }
    this.touchCharging = charging;
  }

  private clearDynamicScenario() {
    if (this.balloonRig) {
      this.dynamicGroup.remove(this.balloonRig.root);
      this.balloonRig.root.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const m = obj as THREE.Mesh;
          m.geometry.dispose();
          if (Array.isArray(m.material)) m.material.forEach((mat) => mat.dispose());
          else m.material.dispose();
        }
      });
      this.balloonRig = null;
    }
    if (this.stressBoxesMesh) {
      this.dynamicGroup.remove(this.stressBoxesMesh);
      this.stressBoxesMesh.geometry.dispose();
      (this.stressBoxesMesh.material as THREE.Material).dispose();
      this.stressBoxesMesh = null;
    }
    if (this.stressSpheresMesh) {
      this.dynamicGroup.remove(this.stressSpheresMesh);
      this.stressSpheresMesh.geometry.dispose();
      (this.stressSpheresMesh.material as THREE.Material).dispose();
      this.stressSpheresMesh = null;
    }
    this.stressProps = [];
    this.balloonBody = null;
    this.slimeBody = null;

    if (this.physics) {
      this.physics.dispose();
      this.physics = null;
    }
  }

  private async rebuildScenario() {
    if (this.rebuilding || this.disposed) return;
    this.rebuilding = true;
    try {
      this.clearDynamicScenario();

      const world = await createPhysicsWorld(this.engineKind);
      if (this.disposed) {
        world.dispose();
        return;
      }
      if (this.engineKind === 'rapier') {
        this.rapierReady = true;
      }
      this.physics = world;

      world.addStaticBox('ground', { x: 0, y: -0.5, z: 0 }, { x: 18, y: 0.5, z: 18 }, 0.08);

      ARENA_PLATFORMS.forEach((p) => {
        world.addStaticBox(
          p.id,
          { x: p.pos[0], y: p.pos[1], z: p.pos[2] },
          { x: p.size[0] / 2, y: p.size[1] / 2, z: p.size[2] / 2 },
          p.restitution ?? 0.08
        );
      });

      world.addStaticBox(
        'ramp-med',
        { x: RAMP_POS[0], y: RAMP_POS[1], z: RAMP_POS[2] },
        { x: RAMP_WIDTH / 2, y: RAMP_THICKNESS / 2, z: RAMP_LENGTH / 2 },
        0.05,
        { x: Math.sin(RAMP_ANGLE / 2), y: 0, z: 0, w: Math.cos(RAMP_ANGLE / 2) }
      );

      world.addStaticBox('wall-n', { x: 0, y: 0.6, z: -17.5 }, { x: 18, y: 0.8, z: 0.5 }, 0.35);
      world.addStaticBox('wall-s', { x: 0, y: 0.6, z: 17.5 }, { x: 18, y: 0.8, z: 0.5 }, 0.35);
      world.addStaticBox('wall-e', { x: 17.5, y: 0.6, z: 0 }, { x: 0.5, y: 0.8, z: 18 }, 0.35);
      world.addStaticBox('wall-w', { x: -17.5, y: 0.6, z: 0 }, { x: 0.5, y: 0.8, z: 18 }, 0.35);

      // Protagonist purple slime (CCD enabled for reliable collision with fast balloon/walls)
      this.slimeBody = world.addDynamicSphere(
        'slime',
        { x: 0, y: 0.65, z: 4.0 },
        0.65,
        1.2,
        {
          restitution: 0.1,
          friction: 0.55,
          linearDamping: 0.18,
          angularDamping: 0.65,
          canSleep: false,
          ccdEnabled: true,
        }
      );

      // Balloon Baby in main Arena mode (Stage 2)
      if (this.activeTest === 'ARENA') {
        this.balloonRig = createBalloonBabyRig(0.5, this.shadowTexture);
        this.dynamicGroup.add(this.balloonRig.root);
        this.balloonBody = world.addDynamicSphere(
          'balloon-baby',
          { x: 0, y: 2.55, z: 1.8 },
          0.5,
          DEFAULT_BALLOON_PARAMS.mass,
          {
            restitution: 0.56,
            friction: 0.12,
            linearDamping: 0.24,
            angularDamping: 0.85,
            canSleep: false,
            ccdEnabled: true,
          }
        );
        // Gentle initial upward lift so player has calm reaction window on spawn
        this.balloonBody.setVelocity({ x: 0, y: 0.35, z: 0 });
        this.balloonRig.root.position.set(0, 2.55, 1.8);
      }

      world.step(FIXED_SUBSTEP_DT);
      const initSupport = world.getSupportContact(this.slimeBody);
      this.isGrounded = initSupport.grounded;
      this.wasGrounded = initSupport.grounded;
      this.supportNormalY = initSupport.normalY;

      this.attemptState = 'playing';
      this.popSurfaceId = null;
      this.popElapsed = 0;
      this.balloonWobble = 0;
      this.balloonBumpCooldown = 0;
      this.simTime = 0;
      this.physicsAccum = 0;

      this.chargeState = { isCharging: false, chargeRatio: 0 };
      this.squashState = { scaleY: 1, velocityY: 0, scaleXZ: 1 };
      this.wobbleEnergy = 0.2;
      this.landingExprTimer = 0;

      if (this.activeTest === 'STRESS') {
        const boxCount = Math.ceil(this.stressCount / 2);
        const sphereCount = Math.floor(this.stressCount / 2);

        const boxGeo = new THREE.BoxGeometry(0.76, 0.76, 0.76);
        const boxMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.32,
          metalness: 0.1,
        });
        this.stressBoxesMesh = new THREE.InstancedMesh(boxGeo, boxMat, boxCount);
        this.stressBoxesMesh.castShadow = !this.isSoftwareGl;
        this.stressBoxesMesh.frustumCulled = false;

        const sphGeo = new THREE.SphereGeometry(0.42, 14, 12);
        const sphMat = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.22,
          metalness: 0.15,
        });
        this.stressSpheresMesh = new THREE.InstancedMesh(sphGeo, sphMat, sphereCount);
        this.stressSpheresMesh.castShadow = !this.isSoftwareGl;
        this.stressSpheresMesh.frustumCulled = false;

        const palette = [
          new THREE.Color('#38bdf8'),
          new THREE.Color('#a855f7'),
          new THREE.Color('#22d3ee'),
          new THREE.Color('#f472b6'),
          new THREE.Color('#34d399'),
        ];

        for (let i = 0; i < boxCount; i++) {
          const angle = (i / Math.max(1, boxCount)) * Math.PI * 2;
          const r = 3.2 + (i % 4) * 1.4;
          const pos = {
            x: Math.cos(angle) * r,
            y: 2.2 + (i % 5) * 0.9,
            z: Math.sin(angle) * r - 2.0,
          };
          const handle = world.addDynamicBox(
            `stress-box-${i}`,
            pos,
            { x: 0.38, y: 0.38, z: 0.38 },
            0.8,
            { restitution: 0.45, linearDamping: 0.15 }
          );
          this.stressProps.push({ body: handle, type: 'box' });
          this.stressBoxesMesh.setColorAt(i, palette[i % palette.length]);
        }
        if (this.stressBoxesMesh.instanceColor) {
          this.stressBoxesMesh.instanceColor.needsUpdate = true;
        }

        for (let i = 0; i < sphereCount; i++) {
          const angle = (i / Math.max(1, sphereCount)) * Math.PI * 2 + 0.35;
          const r = 2.6 + (i % 3) * 1.5;
          const pos = {
            x: Math.cos(angle) * r,
            y: 2.6 + (i % 4) * 0.85,
            z: Math.sin(angle) * r - 2.0,
          };
          const handle = world.addDynamicSphere(
            `stress-sph-${i}`,
            pos,
            0.42,
            0.65,
            { restitution: 0.55, linearDamping: 0.18 }
          );
          this.stressProps.push({ body: handle, type: 'sphere' });
          this.stressSpheresMesh.setColorAt(i, palette[(i + 2) % palette.length]);
        }
        if (this.stressSpheresMesh.instanceColor) {
          this.stressSpheresMesh.instanceColor.needsUpdate = true;
        }

        this.dynamicGroup.add(this.stressBoxesMesh, this.stressSpheresMesh);
      }

      this.cameraYaw = 0.25;
      this.slimeRig.visualGroup.rotation.y = 2.68;
      this.smoothedLookTarget.set(0, 1.3, 3.2);
      this.smoothedCamPos.set(2.0, 4.4, 11.8);
      this.emitTelemetryNow();
    } finally {
      this.rebuilding = false;
    }
  }

  private triggerBalloonPop(surfaceId: string) {
    if (this.attemptState === 'popped') return;
    this.attemptState = 'popped';
    this.popSurfaceId = surfaceId;
    this.popElapsed = 0;
    this.chargeState = { isCharging: false, chargeRatio: 0 };

    if (this.balloonBody) {
      this.balloonBody.setEnabled(false);
    }
    if (this.balloonRig) {
      this.balloonRig.visualGroup.visible = false;
      this.balloonRig.contactShadow.visible = false;
      this.balloonRig.popGroup.visible = true;
      updateBalloonPopEffect(this.balloonRig, 0.01);
    }

    this.audio.playBalloonPop();
    this.emitTelemetryNow();
  }

  private bindInputEvents() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    window.addEventListener('pointercancel', this.onWindowPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    this.keys.add(code);
    if (code === 'Space') {
      e.preventDefault();
      if (this.attemptState === 'playing') {
        if (!this.keyCharging) {
          void this.audio.unlock();
        }
        this.keyCharging = true;
      }
    } else if (
      this.attemptState === 'popped' &&
      (code === 'KeyR' || code === 'Enter')
    ) {
      e.preventDefault();
      void this.resetScenario();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'Space') {
      this.keyCharging = false;
    }
  };

  private onCanvasPointerDown = (e: PointerEvent) => {
    if (this.cameraPointerId !== null) return;
    this.cameraPointerId = e.pointerId;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events
    }
  };

  private onWindowPointerMove = (e: PointerEvent) => {
    if (this.cameraPointerId === null || e.pointerId !== this.cameraPointerId) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.cameraYaw -= dx * 0.007;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.005, 0.16, 1.15);
  };

  private onWindowPointerUp = (e: PointerEvent) => {
    if (this.cameraPointerId === null || e.pointerId !== this.cameraPointerId) return;
    this.cameraPointerId = null;
  };

  private onWheel = (e: WheelEvent) => {
    this.cameraDistance = THREE.MathUtils.clamp(this.cameraDistance + e.deltaY * 0.005, 4.5, 16);
  };

  private handleResize() {
    if (this.disposed) return;
    const w = Math.max(320, this.container.clientWidth);
    const h = Math.max(240, this.container.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private readCombinedInput(): {
    moveX: number;
    moveY: number;
    camX: number;
    camY: number;
    charging: boolean;
    gamepadName: string | null;
  } {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) kx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) kx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) ky += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) ky -= 1;

    let gpName: string | null = null;
    let gpCharging = false;
    let gpMoveX = 0;
    let gpMoveY = 0;
    let gpCamX = 0;
    let gpCamY = 0;

    if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        const gp = pads[i];
        if (gp && gp.connected) {
          gpName = gp.id;
          const ls = normalizeStickInput(gp.axes[0] ?? 0, -(gp.axes[1] ?? 0), 0.15);
          const rs = normalizeStickInput(gp.axes[2] ?? 0, -(gp.axes[3] ?? 0), 0.15);
          gpMoveX = ls.x;
          gpMoveY = ls.y;
          gpCamX = rs.x;
          gpCamY = rs.y;
          gpCharging = Boolean(gp.buttons[0]?.pressed || gp.buttons[7]?.pressed);
          break;
        }
      }
    }

    const combinedMoveX = THREE.MathUtils.clamp(kx + this.leftStick.x + gpMoveX, -1, 1);
    const combinedMoveY = THREE.MathUtils.clamp(ky + this.leftStick.y + gpMoveY, -1, 1);

    return {
      moveX: combinedMoveX,
      moveY: combinedMoveY,
      camX: THREE.MathUtils.clamp(gpCamX, -1, 1),
      camY: THREE.MathUtils.clamp(gpCamY, -1, 1),
      charging: this.keyCharging || this.touchCharging || gpCharging,
      gamepadName: gpName,
    };
  }

  private sampleSurfaceHeightBelow(x: number, objY: number, z: number): number {
    let highest = 0;
    for (let i = 0; i < ARENA_PLATFORMS.length; i++) {
      const p = ARENA_PLATFORMS[i];
      const topY = p.pos[1] + p.size[1] / 2;
      if (topY > objY + 0.05) continue;
      const hx = p.size[0] / 2;
      const hz = p.size[2] / 2;
      if (Math.abs(x - p.pos[0]) <= hx && Math.abs(z - p.pos[2]) <= hz) {
        if (topY > highest) highest = topY;
      }
    }
    if (Math.abs(x - RAMP_POS[0]) <= RAMP_WIDTH / 2 && z >= -2.2 && z <= 1.8) {
      const t = (1.8 - z) / RAMP_RUN;
      const rampY = t * RAMP_RISE;
      if (rampY <= objY + 0.1 && rampY > highest) {
        highest = rampY;
      }
    }
    return highest;
  }

  private stepGameplaySubstep(
    subDt: number,
    input: { moveX: number; moveY: number; charging: boolean },
    worldDir: Vec3
  ) {
    if (!this.physics || !this.slimeBody || this.attemptState !== 'playing') return;

    const preTf = this.slimeBody.getTransform();
    const preSupport = this.physics.getSupportContact(this.slimeBody);
    this.isGrounded = preSupport.grounded;
    this.supportNormalY = preSupport.normalY;

    const curVel = this.slimeBody.getVelocity();
    if (this.isGrounded) {
      const groundMaxSpeed = this.chargeState.isCharging ? 2.4 : 6.4;
      const nextVel = computeGroundedVelocity(curVel, worldDir, groundMaxSpeed, 9.5, subDt);
      this.slimeBody.setVelocity(nextVel);
    } else {
      const nextVel = computeAirborneVelocity(curVel, worldDir, 5.4, 6.2, subDt);
      if (nextVel !== curVel) {
        this.slimeBody.setVelocity(nextVel);
      }
    }

    const chargeRes = stepChargeState(this.chargeState, input.charging, this.isGrounded, subDt, 0.95);
    this.chargeState = chargeRes.nextState;

    if (this.chargeState.isCharging) {
      this.audio.playChargeTick(this.chargeState.chargeRatio);
    } else if (chargeRes.shouldLaunch) {
      const launch = computeImpulseVector(
        input.moveX,
        input.moveY,
        this.cameraYaw,
        chargeRes.launchRatio
      );
      this.slimeBody.applyImpulse(launch);
      this.squashState.scaleY = 1.42;
      this.squashState.velocityY = 2.6;
      this.wobbleEnergy = 1.0;
      this.audio.playLaunch(chargeRes.launchRatio);
      this.isGrounded = false;
      this.wasGrounded = false;
    }

    // Apply weakened buoyancy + gentle air cushion to Balloon Baby
    this.simTime += subDt;
    if (this.balloonBody) {
      const bVel = this.balloonBody.getVelocity();
      const lift = computeWeakenedBalloonForce(bVel.y, this.simTime);
      this.balloonBody.applyForce({ x: 0, y: lift, z: 0 });
    }

    this.physics.step(subDt);

    if (this.balloonBumpCooldown > 0) {
      this.balloonBumpCooldown = Math.max(0, this.balloonBumpCooldown - subDt);
    }

    // Balloon collision check immediately after every fixed substep (anti-tunneling & zero safety margin)
    if (this.balloonBody) {
      const bCol = this.physics.getBodyCollisions(this.balloonBody, ['slime']);
      if (bCol.hitSurfaceId !== null) {
        this.triggerBalloonPop(bCol.hitSurfaceId);
        return;
      }

      if (bCol.hitBodyIds.includes('slime') && this.balloonBumpCooldown <= 0) {
        const sTf = this.slimeBody.getTransform();
        const bTf = this.balloonBody.getTransform();
        const impactImpulse = computeBalloonImpactImpulse(
          sTf.position,
          sTf.velocity,
          bTf.position,
          bTf.velocity,
          DEFAULT_BALLOON_PARAMS.mass
        );
        if (impactImpulse) {
          this.balloonBody.applyImpulse(impactImpulse);
          this.balloonBumpCooldown = 0.14;
          this.balloonWobble = 1.0;
          this.wobbleEnergy = Math.max(this.wobbleEnergy, 0.78);
          this.audio.playBalloonChime();
        }
      }

      // Safety out-of-bounds surface check
      const bPos = this.balloonBody.getTransform().position;
      if (bPos.y < -2) {
        this.triggerBalloonPop('out-of-bounds');
        return;
      }
    }

    // Slime landing feedback
    const nextSlime = this.slimeBody.getTransform();
    const postSupport = this.physics.getSupportContact(this.slimeBody);
    this.isGrounded = postSupport.grounded;
    this.supportNormalY = postSupport.normalY;

    if (!this.wasGrounded && postSupport.grounded && preTf.velocity.y < -2.2) {
      const impact = Math.min(1, Math.abs(preTf.velocity.y) / 11);
      this.squashState.scaleY = Math.max(0.54, 1 - impact * 0.44);
      this.squashState.velocityY = -impact * 4.8;
      this.wobbleEnergy = Math.min(1.2, this.wobbleEnergy + impact * 0.95);
      this.landingExprTimer = 0.2;
      this.audio.playBounce(impact);
    }
    this.wasGrounded = postSupport.grounded;

    if (nextSlime.position.y < -4) {
      this.slimeBody.setPosition({ x: 0, y: 1.5, z: 4.0 });
    }
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastFrameTs) / 1000;
    this.lastFrameTs = now;
    const dt = Math.min(0.065, Math.max(0.001, rawDt));
    this.elapsed += dt;

    const input = this.readCombinedInput();

    // Independent camera rotation remains active even after pop so player can inspect what hit
    this.cameraYaw -= input.camX * dt * 2.3;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch - input.camY * dt * 1.4, 0.16, 1.15);

    const worldDir = computeCameraRelativeDirection(input.moveX, input.moveY, this.cameraYaw);
    const moveMag = Math.hypot(worldDir.x, worldDir.z);

    if (this.physics && this.slimeBody) {
      if (this.attemptState === 'playing') {
        this.physicsAccum = Math.min(this.physicsAccum + dt, FIXED_SUBSTEP_DT * MAX_SUBSTEPS_PER_FRAME);
        let steps = 0;
        while (
          this.physicsAccum >= FIXED_SUBSTEP_DT &&
          steps < MAX_SUBSTEPS_PER_FRAME &&
          this.attemptState === 'playing'
        ) {
          this.stepGameplaySubstep(FIXED_SUBSTEP_DT, input, worldDir);
          this.physicsAccum -= FIXED_SUBSTEP_DT;
          steps++;
        }
        // Ensure at least one step runs on slow software WebGL frames
        if (steps === 0 && this.attemptState === 'playing') {
          this.stepGameplaySubstep(Math.min(dt, FIXED_SUBSTEP_DT), input, worldDir);
          this.physicsAccum = 0;
        }
      } else {
        this.popElapsed += dt;
        if (this.balloonRig) {
          updateBalloonPopEffect(this.balloonRig, this.popElapsed);
        }
      }

      if (this.landingExprTimer > 0) {
        this.landingExprTimer = Math.max(0, this.landingExprTimer - dt);
      }

      const nextSlime = this.slimeBody.getTransform();

      // Decoupled visual squash-stretch spring
      const targetScaleY =
        this.attemptState === 'playing' && this.chargeState.isCharging
          ? 1 - this.chargeState.chargeRatio * 0.45
          : !this.isGrounded && nextSlime.velocity.y > 1.5
            ? 1.12
            : 1.0;
      this.squashState = stepSquashSpring(this.squashState, targetScaleY, 240, 14, dt);
      this.wobbleEnergy = Math.max(0, this.wobbleEnergy - dt * 1.35);
      this.balloonWobble = Math.max(0, this.balloonWobble - dt * 1.6);

      const r = this.slimeRig.radius;
      this.slimeRig.root.position.set(
        nextSlime.position.x,
        nextSlime.position.y,
        nextSlime.position.z
      );
      this.slimeRig.visualGroup.scale.set(
        this.squashState.scaleXZ,
        this.squashState.scaleY,
        this.squashState.scaleXZ
      );
      this.slimeRig.visualGroup.position.y = -r * (1 - this.squashState.scaleY);

      if (this.attemptState === 'playing' && moveMag > 0.08) {
        const targetFaceYaw = Math.atan2(-worldDir.x, -worldDir.z);
        const curY = this.slimeRig.visualGroup.rotation.y;
        let diff = targetFaceYaw - curY;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.slimeRig.visualGroup.rotation.y += diff * (1 - Math.exp(-11 * dt));
      }

      const expr: SlimeExpressionState =
        this.landingExprTimer > 0
          ? 'landing'
          : !this.isGrounded
            ? 'airborne'
            : this.chargeState.isCharging
              ? 'charging'
              : moveMag > 0.08
                ? 'moving'
                : 'idle';
      updateSlimeVisuals(this.slimeRig, expr, this.chargeState.chargeRatio, this.elapsed, dt);

      const surfY = this.sampleSurfaceHeightBelow(nextSlime.position.x, nextSlime.position.y, nextSlime.position.z);
      const heightAboveSurf = Math.max(0, nextSlime.position.y - r - surfY);
      this.slimeRig.contactShadow.position.y = surfY - nextSlime.position.y + 0.025;
      const shadowScale = Math.max(0.45, 1 - heightAboveSurf * 0.13);
      this.slimeRig.contactShadow.scale.setScalar(shadowScale);

      this.slimeRig.shaderUniforms.uTime.value = this.elapsed;
      this.slimeRig.shaderUniforms.uWobble.value = this.wobbleEnergy;
      this.slimeRig.shaderUniforms.uCharge.value = this.chargeState.chargeRatio;

      // Update Balloon Baby visual rig
      if (this.balloonRig && this.balloonBody && this.attemptState === 'playing') {
        const bTf = this.balloonBody.getTransform();
        this.balloonRig.root.position.set(bTf.position.x, bTf.position.y, bTf.position.z);
        updateBalloonVisuals(this.balloonRig, bTf.velocity, this.balloonWobble, this.elapsed, dt);
        const bSurfY = this.sampleSurfaceHeightBelow(bTf.position.x, bTf.position.y, bTf.position.z);
        const bHeight = Math.max(0, bTf.position.y - this.balloonRig.radius - bSurfY);
        this.balloonRig.contactShadow.position.y = bSurfY - bTf.position.y + 0.025;
        this.balloonRig.contactShadow.scale.setScalar(Math.max(0.32, 1 - bHeight * 0.11));
      }

      // 3D launch direction arrow (grounded only; no aiming reticle for balloon)
      const impulsePreview = computeImpulseVector(
        input.moveX,
        input.moveY,
        this.cameraYaw,
        Math.max(0.25, this.chargeState.chargeRatio)
      );
      const showArrow =
        this.attemptState === 'playing' &&
        this.isGrounded &&
        (this.chargeState.isCharging || moveMag > 0.15);
      this.impulseArrow.group.visible = showArrow;
      if (showArrow) {
        this.impulseArrow.group.position.set(
          nextSlime.position.x,
          nextSlime.position.y - r + 0.06,
          nextSlime.position.z
        );
        const arrowYaw = Math.atan2(impulsePreview.x, impulsePreview.z);
        this.impulseArrow.group.rotation.y = arrowYaw;
        const horizLen = Math.hypot(impulsePreview.x, impulsePreview.z) * 0.24;
        const shaftLen = Math.max(1.35, horizLen);
        this.impulseArrow.shaft.scale.set(1, 1, shaftLen);
        this.impulseArrow.head.position.set(0, 0, shaftLen + 0.16);
        this.impulseArrow.ring.scale.setScalar(1 + this.chargeState.chargeRatio * 0.35);
      }

      // Stress instanced meshes
      if (this.activeTest === 'STRESS' && this.stressBoxesMesh && this.stressSpheresMesh) {
        let boxIdx = 0;
        let sphIdx = 0;
        for (let i = 0; i < this.stressProps.length; i++) {
          const prop = this.stressProps[i];
          const tf = prop.body.getTransform();
          _dummyObj.position.set(tf.position.x, tf.position.y, tf.position.z);
          _dummyObj.quaternion.set(
            tf.quaternion.x,
            tf.quaternion.y,
            tf.quaternion.z,
            tf.quaternion.w
          );
          _dummyObj.scale.set(1, 1, 1);
          _dummyObj.updateMatrix();
          if (prop.type === 'box') {
            this.stressBoxesMesh.setMatrixAt(boxIdx++, _dummyObj.matrix);
          } else {
            this.stressSpheresMesh.setMatrixAt(sphIdx++, _dummyObj.matrix);
          }
        }
        this.stressBoxesMesh.instanceMatrix.needsUpdate = true;
        this.stressSpheresMesh.instanceMatrix.needsUpdate = true;
      }

      // Smooth third-person camera follow
      _targetLook.set(
        nextSlime.position.x,
        nextSlime.position.y + 0.65,
        nextSlime.position.z
      );
      const horizDist = Math.cos(this.cameraPitch) * this.cameraDistance;
      const vertDist = Math.sin(this.cameraPitch) * this.cameraDistance;
      _targetCamPos.set(
        _targetLook.x + Math.sin(this.cameraYaw) * horizDist,
        _targetLook.y + vertDist,
        _targetLook.z + Math.cos(this.cameraYaw) * horizDist
      );

      const camFollow = 1 - Math.exp(-9 * dt);
      this.smoothedLookTarget.lerp(_targetLook, camFollow);
      this.smoothedCamPos.lerp(_targetCamPos, camFollow);
      this.camera.position.copy(this.smoothedCamPos);
      this.camera.lookAt(this.smoothedLookTarget);
    }

    this.renderer.render(this.scene, this.camera);
    this.currentFrameMs = this.currentFrameMs * 0.85 + dt * 1000 * 0.15;
    if (rawDt > 0 && rawDt < 0.8) {
      this.fpsSamples.push(1 / rawDt);
      if (this.fpsSamples.length > 20) this.fpsSamples.shift();
    }

    if (now - this.lastTelemetryTs > 165) {
      this.lastTelemetryTs = now;
      this.emitTelemetryNow(input);
    }

    this.scheduleNextTick();
  };

  private emitTelemetryNow(input?: { moveX: number; moveY: number; gamepadName: string | null }) {
    const avgFps =
      this.fpsSamples.length > 0
        ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
        : 0;
    const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const heapMb = perfMem ? perfMem.usedJSHeapSize / (1024 * 1024) : null;
    const slimeTf = this.slimeBody?.getTransform();
    const balloonTf = this.balloonBody?.getTransform();
    const deg = (((this.cameraYaw * 180) / Math.PI) % 360 + 360) % 360;

    const impulsePreview = computeImpulseVector(
      input?.moveX ?? 0,
      input?.moveY ?? 0,
      this.cameraYaw,
      Math.max(0.25, this.chargeState.chargeRatio)
    );

    this.onTelemetry({
      fps: Math.round(avgFps),
      frameMs: Number(this.currentFrameMs.toFixed(1)),
      physicsMs: Number((this.physics?.lastStepMs ?? 0).toFixed(2)),
      bodyCount: this.physics?.bodyCount() ?? 0,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      heapMb: heapMb !== null ? Number(heapMb.toFixed(1)) : null,
      rendererName: this.rendererLabel,
      isSoftwareGl: this.isSoftwareGl,
      cameraYawDeg: Math.round(deg),
      chargeRatio: Number(this.chargeState.chargeRatio.toFixed(2)),
      isGrounded: this.isGrounded,
      supportNormalY: Number(this.supportNormalY.toFixed(2)),
      slimePos: slimeTf
        ? {
            x: Number(slimeTf.position.x.toFixed(2)),
            y: Number(slimeTf.position.y.toFixed(2)),
            z: Number(slimeTf.position.z.toFixed(2)),
          }
        : { x: 0, y: 0.65, z: 4.0 },
      slimeVelY: slimeTf ? Number(slimeTf.velocity.y.toFixed(2)) : 0,
      balloonPos: balloonTf
        ? {
            x: Number(balloonTf.position.x.toFixed(2)),
            y: Number(balloonTf.position.y.toFixed(2)),
            z: Number(balloonTf.position.z.toFixed(2)),
          }
        : { x: 0, y: 2.55, z: 1.8 },
      balloonVelY: balloonTf ? Number(balloonTf.velocity.y.toFixed(2)) : 0,
      attemptState: this.attemptState,
      popSurfaceId: this.popSurfaceId,
      impulseVec: impulsePreview,
      gamepadName: input?.gamepadName ?? null,
      engineKind: this.engineKind,
      rapierReady: this.rapierReady,
    });
  }

  private scheduleNextTick() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (state === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.renderer.domElement.removeEventListener('pointerdown', this.onCanvasPointerDown);
    window.removeEventListener('pointermove', this.onWindowPointerMove);
    window.removeEventListener('pointerup', this.onWindowPointerUp);
    window.removeEventListener('pointercancel', this.onWindowPointerUp);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);

    this.clearDynamicScenario();
    this.shadowTexture.dispose();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
