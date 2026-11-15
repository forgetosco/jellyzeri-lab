import * as THREE from 'three';

export type SlimeExpressionState = 'idle' | 'moving' | 'charging' | 'airborne' | 'landing';

export interface SlimeRig {
  root: THREE.Group;
  visualGroup: THREE.Group;
  shellMesh: THREE.Mesh;
  coreMesh: THREE.Mesh;
  crestGroup: THREE.Group;
  bubbles: THREE.Mesh[];
  eyeGroups: THREE.Group[];
  smileMesh: THREE.Mesh;
  openMouthMesh: THREE.Mesh;
  contactShadow: THREE.Mesh;
  shaderUniforms: {
    uTime: { value: number };
    uWobble: { value: number };
    uCharge: { value: number };
  };
  radius: number;
  blinkTimer: number;
  blinkDuration: number;
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
  grad.addColorStop(0, 'rgba(3, 7, 18, 0.7)');
  grad.addColorStop(0.55, 'rgba(3, 7, 18, 0.28)');
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

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i < size; i += 16) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = 256;
  bumpCanvas.height = 256;
  const bctx = bumpCanvas.getContext('2d')!;
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    const x = (i * 73) % 256;
    const y = (i * 137) % 256;
    const shade = i % 2 === 0 ? 145 : 110;
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

