import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { TestId } from '../i18n/translations';
import {
  computeBalloonBuoyancyForce,
  computeCameraRelativeDirection,
  computeImpulseVector,
  normalizeStickInput,
  stepSquashSpring,
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
  createMotherBeacon,
  createPurpleSlimeRig,
  type BalloonRig,
  type ImpulseArrowRig,
  type SlimeRig,
} from './JellyMeshes';
import type { WebAudioSynth } from '../audio/WebAudioSynth';

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
  impulseVec: Vec3;
  gamepadName: string | null;
  balloonAltitude: number;
  balloonInGoal: boolean;
  engineKind: PhysicsEngineKind;
  rapierReady: boolean;
}

interface DynamicProp {
  body: PhysicsBodyHandle;
  type: 'box' | 'sphere';
}

const _dummyObj = new THREE.Object3D();
const _tempVec = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();
const _targetLook = new THREE.Vector3();

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
  private motherBeacon: THREE.Group | null = null;
  private impulseArrow: ImpulseArrowRig;

  private dynamicGroup = new THREE.Group();
  private stressBoxesMesh: THREE.InstancedMesh | null = null;
  private stressSpheresMesh: THREE.InstancedMesh | null = null;
  private stressProps: DynamicProp[] = [];
  private bumperMeshes: THREE.Mesh[] = [];

  private physics: IPhysicsWorld | null = null;
  private slimeBody: PhysicsBodyHandle | null = null;
  private balloonBody: PhysicsBodyHandle | null = null;

  private activeTest: TestId = 'A';
  private engineKind: PhysicsEngineKind = 'cannon';
  private stressCount = 24;
  private rapierReady = false;
  private rebuilding = false;

  // Controls state
  private keys = new Set<string>();
  private leftStick = { x: 0, y: 0 };
  private rightStick = { x: 0, y: 0 };
  private touchCharging = false;
  private keyCharging = false;
  private isDraggingCamera = false;
  private lastPointerX = 0;
  private lastPointerY = 0;

  // Camera state
  private cameraYaw = 0;
  private cameraPitch = 0.42;
  private cameraDistance = 8.5;
  private smoothedCamPos = new THREE.Vector3(0, 4.5, 8.5);
  private smoothedLookTarget = new THREE.Vector3(0, 0.8, 0);

  // Slime charge & squash state
  private chargeRatio = 0;
  private wasCharging = false;
  private prevSlimeVelY = 0;
  private squashState: SquashSpringState = { scaleY: 1, velocityY: 0, scaleXZ: 1 };
  private wobbleEnergy = 0;
  private elapsed = 0;
  private lastBalloonChimeTime = -10;

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
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
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
    this.scene.fog = new THREE.FogExp2('#0d1526', 0.018);

    this.camera = new THREE.PerspectiveCamera(54, width / height, 0.1, 140);
    this.camera.position.copy(this.smoothedCamPos);

    // Studio environment reflection (works on both GPU and software WebGL)
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

    // Initialize initial scene
    void this.rebuildScenario();
    this.lastFrameTs = performance.now();
    this.scheduleNextTick();
  }

  private setupLighting() {
    const hemi = new THREE.HemisphereLight('#93c5fd', '#1e293b', 0.85);
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

    const rimLight = new THREE.DirectionalLight('#38bdf8', 0.75);
    rimLight.position.set(-12, 8, -10);
    this.scene.add(rimLight);
  }

  private setupStaticArenaVisuals() {
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const { map, bumpMap } = createArenaFloorTextures(maxAniso);

    // Extended terrain base
    const groundGeo = new THREE.BoxGeometry(36, 1, 36);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map,
      bumpMap,
      bumpScale: 0.02,
      roughness: 0.78,
      metalness: 0.08,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Horizon skirt extending outward so scene never looks like a floating void box
    const skirtGeo = new THREE.RingGeometry(18, 80, 48);
    skirtGeo.rotateX(-Math.PI / 2);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: '#0f172a',
      roughness: 0.92,
      metalness: 0.05,
    });
    const skirt = new THREE.Mesh(skirtGeo, skirtMat);
    skirt.position.y = -0.06;
    this.scene.add(skirt);

    // Testing platforms (stepped heights for jumping & balloon delivery)
    const platMatA = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.55,
      metalness: 0.18,
    });
    const platMatB = new THREE.MeshStandardMaterial({
      color: '#334155',
      roughness: 0.42,
      metalness: 0.25,
    });

    const platforms: { pos: [number, number, number]; size: [number, number, number]; mat: THREE.Material }[] = [
      { pos: [-5.5, 0.45, -3.5], size: [4.2, 0.9, 4.2], mat: platMatA },
      { pos: [6.0, 0.85, -4.5], size: [5.0, 1.7, 5.0], mat: platMatB },
      { pos: [0.0, 0.35, -8.5], size: [5.4, 0.7, 3.6], mat: platMatA },
    ];

    platforms.forEach((p) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...p.size), p.mat);
      mesh.position.set(...p.pos);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);

      // Clean trim rim positioned cleanly below platform top face (no coplanar Z-fighting)
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(p.size[0] + 0.06, 0.06, p.size[2] + 0.06),
        new THREE.MeshStandardMaterial({ color: '#0ea5e9', roughness: 0.3, emissive: '#0369a1', emissiveIntensity: 0.35 })
      );
      trim.position.set(p.pos[0], p.pos[1] + p.size[1] / 2 - 0.055, p.pos[2]);
      this.scene.add(trim);
    });

    // Natural perimeter pillars (distant landmarks for camera orientation)
    const pillarMat = new THREE.MeshStandardMaterial({ color: '#1e293b', roughness: 0.75 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', emissive: '#0284c7', emissiveIntensity: 0.5, roughness: 0.3 });
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
    if (this.activeTest === 'E') {
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

  public setTouchRightStick(x: number, y: number) {
    this.rightStick.x = x;
    this.rightStick.y = y;
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
      this.balloonRig = null;
    }
    if (this.motherBeacon) {
      this.dynamicGroup.remove(this.motherBeacon);
      this.motherBeacon = null;
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
    for (const m of this.bumperMeshes) {
      this.dynamicGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.bumperMeshes = [];
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

      // Static arena colliders matching visual platforms
      world.addStaticBox('ground', { x: 0, y: -0.5, z: 0 }, { x: 18, y: 0.5, z: 18 }, 0.3);
      world.addStaticBox('plat-left', { x: -5.5, y: 0.45, z: -3.5 }, { x: 2.1, y: 0.45, z: 2.1 }, 0.3);
      world.addStaticBox('plat-right', { x: 6.0, y: 0.85, z: -4.5 }, { x: 2.5, y: 0.85, z: 2.5 }, 0.3);
      world.addStaticBox('plat-back', { x: 0.0, y: 0.35, z: -8.5 }, { x: 2.7, y: 0.35, z: 1.8 }, 0.3);

      // Low perimeter curbs so objects stay in the arena
      world.addStaticBox('wall-n', { x: 0, y: 0.6, z: -17.5 }, { x: 18, y: 0.8, z: 0.5 }, 0.5);
      world.addStaticBox('wall-s', { x: 0, y: 0.6, z: 17.5 }, { x: 18, y: 0.8, z: 0.5 }, 0.5);
      world.addStaticBox('wall-e', { x: 17.5, y: 0.6, z: 0 }, { x: 0.5, y: 0.8, z: 18 }, 0.5);
      world.addStaticBox('wall-w', { x: -17.5, y: 0.6, z: 0 }, { x: 0.5, y: 0.8, z: 18 }, 0.5);

      // Protagonist purple slime (starts grounded on floor)
      this.slimeBody = world.addDynamicSphere(
        'slime',
        { x: 0, y: 0.65, z: 3.2 },
        0.65,
        1.2,
        { restitution: 0.45, friction: 0.4, linearDamping: 0.25, angularDamping: 0.65 }
      );
      this.squashState = { scaleY: 1, velocityY: 0, scaleXZ: 1 };
      this.chargeRatio = 0;
      this.wobbleEnergy = 0.25;
      this.prevSlimeVelY = 0;

      // Test-specific objects
      if (this.activeTest === 'B') {
        // Elastic bumper blocks to test collision squash & bounce
        const bumperPositions: [number, number, number][] = [
          [-2.2, 0.7, -0.8],
          [2.2, 0.7, -0.8],
          [0, 0.7, -3.6],
        ];
        const bGeo = new THREE.BoxGeometry(1.4, 1.4, 1.4);
        const bMat = new THREE.MeshStandardMaterial({
          color: '#f59e0b',
          roughness: 0.25,
          metalness: 0.15,
        });
        bumperPositions.forEach((p, idx) => {
          world.addStaticBox(`bumper-${idx}`, { x: p[0], y: p[1], z: p[2] }, { x: 0.7, y: 0.7, z: 0.7 }, 0.85);
          const m = new THREE.Mesh(bGeo, bMat);
          m.position.set(...p);
          m.castShadow = true;
          m.receiveShadow = true;
          this.dynamicGroup.add(m);
          this.bumperMeshes.push(m);
        });
      }

      if (this.activeTest === 'C') {
        this.balloonRig = createBalloonBabyRig(0.52, this.shadowTexture);
        this.dynamicGroup.add(this.balloonRig.root);
        this.balloonBody = world.addDynamicSphere(
          'balloon-baby',
          { x: 0, y: 1.6, z: -0.5 },
          0.52,
          0.55,
          { restitution: 0.62, friction: 0.2, linearDamping: 0.65, angularDamping: 0.8 }
        );

        this.motherBeacon = createMotherBeacon();
        this.motherBeacon.position.set(6.0, 1.7, -4.5);
        this.dynamicGroup.add(this.motherBeacon);
      }

      if (this.activeTest === 'E') {
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
            y: 1.5 + (i % 5) * 0.9,
            z: Math.sin(angle) * r - 1.5,
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
            y: 2.0 + (i % 4) * 0.85,
            z: Math.sin(angle) * r - 1.5,
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

      // Snap camera smoothly at slight 3/4 angle so slime face & depth read cleanly
      this.cameraYaw = 0.28;
      this.smoothedLookTarget.set(0, 0.8, 3.2);
      this.smoothedCamPos.set(2.2, 4.3, 10.9);
    } finally {
      this.rebuilding = false;
    }
  }

  private bindInputEvents() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: true });
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const code = e.code;
    this.keys.add(code);
    if (code === 'Space') {
      e.preventDefault();
      if (!this.keyCharging) {
        void this.audio.unlock();
      }
      this.keyCharging = true;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'Space') {
      this.keyCharging = false;
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    this.isDraggingCamera = true;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.isDraggingCamera) return;
    const dx = e.clientX - this.lastPointerX;
    const dy = e.clientY - this.lastPointerY;
    this.lastPointerX = e.clientX;
    this.lastPointerY = e.clientY;
    this.cameraYaw -= dx * 0.007;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch + dy * 0.005, 0.16, 1.15);
  };

  private onPointerUp = () => {
    this.isDraggingCamera = false;
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

    let camX = 0;
    if (this.keys.has('KeyQ')) camX -= 1;
    if (this.keys.has('KeyE')) camX += 1;

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
    const combinedCamX = THREE.MathUtils.clamp(camX + this.rightStick.x + gpCamX, -1, 1);
    const combinedCamY = THREE.MathUtils.clamp(this.rightStick.y + gpCamY, -1, 1);

    return {
      moveX: combinedMoveX,
      moveY: combinedMoveY,
      camX: combinedCamX,
      camY: combinedCamY,
      charging: this.keyCharging || this.touchCharging || gpCharging,
      gamepadName: gpName,
    };
  }

  private tick = () => {
    if (this.disposed) return;

    const now = performance.now();
    const rawDt = (now - this.lastFrameTs) / 1000;
    this.lastFrameTs = now;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this.elapsed += dt;

    const input = this.readCombinedInput();

    // Independent camera rotation
    this.cameraYaw -= input.camX * dt * 2.3;
    this.cameraPitch = THREE.MathUtils.clamp(this.cameraPitch - input.camY * dt * 1.4, 0.16, 1.15);

    const worldDir = computeCameraRelativeDirection(input.moveX, input.moveY, this.cameraYaw);
    const impulsePreview = computeImpulseVector(
      input.moveX,
      input.moveY,
      this.cameraYaw,
      Math.max(0.25, this.chargeRatio)
    );

    if (this.physics && this.slimeBody) {
      const slimeTf = this.slimeBody.getTransform();

      // Ground movement force/velocity blending
      const moveSpeed = input.charging ? 3.2 : 6.4;
      const moveMag = Math.hypot(worldDir.x, worldDir.z);
      if (moveMag > 0.05) {
        const curVel = this.slimeBody.getVelocity();
        const blend = 1 - Math.exp(-8 * dt);
        this.slimeBody.setVelocity({
          x: THREE.MathUtils.lerp(curVel.x, worldDir.x * moveSpeed, blend),
          y: curVel.y,
          z: THREE.MathUtils.lerp(curVel.z, worldDir.z * moveSpeed, blend),
        });
      }

      // Charge & impulse launch
      if (input.charging) {
        this.chargeRatio = Math.min(1, this.chargeRatio + dt * 1.15);
        this.audio.playChargeTick(this.chargeRatio);
      } else if (this.wasCharging) {
        const launch = computeImpulseVector(input.moveX, input.moveY, this.cameraYaw, this.chargeRatio);
        this.slimeBody.applyImpulse(launch);
        this.squashState.scaleY = 1.42;
        this.squashState.velocityY = 2.4;
        this.wobbleEnergy = 1.0;
        this.audio.playLaunch(this.chargeRatio);
        this.chargeRatio = 0;
      }
      this.wasCharging = input.charging;

      // Balloon baby weakened buoyancy + gentle air drag
      if (this.balloonBody) {
        const bTf = this.balloonBody.getTransform();
        const lift = computeBalloonBuoyancyForce(
          bTf.position.y,
          2.6,
          0.55,
          this.physics.gravity,
          this.elapsed
        );
        this.balloonBody.applyForce({ x: 0, y: lift, z: 0 });

        // Detect playful slime-balloon bump for tactile audio feedback
        const dist = Math.hypot(
          slimeTf.position.x - bTf.position.x,
          slimeTf.position.y - bTf.position.y,
          slimeTf.position.z - bTf.position.z
        );
        if (dist < 1.25 && this.elapsed - this.lastBalloonChimeTime > 0.6) {
          this.lastBalloonChimeTime = this.elapsed;
          this.audio.playBalloonChime();
          this.wobbleEnergy = Math.max(this.wobbleEnergy, 0.7);
        }
      }

      this.physics.step(dt);

      // Post-step slime transform & landing impact detection
      const nextSlime = this.slimeBody.getTransform();
      const velDeltaY = nextSlime.velocity.y - this.prevSlimeVelY;
      if (velDeltaY > 3.2 && nextSlime.position.y < 3.5) {
        const impact = Math.min(1, velDeltaY / 10);
        this.squashState.scaleY = Math.max(0.55, 1 - impact * 0.42);
        this.squashState.velocityY = -impact * 4.5;
        this.wobbleEnergy = Math.min(1.2, this.wobbleEnergy + impact * 0.9);
        this.audio.playBounce(impact);
      }
      this.prevSlimeVelY = nextSlime.velocity.y;

      // If slime fell outside bounds (safety recovery)
      if (nextSlime.position.y < -4) {
        this.slimeBody.setPosition({ x: 0, y: 1.5, z: 3.2 });
      }

      // Squash-stretch spring (decoupled from collider!)
      const targetScaleY = input.charging ? 1 - this.chargeRatio * 0.45 : 1.0;
      this.squashState = stepSquashSpring(this.squashState, targetScaleY, 240, 14, dt);
      this.wobbleEnergy = Math.max(0, this.wobbleEnergy - dt * 1.35);

      this.slimeRig.root.position.set(
        nextSlime.position.x,
        nextSlime.position.y,
        nextSlime.position.z
      );
      // Anchor visual squash at bottom of sphere so it presses into the floor instead of floating
      const r = this.slimeRig.radius;
      this.slimeRig.visualGroup.scale.set(
        this.squashState.scaleXZ,
        this.squashState.scaleY,
        this.squashState.scaleXZ
      );
      this.slimeRig.visualGroup.position.y = -r * (1 - this.squashState.scaleY);

      if (moveMag > 0.08) {
        const targetFaceYaw = Math.atan2(-worldDir.x, -worldDir.z);
        const curY = this.slimeRig.visualGroup.rotation.y;
        let diff = targetFaceYaw - curY;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.slimeRig.visualGroup.rotation.y += diff * (1 - Math.exp(-10 * dt));
      }

      // Contact shadow tracks beneath slime
      this.slimeRig.contactShadow.position.y = -nextSlime.position.y + 0.025;
      const shadowScale = Math.max(0.45, 1 - Math.max(0, nextSlime.position.y - r) * 0.12);
      this.slimeRig.contactShadow.scale.setScalar(shadowScale);

      this.slimeRig.shaderUniforms.uTime.value = this.elapsed;
      this.slimeRig.shaderUniforms.uWobble.value = this.wobbleEnergy;
      this.slimeRig.shaderUniforms.uCharge.value = this.chargeRatio;

      // Update 3D impulse direction arrow (always extends past slime radius)
      const showArrow = this.activeTest === 'B' || this.activeTest === 'C' || this.activeTest === 'D';
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
        this.impulseArrow.ring.scale.setScalar(1 + this.chargeRatio * 0.35);
      }

      // Update Balloon Baby visual
      if (this.balloonRig && this.balloonBody) {
        const bTf = this.balloonBody.getTransform();
        this.balloonRig.root.position.set(bTf.position.x, bTf.position.y, bTf.position.z);
        this.balloonRig.visualGroup.rotation.y = Math.sin(this.elapsed * 0.8) * 0.25;
        this.balloonRig.contactShadow.position.y = -bTf.position.y + 0.025;
        if (bTf.position.y < -4) {
          this.balloonBody.setPosition({ x: 0, y: 2.0, z: -0.5 });
        }
      }

      // Update Stress InstancedMeshes (Test E)
      if (this.activeTest === 'E' && this.stressBoxesMesh && this.stressSpheresMesh) {
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

      // Third-person camera follow with exponential damping
      _targetLook.set(
        nextSlime.position.x,
        nextSlime.position.y + 0.55,
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

    const renderStart = performance.now();
    this.renderer.render(this.scene, this.camera);
    const frameTime = performance.now() - renderStart + dt * 1000;
    this.currentFrameMs = this.currentFrameMs * 0.85 + (dt * 1000) * 0.15;
    if (rawDt > 0 && rawDt < 0.8) {
      this.fpsSamples.push(1 / rawDt);
      if (this.fpsSamples.length > 20) this.fpsSamples.shift();
    }

    // Throttle React telemetry callback to <= 6 Hz
    if (now - this.lastTelemetryTs > 170) {
      this.lastTelemetryTs = now;
      const avgFps =
        this.fpsSamples.length > 0
          ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length
          : 0;
      const perfMem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const heapMb = perfMem ? perfMem.usedJSHeapSize / (1024 * 1024) : null;

      let balloonAlt = 0;
      let balloonInGoal = false;
      if (this.balloonBody) {
        const bp = this.balloonBody.getTransform().position;
        balloonAlt = bp.y;
        const distToGoal = Math.hypot(bp.x - 6.0, bp.y - 3.9, bp.z - -4.5);
        balloonInGoal = distToGoal < 1.9;
      }

      const deg = (((this.cameraYaw * 180) / Math.PI) % 360 + 360) % 360;
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
        chargeRatio: Number(this.chargeRatio.toFixed(2)),
        impulseVec: impulsePreview,
        gamepadName: input.gamepadName,
        balloonAltitude: Number(balloonAlt.toFixed(2)),
        balloonInGoal,
        engineKind: this.engineKind,
        rapierReady: this.rapierReady,
      });
      void frameTime;
    }

    this.scheduleNextTick();
  };

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
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
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
    void _tempVec;
  }
}
