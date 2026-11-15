import * as THREE from 'three';

export interface SlimeRig {
  root: THREE.Group;
  visualGroup: THREE.Group;
  shellMesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  contactShadow: THREE.Mesh;
  shaderUniforms: {
    uTime: { value: number };
    uWobble: { value: number };
    uCharge: { value: number };
  };
  radius: number;
}

export interface BalloonRig {
  root: THREE.Group;
  visualGroup: THREE.Group;
  contactShadow: THREE.Mesh;
  radius: number;
}

export interface ImpulseArrowRig {
  group: THREE.Group;
  shaft: THREE.Mesh;
  head: THREE.Mesh;
  ring: THREE.Mesh;
}

export function createContactShadowTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(3, 7, 18, 0.65)');
  grad.addColorStop(0.55, 'rgba(3, 7, 18, 0.25)');
  grad.addColorStop(1, 'rgba(3, 7, 18, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createArenaFloorTextures(maxAnisotropy: number): {
  map: THREE.CanvasTexture;
  bumpMap: THREE.CanvasTexture;
} {
  const size = 512;
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const ctx = colorCanvas.getContext('2d')!;

  ctx.fillStyle = '#162033';
  ctx.fillRect(0, 0, size, size);

  // Subtle calibration grid
  ctx.strokeStyle = '#253552';
  ctx.lineWidth = 2;
  const step = 64;
  for (let i = 0; i <= size; i += step) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

  // Fine sub-ticks
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  // Micro surface grain
  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    const shade = (i % 2 === 0) ? 145 : 110;
    bctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    bctx.fillRect(x, y, 2, 2);
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(14, 14);
  map.anisotropy = maxAnisotropy;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(14, 14);
  bumpMap.anisotropy = maxAnisotropy;

  return { map, bumpMap };
}

export function createPurpleSlimeRig(
  radius = 0.65,
  shadowTexture: THREE.Texture
): SlimeRig {
  const root = new THREE.Group();
  const visualGroup = new THREE.Group();
  root.add(visualGroup);

  const shaderUniforms = {
    uTime: { value: 0 },
    uWobble: { value: 0 },
    uCharge: { value: 0 },
  };

  // 1. Primary translucent gelatinous outer shell with vertex wobble shader extension
  const shellGeo = new THREE.SphereGeometry(radius, 28, 22);
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#9333ea'),
    emissive: new THREE.Color('#3b0764'),
    emissiveIntensity: 0.35,
    roughness: 0.14,
    metalness: 0.02,
    clearcoat: 0.95,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.86,
  });

  shellMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shaderUniforms.uTime;
    shader.uniforms.uWobble = shaderUniforms.uWobble;
    shader.uniforms.uCharge = shaderUniforms.uCharge;

    shader.vertexShader =
      `
      uniform float uTime;
      uniform float uWobble;
      uniform float uCharge;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float waveA = sin(transformed.y * 5.2 + uTime * 9.0);
      float waveB = cos(transformed.x * 4.7 + transformed.z * 4.7 - uTime * 7.5);
      float wobbleAmp = uWobble * 0.075 + uCharge * 0.022;
      transformed.x += normal.x * waveA * wobbleAmp;
      transformed.z += normal.z * waveB * wobbleAmp;
      transformed.y += (waveA * 0.4) * wobbleAmp;
      `
    );
  };

  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  visualGroup.add(shellMesh);

  // 2. Inner gelatinous core
  const coreGeo = new THREE.IcosahedronGeometry(radius * 0.44, 1);
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#d8b4fe',
    emissive: '#7e22ce',
    emissiveIntensity: 0.75,
    roughness: 0.45,
    metalness: 0.1,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.y = -radius * 0.05;
  visualGroup.add(coreMesh);

  // 3. Expressive eyes (sclera + pupil + catchlight)
  const scleraGeo = new THREE.SphereGeometry(radius * 0.16, 14, 12);
  const scleraMat = new THREE.MeshStandardMaterial({
    color: '#f8fafc',
    roughness: 0.25,
    metalness: 0.0,
  });
  const pupilGeo = new THREE.SphereGeometry(radius * 0.09, 12, 10);
  const pupilMat = new THREE.MeshStandardMaterial({
    color: '#0f172a',
    roughness: 0.1,
    metalness: 0.1,
  });
  const catchGeo = new THREE.SphereGeometry(radius * 0.032, 8, 8);
  const catchMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  [-1, 1].forEach((side) => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * radius * 0.27, radius * 0.18, -radius * 0.76);

    const sclera = new THREE.Mesh(scleraGeo, scleraMat);
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.position.z = -radius * 0.1;

    const catchLight = new THREE.Mesh(catchGeo, catchMat);
    catchLight.position.set(side * radius * 0.03, radius * 0.04, -radius * 0.16);

    eyeGroup.add(sclera, pupil, catchLight);
    visualGroup.add(eyeGroup);
  });

  // 4. Cheek blushes + cute top jelly crest droplet
  const cheekGeo = new THREE.SphereGeometry(radius * 0.1, 10, 8);
  const cheekMat = new THREE.MeshStandardMaterial({
    color: '#f472b6',
    roughness: 0.5,
    transparent: true,
    opacity: 0.75,
  });
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(cheekGeo, cheekMat);
    cheek.scale.set(1.2, 0.7, 0.5);
    cheek.position.set(side * radius * 0.45, -radius * 0.02, -radius * 0.68);
    visualGroup.add(cheek);
  });

  const crestMat = new THREE.MeshPhysicalMaterial({
    color: '#c084fc',
    roughness: 0.18,
    clearcoat: 0.9,
    transparent: true,
    opacity: 0.9,
  });
  const crest = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.18, 14, 12), crestMat);
  crest.scale.set(0.85, 1.35, 0.85);
  crest.position.set(0, radius * 0.95, 0.04);
  visualGroup.add(crest);

  // 5. Radial contact shadow disc
  const shadowGeo = new THREE.CircleGeometry(radius * 1.35, 24);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.7,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  return {
    root,
    visualGroup,
    shellMesh,
    coreMesh,
    contactShadow,
    shaderUniforms,
    radius,
  };
}