export function createRampChevronTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#27364f';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 8;
  for (let y = 32; y < size + 64; y += 64) {
    ctx.beginPath();
    ctx.moveTo(28, y);
    ctx.lineTo(size / 2, y - 34);
    ctx.lineTo(size - 28, y);
    ctx.stroke();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Sculpts a rounded yet subtly organic, bottom-plump mochi/drop silhouette
 * while preserving the spherical collision envelope radius.
 */
function buildOrganicSlimeGeometry(radius: number): THREE.SphereGeometry {
  const geo = new THREE.SphereGeometry(radius, 32, 24);
  const pos = geo.attributes.position;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    const ny = y / radius; // [-1, 1]
    const angle = Math.atan2(z, x);

    // Subtle plumpness around lower belly + gentle crown taper
    const bellySpread = 1.0 + Math.max(0, -ny) * 0.08 - Math.max(0, ny) * 0.04;
    // Slight 3-lobe organic irregularity so silhouette feels gelatinous, not mechanical
    const lobe = 1.0 + 0.03 * Math.sin(angle * 3.0 + ny * 1.4) + 0.018 * Math.cos(angle * 2.0 - ny * 2.2);

    let sx = x * bellySpread * lobe;
    let sz = z * bellySpread * lobe;
    // Slightly cushion the very bottom contact patch
    let sy = y;
    if (ny < -0.78) {
      const t = (-ny - 0.78) / 0.22;
      sy = THREE.MathUtils.lerp(y, -radius * 0.9, t * 0.45);
    }

    pos.setXYZ(i, sx, sy, sz);
  }

  geo.computeVertexNormals();
  return geo;
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

  // 1. Translucent glossy gelatinous outer membrane with Fresnel rim & wobble shader
  const shellGeo = buildOrganicSlimeGeometry(radius);
  const shellMat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#a855f7'),
    emissive: new THREE.Color('#4c1d95'),
    emissiveIntensity: 0.3,
    roughness: 0.08,
    metalness: 0.0,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    ior: 1.42,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
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
      varying vec3 vJellyViewNormal;
      varying vec3 vJellyViewPos;
      ` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      float breath = sin(uTime * 3.1 + transformed.y * 2.4) * 0.014;
      float waveA = sin(transformed.y * 5.6 + uTime * 9.5);
      float waveB = cos(transformed.x * 4.9 + transformed.z * 4.9 - uTime * 8.0);
      float wobbleAmp = uWobble * 0.08 + uCharge * 0.025;
      transformed.x += normal.x * (waveA * wobbleAmp + breath);
      transformed.z += normal.z * (waveB * wobbleAmp + breath);
      transformed.y += (waveA * 0.45) * wobbleAmp - breath * 0.6;
      `
    );

    shader.vertexShader = shader.vertexShader.replace(
      '#include <project_vertex>',
      `
      #include <project_vertex>
      vJellyViewNormal = normalize(normalMatrix * objectNormal);
      vJellyViewPos = mvPosition.xyz;
      `
    );

    shader.fragmentShader =
      `
      uniform float uCharge;
      varying vec3 vJellyViewNormal;
      varying vec3 vJellyViewPos;
      ` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `
      vec3 jViewDir = normalize(-vJellyViewPos);
      float jFresnel = pow(1.0 - clamp(abs(dot(jViewDir, normalize(vJellyViewNormal))), 0.0, 1.0), 2.35);
      vec3 rimTint = mix(vec3(0.82, 0.56, 1.0), vec3(0.35, 0.92, 1.0), uCharge);
      gl_FragColor.rgb += rimTint * jFresnel * (0.42 + uCharge * 0.45);
      gl_FragColor.a = clamp(gl_FragColor.a + jFresnel * 0.16, 0.0, 0.96);
      #include <dithering_fragment>
      `
    );
  };

  const shellMesh = new THREE.Mesh(shellGeo, shellMat);
  shellMesh.castShadow = true;
  shellMesh.receiveShadow = true;
  shellMesh.renderOrder = 2;
  visualGroup.add(shellMesh);

  // 2. Inner luminous jelly nucleus + suspended micro-bubbles for depth
  const coreGeo = new THREE.SphereGeometry(radius * 0.42, 18, 14);
  coreGeo.scale(1.05, 0.92, 1.05);
  const coreMat = new THREE.MeshStandardMaterial({
    color: '#e9d5ff',
    emissive: '#9333ea',
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.05,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.y = -radius * 0.06;
  coreMesh.renderOrder = 1;
  visualGroup.add(coreMesh);

  const bubbleMat = new THREE.MeshStandardMaterial({
    color: '#f5d0fe',
    emissive: '#c084fc',
    emissiveIntensity: 0.55,
    roughness: 0.12,
    transparent: true,
    opacity: 0.72,
  });
  const bubbleSpecs: [number, number, number, number][] = [
    [-0.22, 0.18, 0.16, 0.075],
    [0.24, -0.05, 0.12, 0.058],
    [0.06, 0.34, -0.1, 0.052],
  ];
  const bubbles: THREE.Mesh[] = bubbleSpecs.map(([bx, by, bz, br]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(radius * br, 10, 8), bubbleMat);
    b.position.set(bx * radius, by * radius, bz * radius);
    b.userData.baseY = by * radius;
    b.renderOrder = 1;
    visualGroup.add(b);
    return b;
  });

  // 3. Expressive kawaii eyes (front is -Z)
  const scleraGeo = new THREE.SphereGeometry(radius * 0.165, 16, 12);
  scleraGeo.scale(0.92, 1.15, 0.55);
  const scleraMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: '#f8fafc',
    emissiveIntensity: 0.15,
    roughness: 0.18,
  });

  const irisGeo = new THREE.SphereGeometry(radius * 0.118, 14, 12);
  irisGeo.scale(0.92, 1.12, 0.55);
  const irisMat = new THREE.MeshStandardMaterial({
    color: '#1e1b4b',
    roughness: 0.1,
    metalness: 0.1,
  });

  const catchMainGeo = new THREE.SphereGeometry(radius * 0.045, 8, 8);
  const catchSubGeo = new THREE.SphereGeometry(radius * 0.022, 8, 8);
  const catchMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });

  const eyeGroups: THREE.Group[] = [];
  [-1, 1].forEach((side) => {
    const eyeGroup = new THREE.Group();
    eyeGroup.position.set(side * radius * 0.28, radius * 0.16, -radius * 0.88);
    eyeGroup.rotation.y = side * 0.22;

    const sclera = new THREE.Mesh(scleraGeo, scleraMat);
    sclera.renderOrder = 3;

    const iris = new THREE.Mesh(irisGeo, irisMat);
    iris.position.set(0, -radius * 0.01, -radius * 0.048);
    iris.renderOrder = 4;

    const catchMain = new THREE.Mesh(catchMainGeo, catchMat);
    catchMain.position.set(side * radius * 0.03, radius * 0.05, -radius * 0.095);
    catchMain.renderOrder = 5;

    const catchSub = new THREE.Mesh(catchSubGeo, catchMat);
    catchSub.position.set(-side * radius * 0.032, -radius * 0.045, -radius * 0.09);
    catchSub.renderOrder = 5;

    eyeGroup.add(sclera, iris, catchMain, catchSub);
    visualGroup.add(eyeGroup);
    eyeGroups.push(eyeGroup);
  });

  // 4. Rosy cheeks + dual-state mouth (smile arc + airborne 'o')
  const cheekGeo = new THREE.SphereGeometry(radius * 0.105, 10, 8);
  const cheekMat = new THREE.MeshStandardMaterial({
    color: '#fb7185',
    emissive: '#f43f5e',
    emissiveIntensity: 0.25,
    roughness: 0.45,
    transparent: true,
    opacity: 0.82,
  });
  [-1, 1].forEach((side) => {
    const cheek = new THREE.Mesh(cheekGeo, cheekMat);
    cheek.scale.set(1.25, 0.65, 0.42);
    cheek.position.set(side * radius * 0.46, -radius * 0.04, -radius * 0.8);
    cheek.rotation.y = side * 0.35;
    cheek.renderOrder = 3;
    visualGroup.add(cheek);
  });

  const mouthMat = new THREE.MeshStandardMaterial({
    color: '#3b0764',
    roughness: 0.25,
  });
  const smileGeo = new THREE.TorusGeometry(radius * 0.095, radius * 0.022, 8, 16, Math.PI);
  const smileMesh = new THREE.Mesh(smileGeo, mouthMat);
  smileMesh.rotation.z = Math.PI;
  smileMesh.position.set(0, -radius * 0.02, -radius * 0.93);
  smileMesh.renderOrder = 4;
  visualGroup.add(smileMesh);

  const openMouthGeo = new THREE.TorusGeometry(radius * 0.068, radius * 0.022, 8, 16);
  const openMouthMesh = new THREE.Mesh(openMouthGeo, mouthMat);
  openMouthMesh.position.set(0, -radius * 0.06, -radius * 0.93);
  openMouthMesh.visible = false;
  openMouthMesh.renderOrder = 4;
  visualGroup.add(openMouthMesh);

  // 5. Cute top jelly droplet crest
  const crestGroup = new THREE.Group();
  crestGroup.position.set(0, radius * 0.94, 0.04);
  const crestMat = new THREE.MeshPhysicalMaterial({
    color: '#c084fc',
    emissive: '#6b21a8',
    emissiveIntensity: 0.25,
    roughness: 0.12,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.88,
  });
  const crestDrop = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.165, 14, 12), crestMat);
  crestDrop.scale.set(0.88, 1.35, 0.88);
  crestDrop.rotation.x = 0.25;
  crestDrop.renderOrder = 2;
  const crestTip = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.09, 10, 8), crestMat);
  crestTip.position.set(0, radius * 0.19, 0.06);
  crestTip.renderOrder = 2;
  crestGroup.add(crestDrop, crestTip);
  visualGroup.add(crestGroup);

  // 6. Radial contact shadow disc
  const shadowGeo = new THREE.CircleGeometry(radius * 1.38, 24);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0.72,
  });
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.02;
  root.add(contactShadow);

  return {
    root,
    visualGroup,
    shellMesh,
    coreMesh,
    crestGroup,
    bubbles,
    eyeGroups,
    smileMesh,
    openMouthMesh,
    contactShadow,
    shaderUniforms,
    radius,
    blinkTimer: 2.1,
    blinkDuration: 0,
  };
}

export function updateSlimeVisuals(
  rig: SlimeRig,
  expression: SlimeExpressionState,
  chargeRatio: number,
  elapsed: number,
  dt: number
): void {
  // Periodic natural eye blink
  if (rig.blinkDuration > 0) {
    rig.blinkDuration = Math.max(0, rig.blinkDuration - dt);
  } else {
    rig.blinkTimer -= dt;
    if (rig.blinkTimer <= 0) {
      rig.blinkDuration = 0.14;
      rig.blinkTimer = 2.6 + ((Math.sin(elapsed * 7.3) + 1) * 1.1);
    }
  }

  const isBlinking = rig.blinkDuration > 0 || expression === 'landing';
  let targetEyeScaleY = 1.0;
  let targetEyeScaleX = 1.0;

  if (isBlinking) {
    targetEyeScaleY = 0.16;
    targetEyeScaleX = 1.15;
  } else if (expression === 'charging') {
    // Focused determined squint proportional to charge
    targetEyeScaleY = THREE.MathUtils.lerp(0.85, 0.34, chargeRatio);
    targetEyeScaleX = THREE.MathUtils.lerp(1.0, 1.18, chargeRatio);
  } else if (expression === 'airborne') {
    targetEyeScaleY = 1.15;
    targetEyeScaleX = 1.06;
  }

  const eyeBlend = 1 - Math.exp(-18 * dt);
  for (let i = 0; i < rig.eyeGroups.length; i++) {
    const eg = rig.eyeGroups[i];
    eg.scale.y = THREE.MathUtils.lerp(eg.scale.y, targetEyeScaleY, eyeBlend);
    eg.scale.x = THREE.MathUtils.lerp(eg.scale.x, targetEyeScaleX, eyeBlend);
  }

  // Mouth expression
  if (expression === 'airborne') {
    rig.smileMesh.visible = false;
    rig.openMouthMesh.visible = true;
    const oPulse = 1 + Math.sin(elapsed * 14) * 0.08;
    rig.openMouthMesh.scale.set(oPulse, oPulse, 1);
  } else {
    rig.smileMesh.visible = true;
    rig.openMouthMesh.visible = false;
    if (expression === 'charging') {
      rig.smileMesh.scale.set(0.75, 0.55, 1);
    } else {
      rig.smileMesh.scale.set(1, 1, 1);
    }
  }

  // Core pulse & internal bubble bob
  const coreMat = rig.coreMesh.material as THREE.MeshStandardMaterial;
  coreMat.emissiveIntensity = 0.8 + chargeRatio * 0.9 + Math.sin(elapsed * 4.2) * 0.12;
  rig.coreMesh.rotation.y = elapsed * 0.6;

  for (let i = 0; i < rig.bubbles.length; i++) {
    const b = rig.bubbles[i];
    const baseY = (b.userData.baseY as number) ?? 0;
    b.position.y = baseY + Math.sin(elapsed * 2.6 + i * 2.1) * 0.035;
  }

  // Top crest wobble
  rig.crestGroup.rotation.z = Math.sin(elapsed * 3.8) * (0.08 + chargeRatio * 0.15);
  rig.crestGroup.rotation.x = Math.cos(elapsed * 3.2) * (0.06 + chargeRatio * 0.12);
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