export function createBalloonBabyRig(
  radius = 0.52,
  shadowTexture: THREE.Texture
): BalloonRig {
  const root = new THREE.Group();
  const visualGroup = new THREE.Group();
  root.add(visualGroup);

  // 1. Translucent sky-blue balloon body
  const bodyGeo = new THREE.SphereGeometry(radius, 24, 18);
  bodyGeo.scale(0.95, 1.08, 0.95);
  const bodyMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#38bdf8'),
    emissive: new THREE.Color('#0284c7'),
    emissiveIntensity: 0.25,
    roughness: 0.1,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.06,
    transparent: true,
    opacity: 0.88,
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  visualGroup.add(bodyMesh);

  // 2. Inner glowing star core
  const innerGeo = new THREE.OctahedronGeometry(radius * 0.35, 0);
  const innerMat = new THREE.MeshStandardMaterial({
    color: '#bae6fd',
    emissive: '#38bdf8',
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const innerMesh = new THREE.Mesh(innerGeo, innerMat);
  visualGroup.add(innerMesh);

  // 3. Balloon knot & collar
  const knotMat = new THREE.MeshStandardMaterial({
    color: '#0284c7',
    roughness: 0.55,
  });
  const knot = new THREE.Mesh(new THREE.ConeGeometry(radius * 0.16, radius * 0.22, 12), knotMat);
  knot.position.y = -radius * 1.12;
  visualGroup.add(knot);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(radius * 0.11, radius * 0.035, 8, 16), knotMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = -radius * 1.04;
  visualGroup.add(collar);

  // 4. Curved ribbon tail
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, -radius * 1.18, 0),
    new THREE.Vector3(0.08, -radius * 1.48, 0.05),
    new THREE.Vector3(-0.07, -radius * 1.78, -0.04),
    new THREE.Vector3(0.03, -radius * 2.05, 0.02),
  ]);
  const tailGeo = new THREE.TubeGeometry(curve, 12, 0.022, 6, false);
  const tailMat = new THREE.MeshStandardMaterial({ color: '#e0f2fe', roughness: 0.6 });
  const tail = new THREE.Mesh(tailGeo, tailMat);
  visualGroup.add(tail);

  // 5. Baby eyes
  const eyeGeo = new THREE.SphereGeometry(radius * 0.12, 12, 10);
  const eyeMat = new THREE.MeshStandardMaterial({ color: '#0f172a', roughness: 0.15 });
  const glintGeo = new THREE.SphereGeometry(radius * 0.04, 8, 8);
  const glintMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  [-1, 1].forEach((side) => {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(side * radius * 0.26, radius * 0.12, -radius * 0.85);
    const glint = new THREE.Mesh(glintGeo, glintMat);
    glint.position.set(side * radius * 0.28, radius * 0.16, -radius * 0.94);
    visualGroup.add(eye, glint);
  });

  // 6. Contact shadow
  const shadowGeo = new THREE.CircleGeometry(radius * 1.1, 20);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.5,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  return {
    root,
    visualGroup,
    contactShadow,
    radius,
  };
}

export function createImpulseArrow(): ImpulseArrowRig {
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({
    color: '#22d3ee',
    emissive: '#06b6d4',
    emissiveIntensity: 0.75,
    roughness: 0.25,
    transparent: true,
    opacity: 0.9,
  });

  const shaftGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 10);
  shaftGeo.translate(0, 0.5, 0);
  shaftGeo.rotateX(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftGeo, mat);

  const headGeo = new THREE.ConeGeometry(0.18, 0.36, 12);
  headGeo.rotateX(Math.PI / 2);
  const head = new THREE.Mesh(headGeo, mat);

  const ringGeo = new THREE.RingGeometry(0.76, 0.88, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.y = 0.04;

  group.add(shaft, head, ring);
  return { group, shaft, head, ring };
}

export function createMotherBeacon(): THREE.Group {
  const group = new THREE.Group();

  // Base pedestal
  const pedMat = new THREE.MeshStandardMaterial({
    color: '#1e293b',
    roughness: 0.65,
    metalness: 0.25,
  });
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, 0.4, 24), pedMat);
  ped.position.y = 0.2;
  ped.receiveShadow = true;
  group.add(ped);

  // Glowing target ring (represents mother balloon beacon)
  const ringMat = new THREE.MeshStandardMaterial({
    color: '#38bdf8',
    emissive: '#0ea5e9',
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.1, 14, 36), ringMat);
  ring.position.y = 2.6;
  group.add(ring);

  // Translucent beacon column
  const colMat = new THREE.MeshBasicMaterial({
    color: '#38bdf8',
    transparent: true,
    opacity: 0.14,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const col = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 4.2, 24, 1, true), colMat);
  col.position.y = 2.1;
  group.add(col);

  return group;
}
