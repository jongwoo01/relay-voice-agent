import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const PALETTES = {
  idle: {
    core: "#f7fbff",
    hologram: "#67ddff",
    accent: "#9b93ff",
    rim: "#ffffff",
    glow: "#d9f2ff"
  },
  listening: {
    core: "#f4fdff",
    hologram: "#5de4ff",
    accent: "#8dbbff",
    rim: "#ffffff",
    glow: "#ddf8ff"
  },
  thinking: {
    core: "#fbf9ff",
    hologram: "#a193ff",
    accent: "#f19bd8",
    rim: "#fffaff",
    glow: "#ece5ff"
  },
  speaking: {
    core: "#f6fbff",
    hologram: "#72dfff",
    accent: "#b18fff",
    rim: "#ffffff",
    glow: "#dcf5ff"
  },
  interrupted: {
    core: "#fff8f5",
    hologram: "#ffb08d",
    accent: "#ffd0bc",
    rim: "#fffdfa",
    glow: "#fff0e8"
  }
};

const TARGETS = {
  idle: {
    tiltX: -0.06,
    tiltY: 0.22,
    scale: 1,
    signalSpeed: 0.62,
    scanlineSize: 10.5,
    brightness: 1.02,
    glitch: 0.03,
    mediumRadius: 1.24,
    outerRadius: 1.78
  },
  listening: {
    tiltX: -0.1,
    tiltY: 0.28,
    scale: 1.03,
    signalSpeed: 0.74,
    scanlineSize: 11.2,
    brightness: 1.1,
    glitch: 0.04,
    mediumRadius: 1.02,
    outerRadius: 1.5
  },
  thinking: {
    tiltX: -0.18,
    tiltY: -0.14,
    scale: 0.99,
    signalSpeed: 0.48,
    scanlineSize: 9.2,
    brightness: 1.08,
    glitch: 0.12,
    mediumRadius: 1.18,
    outerRadius: 1.68
  },
  speaking: {
    tiltX: -0.04,
    tiltY: 0.16,
    scale: 1.05,
    signalSpeed: 0.94,
    scanlineSize: 13.2,
    brightness: 1.24,
    glitch: 0.075,
    mediumRadius: 1.28,
    outerRadius: 1.92
  },
  interrupted: {
    tiltX: 0.12,
    tiltY: -0.12,
    scale: 0.97,
    signalSpeed: 0.38,
    scanlineSize: 8.4,
    brightness: 0.98,
    glitch: 0.18,
    mediumRadius: 1.28,
    outerRadius: 1.88
  }
};

const THINK_MEDIUM_POINTS = [
  [-1, -1, -1],
  [1, -1, -1],
  [-1, 1, -1],
  [1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [-1, 1, 1],
  [1, 1, 1],
  [0, 0, 1.36],
  [0, 0, -1.36],
  [0, 1.36, 0],
  [0, -1.36, 0]
];

const HOLOGRAM_VERTEX_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vUv = uv;
    vPositionW = worldPosition.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

const HOLOGRAM_FRAGMENT_SHADER = `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPositionW;

  uniform float time;
  uniform float fresnelAmount;
  uniform float scanlineSize;
  uniform float hologramBrightness;
  uniform float signalSpeed;
  uniform float energy;
  uniform float glitchAmount;
  uniform float opacity;
  uniform vec3 hologramColor;
  uniform vec3 accentColor;

  float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  void main() {
    vec3 normalW = normalize(vNormalW);
    vec3 viewDirection = normalize(cameraPosition - vPositionW);

    float fresnel = pow(1.0 - max(dot(viewDirection, normalW), 0.0), 1.45);
    float scanPrimary = 0.5 + 0.5 * sin(vUv.y * 138.0 * scanlineSize + time * signalSpeed * 27.0);
    float scanSecondary = 0.5 + 0.5 * sin(vUv.x * 34.0 - time * signalSpeed * 16.0);
    float grid = smoothstep(0.72, 1.0, abs(sin(vUv.x * 18.0)) * abs(sin(vUv.y * 18.0)));

    vec2 glitchCell = floor(vUv * vec2(8.0, 24.0) + vec2(time * signalSpeed * 2.0, time * signalSpeed * 6.0));
    float glitchNoise = random(glitchCell);
    float glitchBand = step(1.0 - glitchAmount * 0.55, glitchNoise) * glitchAmount;

    vec3 color = hologramColor * (0.54 + scanPrimary * 0.24 + scanSecondary * 0.1);
    color += accentColor * (grid * 0.18 + energy * 0.14);
    color += hologramColor * fresnel * fresnelAmount;
    color += accentColor * glitchBand * (0.42 + energy * 0.4);
    color *= hologramBrightness;

    float alpha = opacity * (
      0.24 +
      fresnel * 0.48 +
      scanPrimary * 0.12 +
      grid * 0.12 +
      energy * 0.18
    );
    alpha += glitchBand * 0.12;

    gl_FragColor = vec4(color, min(alpha, 0.94));
  }
`;

function clamp01(value) {
  return Math.max(0, Math.min(value, 1));
}

function readReactiveValue(value) {
  if (typeof value === "number") {
    return clamp01(value);
  }

  if (value && typeof value.get === "function") {
    return clamp01(value.get());
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp01(numeric) : 0;
}

function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function frontHemisphereWave(value) {
  return Math.abs(Math.sin(value));
}

function createLayerConfigs(count, seedOffset, minScale, maxScale) {
  return Array.from({ length: count }, (_, index) => {
    const seed = index + seedOffset + 1;
    return {
      phase: pseudoRandom(seed) * Math.PI * 2,
      speed: 0.28 + pseudoRandom(seed + 5) * 0.62,
      orbit: pseudoRandom(seed + 9),
      vertical: pseudoRandom(seed + 13) * 2 - 1,
      scale: minScale + pseudoRandom(seed + 17) * (maxScale - minScale),
      tintMix: pseudoRandom(seed + 21),
      tilt: pseudoRandom(seed + 25) * Math.PI
    };
  });
}

function createInstanceStates(configs) {
  return configs.map(() => ({
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(),
    scale: new THREE.Vector3(1, 1, 1)
  }));
}

function createHologramMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      fresnelAmount: { value: 0.74 },
      scanlineSize: { value: 10.5 },
      hologramBrightness: { value: 1.04 },
      signalSpeed: { value: 0.62 },
      energy: { value: 0 },
      glitchAmount: { value: 0.035 },
      opacity: { value: 0.74 },
      hologramColor: { value: new THREE.Color("#67ddff") },
      accentColor: { value: new THREE.Color("#9b93ff") }
    },
    vertexShader: HOLOGRAM_VERTEX_SHADER,
    fragmentShader: HOLOGRAM_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
}

function setMediumTarget(target, config, index, state, time, activityLevel, radius) {
  const angle = time * config.speed + config.phase;
  switch (state) {
    case "listening": {
      const listenAngle = angle * 1.05;
      target.position.set(
        Math.cos(listenAngle) * radius,
        Math.sin(listenAngle * 1.8 + config.phase) * 0.26,
        0.72 + frontHemisphereWave(listenAngle + config.tilt) * 0.26
      );
      target.rotation.set(config.tilt * 0.25, listenAngle, config.tilt * 0.45);
      target.scale.setScalar(config.scale * (1.04 + activityLevel * 0.22));
      return;
    }
    case "thinking": {
      const point = THINK_MEDIUM_POINTS[index % THINK_MEDIUM_POINTS.length];
      target.position.set(
        point[0] * 0.96 + Math.sin(time * 1.3 + config.phase) * 0.06,
        point[1] * 0.96 + Math.cos(time * 1.1 + config.phase) * 0.06,
        point[2] * 0.96 + Math.sin(time * 0.9 + config.phase) * 0.05
      );
      target.rotation.set(time * 0.55 + config.phase, time * 0.72 + config.tilt, time * 0.36);
      target.scale.setScalar(config.scale * (0.98 + Math.sin(time * 1.8 + config.phase) * 0.04));
      return;
    }
    case "speaking": {
      const spread = (index / 11 - 0.5) * Math.PI * 0.95;
      target.position.set(
        Math.sin(spread) * (radius - 0.08),
        Math.cos(spread * 1.9 + time * 1.3) * 0.18,
        0.98 + frontHemisphereWave(spread * 1.2 + config.phase) * 0.22 + activityLevel * 0.24
      );
      target.rotation.set(config.tilt * 0.3, time * 1.05 + config.phase, spread * 0.58);
      target.scale.setScalar(config.scale * (1.06 + activityLevel * 0.26));
      return;
    }
    case "interrupted": {
      target.position.set(
        Math.cos(angle * 1.4) * (radius + 0.16) + Math.sin(time * 9 + config.phase) * 0.12,
        Math.sin(angle * 1.7) * 0.72 + Math.cos(time * 11 + config.tilt) * 0.12,
        Math.sin(angle * 0.8) * 0.52
      );
      target.rotation.set(time * 1.4 + config.phase, time * 1.1 + config.tilt, time * 1.8);
      target.scale.setScalar(config.scale * 0.96);
      return;
    }
    case "idle":
    default: {
      target.position.set(
        Math.cos(angle) * radius,
        config.vertical * 0.62 + Math.sin(angle * 1.3 + config.phase) * 0.12,
        0.42 + frontHemisphereWave(angle + config.tilt) * radius * 0.28
      );
      target.rotation.set(angle * 0.65, angle * 1.05, angle * 0.42);
      target.scale.setScalar(config.scale * (1 + activityLevel * 0.12));
    }
  }
}

function setOuterTarget(target, config, index, count, state, time, activityLevel, radius) {
  const angle = time * config.speed + config.phase;
  const ratio = count <= 1 ? 0 : index / (count - 1);

  switch (state) {
    case "listening": {
      const ringAngle = angle * 0.94 + ratio * Math.PI * 2;
      target.position.set(
        Math.cos(ringAngle) * radius,
        Math.sin(ringAngle * 1.5 + config.phase) * 0.3,
        0.56 + frontHemisphereWave(ringAngle + config.tilt) * 0.26
      );
      target.rotation.set(config.tilt, ringAngle, config.tilt * 0.6);
      target.scale.setScalar(config.scale * (1.03 + activityLevel * 0.22));
      return;
    }
    case "thinking": {
      const cols = 6;
      const column = index % cols;
      const row = Math.floor(index / cols);
      target.position.set(
        column * 0.52 - 1.3 + Math.sin(time * 1.6 + config.phase) * 0.08,
        row * 0.48 - 0.72 + Math.cos(time * 1.2 + config.phase) * 0.08,
        Math.sin(time * 0.86 + config.phase) * 0.4
      );
      target.rotation.set(time * 0.82 + config.phase, time * 1.06 + config.tilt, time * 0.4);
      target.scale.setScalar(config.scale * (0.96 + Math.sin(time * 2 + config.phase) * 0.05));
      return;
    }
    case "speaking": {
      const spread = (ratio - 0.5) * Math.PI * 1.65;
      target.position.set(
        Math.sin(spread) * radius * 0.82,
        Math.cos(spread * 1.8 + time * 1.4) * 0.28,
        1.04 + frontHemisphereWave(spread * 1.1 + config.phase) * 0.18 + activityLevel * 0.2
      );
      target.rotation.set(config.tilt * 0.3, time * 1.3 + config.phase, spread);
      target.scale.setScalar(config.scale * (1.08 + activityLevel * 0.32));
      return;
    }
    case "interrupted": {
      target.position.set(
        Math.cos(angle * 1.26) * radius + Math.sin(time * 9.2 + config.phase) * 0.18,
        Math.sin(angle * 1.82) * 1.2 + Math.cos(time * 10.4 + config.tilt) * 0.16,
        Math.sin(angle * 0.82) * 0.74
      );
      target.rotation.set(time * 1.6, time * 1.2 + config.phase, time * 1.9 + config.tilt);
      target.scale.setScalar(config.scale * (0.92 + pseudoRandom(index + 1) * 0.12));
      return;
    }
    case "idle":
    default: {
      target.position.set(
        Math.cos(angle) * radius,
        config.vertical * 0.82 + Math.sin(angle * 1.18 + config.phase) * 0.14,
        0.34 + frontHemisphereWave(angle + config.tilt) * radius * 0.32
      );
      target.rotation.set(angle * 0.56, angle * 0.92, angle * 0.3);
      target.scale.setScalar(config.scale * (1 + activityLevel * 0.1));
    }
  }
}

function setDistantTarget(target, config, index, count, state, time, activityLevel) {
  const angle = time * (0.08 + config.speed * 0.28) + config.phase;
  const ratio = count <= 1 ? 0 : index / (count - 1);
  const radius = 2.45 + config.orbit * 1.2;
  const depthLift =
    state === "speaking"
      ? 0.28 + activityLevel * 0.2
      : state === "listening"
      ? 0.22 + activityLevel * 0.12
      : 0.16;

  target.position.set(
    Math.cos(angle + ratio * Math.PI * 2) * radius,
    config.vertical * 1.36 + Math.sin(angle * 1.16 + config.phase) * 0.28,
    -0.72 + frontHemisphereWave(angle + config.tilt) * 1.3 + depthLift
  );
  target.rotation.set(angle * 0.32, angle * 0.58 + config.tilt, angle * 0.18);
  target.scale.setScalar(config.scale * (1 + activityLevel * 0.08));
}

function setFrontTarget(target, config, index, count, state, time, activityLevel) {
  const ratio = count <= 1 ? 0 : index / (count - 1);
  const spread = (ratio - 0.5) * Math.PI;
  const drift = time * (0.34 + config.speed * 0.3) + config.phase;

  switch (state) {
    case "listening": {
      target.position.set(
        Math.sin(spread) * 0.64,
        Math.cos(drift * 1.3) * 0.12 + config.vertical * 0.12,
        1.28 + frontHemisphereWave(drift + config.tilt) * 0.2 + activityLevel * 0.14
      );
      target.rotation.set(config.tilt * 0.16, drift, spread * 0.3);
      target.scale.setScalar(config.scale * (1.06 + activityLevel * 0.22));
      return;
    }
    case "thinking": {
      target.position.set(
        (index % 4) * 0.32 - 0.48 + Math.sin(drift) * 0.05,
        Math.floor(index / 4) * 0.28 - 0.16 + Math.cos(drift * 1.2) * 0.05,
        1.08 + Math.sin(drift * 0.8) * 0.12
      );
      target.rotation.set(drift * 0.8, drift * 1.1, config.tilt);
      target.scale.setScalar(config.scale * 0.98);
      return;
    }
    case "speaking": {
      target.position.set(
        Math.sin(spread) * 0.98,
        Math.cos(drift * 1.5) * 0.16 + config.vertical * 0.14,
        1.42 + frontHemisphereWave(spread * 1.4 + config.phase) * 0.24 + activityLevel * 0.22
      );
      target.rotation.set(config.tilt * 0.18, drift * 1.2, spread * 0.42);
      target.scale.setScalar(config.scale * (1.12 + activityLevel * 0.28));
      return;
    }
    case "interrupted": {
      target.position.set(
        Math.sin(spread * 1.2) * 0.88 + Math.sin(time * 8 + config.phase) * 0.08,
        config.vertical * 0.26 + Math.cos(time * 9 + config.tilt) * 0.08,
        1.12 + Math.sin(drift * 1.4) * 0.14
      );
      target.rotation.set(drift * 1.4, drift * 1.1, config.tilt * 0.6);
      target.scale.setScalar(config.scale * 0.94);
      return;
    }
    case "idle":
    default: {
      target.position.set(
        Math.sin(spread) * 0.76,
        Math.cos(drift * 1.1) * 0.14 + config.vertical * 0.16,
        1.18 + frontHemisphereWave(drift + config.tilt) * 0.2
      );
      target.rotation.set(config.tilt * 0.14, drift * 0.92, spread * 0.28);
      target.scale.setScalar(config.scale * (1.04 + activityLevel * 0.16));
    }
  }
}

function ClusteredCubeAvatar({
  state,
  inputEnergy,
  speechEnergy,
  mouthOpen,
  reducedMotion
}) {
  const palette = PALETTES[state] ?? PALETTES.idle;
  const target = TARGETS[state] ?? TARGETS.idle;

  const rootRef = useRef(null);
  const shellRef = useRef(null);
  const coreRef = useRef(null);
  const auraRef = useRef(null);
  const orbitInnerRef = useRef(null);
  const orbitOuterRef = useRef(null);
  const inputRingRef = useRef(null);
  const signalBeamRef = useRef(null);
  const signalBarsRef = useRef([]);
  const thinkingFrameRef = useRef(null);
  const mediumLayerRef = useRef(null);
  const outerLayerRef = useRef(null);
  const distantLayerRef = useRef(null);
  const frontLayerRef = useRef(null);
  const distantLinkLayerRef = useRef(null);

  const shellMaterial = useMemo(() => createHologramMaterial(), []);
  const outerEdgeMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(palette.hologram),
        transparent: true,
        opacity: 0.84,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [palette.hologram]
  );
  const innerEdgeMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(palette.accent),
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [palette.accent]
  );
  const thinkingFrameMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: new THREE.Color(palette.rim),
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      }),
    [palette.rim]
  );

  const outerEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(1.48, 1.48, 1.48)), []);
  const innerEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(0.78, 0.78, 0.78)), []);
  const thinkingEdges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(2.54, 2.54, 2.54)), []);

  const frontConfigs = useMemo(() => createLayerConfigs(8, 250, 0.2, 0.3), []);
  const mediumConfigs = useMemo(() => createLayerConfigs(12, 0, 0.28, 0.42), []);
  const outerConfigs = useMemo(() => createLayerConfigs(32, 100, 0.1, 0.18), []);
  const distantConfigs = useMemo(() => createLayerConfigs(28, 400, 0.04, 0.09), []);
  const distantLinkCount = 8;
  const frontStatesRef = useRef(null);
  const mediumStatesRef = useRef(null);
  const outerStatesRef = useRef(null);
  const distantStatesRef = useRef(null);
  const tempObject = useMemo(() => new THREE.Object3D(), []);
  const targetTransform = useMemo(
    () => ({
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      scale: new THREE.Vector3(1, 1, 1)
    }),
    []
  );
  const tempColor = useMemo(() => new THREE.Color(), []);
  const baseColor = useMemo(() => new THREE.Color(palette.hologram), [palette.hologram]);
  const accentColor = useMemo(() => new THREE.Color(palette.accent), [palette.accent]);
  const tempVectorA = useMemo(() => new THREE.Vector3(), []);
  const tempVectorB = useMemo(() => new THREE.Vector3(), []);

  const smooth = useRef({
    input: 0,
    speech: 0,
    activity: 0,
    scale: target.scale,
    brightness: target.brightness,
    glitch: target.glitch
  });

  if (!frontStatesRef.current) {
    frontStatesRef.current = createInstanceStates(frontConfigs);
  }
  if (!mediumStatesRef.current) {
    mediumStatesRef.current = createInstanceStates(mediumConfigs);
  }
  if (!outerStatesRef.current) {
    outerStatesRef.current = createInstanceStates(outerConfigs);
  }
  if (!distantStatesRef.current) {
    distantStatesRef.current = createInstanceStates(distantConfigs);
  }

  useEffect(() => {
    if (frontLayerRef.current) {
      frontLayerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (mediumLayerRef.current) {
      mediumLayerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (outerLayerRef.current) {
      outerLayerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (distantLayerRef.current) {
      distantLayerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    if (distantLinkLayerRef.current) {
      distantLinkLayerRef.current.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
  }, []);

  useEffect(() => {
    return () => {
      shellMaterial.dispose();
      outerEdgeMaterial.dispose();
      innerEdgeMaterial.dispose();
      thinkingFrameMaterial.dispose();
      outerEdges.dispose();
      innerEdges.dispose();
      thinkingEdges.dispose();
    };
  }, [
    innerEdgeMaterial,
    innerEdges,
    outerEdgeMaterial,
    outerEdges,
    shellMaterial,
    thinkingEdges,
    thinkingFrameMaterial
  ]);

  useFrame(({ clock }, delta) => {
    const time = clock.getElapsedTime();
    const motionScale = reducedMotion ? 0.4 : 1;

    const micLevel = readReactiveValue(inputEnergy);
    const speechLevel = Math.max(readReactiveValue(speechEnergy), readReactiveValue(mouthOpen) * 0.9);
    const activityLevel =
      state === "listening"
        ? micLevel
        : state === "speaking"
        ? speechLevel
        : Math.max(micLevel * 0.4, speechLevel * 0.6);

    const s = smooth.current;
    s.input = THREE.MathUtils.lerp(s.input, micLevel, 0.16);
    s.speech = THREE.MathUtils.lerp(s.speech, speechLevel, 0.16);
    s.activity = THREE.MathUtils.lerp(s.activity, activityLevel, 0.12);
    s.scale = THREE.MathUtils.lerp(s.scale, target.scale + activityLevel * 0.05, 0.08);
    s.brightness = THREE.MathUtils.lerp(s.brightness, target.brightness + activityLevel * 0.18, 0.08);
    s.glitch = THREE.MathUtils.lerp(
      s.glitch,
      target.glitch + (state === "thinking" ? Math.sin(time * 2.5) * 0.02 : 0),
      0.08
    );

    if (rootRef.current) {
      rootRef.current.rotation.x = THREE.MathUtils.lerp(rootRef.current.rotation.x, target.tiltX, 0.08);
      rootRef.current.rotation.y = THREE.MathUtils.lerp(rootRef.current.rotation.y, target.tiltY, 0.08);
      rootRef.current.position.y = Math.sin(time * 1.02) * 0.08 * motionScale;
      rootRef.current.scale.setScalar(s.scale);
    }

    if (shellRef.current) {
      shellRef.current.scale.setScalar(1.01 + s.activity * 0.028);
    }

    if (coreRef.current) {
      coreRef.current.rotation.y = time * 0.1 * motionScale;
      coreRef.current.rotation.x = Math.sin(time * 0.48) * 0.06 * motionScale;
    }

    if (auraRef.current) {
      auraRef.current.material.opacity = 0.12 + s.activity * 0.12;
      auraRef.current.scale.setScalar(1.04 + s.activity * 0.08);
    }

    if (orbitInnerRef.current) {
      orbitInnerRef.current.rotation.z = time * 0.26 * motionScale;
      orbitInnerRef.current.material.opacity = 0.14 + s.activity * 0.14;
      orbitInnerRef.current.scale.setScalar(1 + s.activity * 0.04);
    }

    if (orbitOuterRef.current) {
      orbitOuterRef.current.rotation.z = -time * 0.18 * motionScale;
      orbitOuterRef.current.material.opacity = 0.08 + s.activity * 0.1;
      orbitOuterRef.current.scale.setScalar(1 + s.activity * 0.06);
    }

    if (inputRingRef.current) {
      const visible = state === "listening" ? 1 : 0.18;
      inputRingRef.current.material.opacity = 0.04 + visible * (0.08 + s.input * 0.24);
      inputRingRef.current.scale.setScalar(1 + s.input * 0.16);
      inputRingRef.current.rotation.z = time * 0.42 * motionScale;
    }

    if (signalBeamRef.current) {
      const beamLevel = state === "speaking" ? s.speech : state === "listening" ? s.input * 0.35 : 0;
      signalBeamRef.current.material.opacity = 0.02 + beamLevel * 0.24;
      signalBeamRef.current.scale.x = 1 + beamLevel * 0.34;
    }

    for (const [index, bar] of signalBarsRef.current.entries()) {
      if (!bar) continue;
      const beamLevel = state === "speaking" ? s.speech : state === "listening" ? s.input * 0.42 : 0.08;
      const phase = time * 5.4 + index * 0.6;
      bar.scale.y = 0.6 + beamLevel * 2 + Math.sin(phase) * 0.18;
      bar.material.opacity = 0.08 + beamLevel * 0.26;
    }

    if (thinkingFrameRef.current) {
      thinkingFrameRef.current.rotation.z = time * 0.16 * motionScale;
      thinkingFrameRef.current.material.opacity =
        state === "thinking" ? 0.16 + s.activity * 0.14 : 0.04 + s.activity * 0.04;
      const frameScale = state === "thinking" ? 1.02 + Math.sin(time * 1.8) * 0.03 : 0.98;
      thinkingFrameRef.current.scale.setScalar(frameScale);
    }

    shellMaterial.uniforms.time.value += delta;
    shellMaterial.uniforms.fresnelAmount.value = 0.74 + s.activity * 0.12;
    shellMaterial.uniforms.scanlineSize.value = target.scanlineSize;
    shellMaterial.uniforms.hologramBrightness.value = s.brightness;
    shellMaterial.uniforms.signalSpeed.value = target.signalSpeed;
    shellMaterial.uniforms.energy.value = s.activity;
    shellMaterial.uniforms.glitchAmount.value = Math.max(0.02, s.glitch);
    shellMaterial.uniforms.opacity.value = 0.66 + s.activity * 0.12;
    shellMaterial.uniforms.hologramColor.value.set(palette.hologram);
    shellMaterial.uniforms.accentColor.value.set(palette.accent);

    if (frontLayerRef.current) {
      for (let index = 0; index < frontConfigs.length; index += 1) {
        const config = frontConfigs[index];
        const current = frontStatesRef.current[index];
        setFrontTarget(targetTransform, config, index, frontConfigs.length, state, time, s.activity);

        current.position.lerp(targetTransform.position, 0.1);
        current.rotation.x = THREE.MathUtils.lerp(current.rotation.x, targetTransform.rotation.x, 0.12);
        current.rotation.y = THREE.MathUtils.lerp(current.rotation.y, targetTransform.rotation.y, 0.12);
        current.rotation.z = THREE.MathUtils.lerp(current.rotation.z, targetTransform.rotation.z, 0.12);
        current.scale.lerp(targetTransform.scale, 0.12);

        tempObject.position.copy(current.position);
        tempObject.rotation.copy(current.rotation);
        tempObject.scale.copy(current.scale);
        tempObject.updateMatrix();
        frontLayerRef.current.setMatrixAt(index, tempObject.matrix);

        tempColor.copy(baseColor).lerp(accentColor, 0.2 + config.tintMix * 0.44 + s.activity * 0.16);
        frontLayerRef.current.setColorAt(index, tempColor);
      }

      frontLayerRef.current.instanceMatrix.needsUpdate = true;
      if (frontLayerRef.current.instanceColor) {
        frontLayerRef.current.instanceColor.needsUpdate = true;
      }
      frontLayerRef.current.material.opacity = 0.24 + s.activity * 0.12;
    }

    if (mediumLayerRef.current) {
      for (let index = 0; index < mediumConfigs.length; index += 1) {
        const config = mediumConfigs[index];
        const current = mediumStatesRef.current[index];
        setMediumTarget(targetTransform, config, index, state, time, s.activity, target.mediumRadius);

        current.position.lerp(targetTransform.position, 0.09);
        current.rotation.x = THREE.MathUtils.lerp(current.rotation.x, targetTransform.rotation.x, 0.1);
        current.rotation.y = THREE.MathUtils.lerp(current.rotation.y, targetTransform.rotation.y, 0.1);
        current.rotation.z = THREE.MathUtils.lerp(current.rotation.z, targetTransform.rotation.z, 0.1);
        current.scale.lerp(targetTransform.scale, 0.1);

        tempObject.position.copy(current.position);
        tempObject.rotation.copy(current.rotation);
        tempObject.scale.copy(current.scale);
        tempObject.updateMatrix();
        mediumLayerRef.current.setMatrixAt(index, tempObject.matrix);

        tempColor.copy(baseColor).lerp(accentColor, config.tintMix * 0.52 + s.activity * 0.18);
        mediumLayerRef.current.setColorAt(index, tempColor);
      }

      mediumLayerRef.current.instanceMatrix.needsUpdate = true;
      if (mediumLayerRef.current.instanceColor) {
        mediumLayerRef.current.instanceColor.needsUpdate = true;
      }
      mediumLayerRef.current.material.opacity = 0.24 + s.activity * 0.14;
    }

    if (outerLayerRef.current) {
      for (let index = 0; index < outerConfigs.length; index += 1) {
        const config = outerConfigs[index];
        const current = outerStatesRef.current[index];
        setOuterTarget(
          targetTransform,
          config,
          index,
          outerConfigs.length,
          state,
          time,
          s.activity,
          target.outerRadius
        );

        current.position.lerp(targetTransform.position, 0.08);
        current.rotation.x = THREE.MathUtils.lerp(current.rotation.x, targetTransform.rotation.x, 0.12);
        current.rotation.y = THREE.MathUtils.lerp(current.rotation.y, targetTransform.rotation.y, 0.12);
        current.rotation.z = THREE.MathUtils.lerp(current.rotation.z, targetTransform.rotation.z, 0.12);
        current.scale.lerp(targetTransform.scale, 0.12);

        tempObject.position.copy(current.position);
        tempObject.rotation.copy(current.rotation);
        tempObject.scale.copy(current.scale);
        tempObject.updateMatrix();
        outerLayerRef.current.setMatrixAt(index, tempObject.matrix);

        tempColor.copy(accentColor).lerp(baseColor, config.tintMix * 0.72);
        outerLayerRef.current.setColorAt(index, tempColor);
      }

      outerLayerRef.current.instanceMatrix.needsUpdate = true;
      if (outerLayerRef.current.instanceColor) {
        outerLayerRef.current.instanceColor.needsUpdate = true;
      }
      outerLayerRef.current.material.opacity = 0.16 + s.activity * 0.08;
    }

    if (distantLayerRef.current) {
      for (let index = 0; index < distantConfigs.length; index += 1) {
        const config = distantConfigs[index];
        const current = distantStatesRef.current[index];
        setDistantTarget(targetTransform, config, index, distantConfigs.length, state, time, s.activity);

        current.position.lerp(targetTransform.position, 0.05);
        current.rotation.x = THREE.MathUtils.lerp(current.rotation.x, targetTransform.rotation.x, 0.06);
        current.rotation.y = THREE.MathUtils.lerp(current.rotation.y, targetTransform.rotation.y, 0.06);
        current.rotation.z = THREE.MathUtils.lerp(current.rotation.z, targetTransform.rotation.z, 0.06);
        current.scale.lerp(targetTransform.scale, 0.08);

        tempObject.position.copy(current.position);
        tempObject.rotation.copy(current.rotation);
        tempObject.scale.copy(current.scale);
        tempObject.updateMatrix();
        distantLayerRef.current.setMatrixAt(index, tempObject.matrix);

        tempColor.copy(baseColor).lerp(accentColor, 0.24 + config.tintMix * 0.4);
        distantLayerRef.current.setColorAt(index, tempColor);
      }

      distantLayerRef.current.instanceMatrix.needsUpdate = true;
      if (distantLayerRef.current.instanceColor) {
        distantLayerRef.current.instanceColor.needsUpdate = true;
      }
      distantLayerRef.current.material.opacity = 0.08 + s.activity * 0.04;
    }

    if (distantLinkLayerRef.current) {
      for (let index = 0; index < distantLinkCount; index += 1) {
        const current = distantStatesRef.current[index];
        tempVectorA.copy(current.position).multiplyScalar(0.54);
        tempVectorB.copy(current.position);
        tempObject.position.copy(tempVectorA).lerp(tempVectorB, 0.5);
        tempObject.lookAt(tempVectorB);
        tempObject.scale.set(0.01, 0.01, Math.max(0.18, tempVectorA.distanceTo(tempVectorB)));
        tempObject.updateMatrix();
        distantLinkLayerRef.current.setMatrixAt(index, tempObject.matrix);

        tempColor.copy(baseColor).lerp(accentColor, 0.36 + index * 0.04);
        distantLinkLayerRef.current.setColorAt(index, tempColor);
      }

      distantLinkLayerRef.current.instanceMatrix.needsUpdate = true;
      if (distantLinkLayerRef.current.instanceColor) {
        distantLinkLayerRef.current.instanceColor.needsUpdate = true;
      }
      distantLinkLayerRef.current.material.opacity = 0.04 + s.activity * 0.02;
    }
  });

  return (
    <>
      <fog attach="fog" args={["#eef5ff", 8, 15]} />
      <perspectiveCamera makeDefault position={[0, 0.1, 6.1]} fov={28} />
      <ambientLight intensity={1.04} />
      <directionalLight position={[3.4, 4.4, 6]} intensity={1.16} color={palette.rim} />
      <pointLight position={[-3.2, 2.2, 3.4]} intensity={2.1} color={palette.hologram} />
      <pointLight position={[2.8, -1.6, 3.1]} intensity={1.42} color={palette.accent} />

      <group ref={rootRef}>
        <mesh ref={auraRef} position={[0, 0, -1.08]} renderOrder={0}>
          <planeGeometry args={[5.2, 5.2]} />
          <meshBasicMaterial
            color={palette.glow}
            transparent
            opacity={0.12}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <mesh ref={orbitOuterRef} rotation={[0.34, 0.42, Math.PI / 6]} renderOrder={1}>
          <torusGeometry args={[1.82, 0.016, 12, 128]} />
          <meshBasicMaterial
            color={palette.accent}
            transparent
            opacity={0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <mesh ref={orbitInnerRef} rotation={[0.16, -0.28, Math.PI / 4]} renderOrder={1}>
          <torusGeometry args={[1.42, 0.014, 12, 128]} />
          <meshBasicMaterial
            color={palette.hologram}
            transparent
            opacity={0.14}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <instancedMesh
          ref={distantLayerRef}
          args={[null, null, distantConfigs.length]}
          frustumCulled={false}
          renderOrder={2}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            vertexColors
            transparent
            opacity={0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh
          ref={distantLinkLayerRef}
          args={[null, null, distantLinkCount]}
          frustumCulled={false}
          renderOrder={2}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            vertexColors
            transparent
            opacity={0.04}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh ref={outerLayerRef} args={[null, null, outerConfigs.length]} frustumCulled={false} renderOrder={3}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            vertexColors
            transparent
            opacity={0.16}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh ref={mediumLayerRef} args={[null, null, mediumConfigs.length]} frustumCulled={false} renderOrder={4}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            vertexColors
            transparent
            opacity={0.26}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>

        <instancedMesh ref={frontLayerRef} args={[null, null, frontConfigs.length]} frustumCulled={false} renderOrder={8}>
          <boxGeometry args={[1, 1, 1]} />
          <meshBasicMaterial
            color="#ffffff"
            vertexColors
            transparent
            opacity={0.3}
            depthTest={false}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </instancedMesh>

        <lineSegments geometry={outerEdges} material={outerEdgeMaterial} renderOrder={6} />

        <mesh ref={shellRef} renderOrder={5}>
          <boxGeometry args={[1.48, 1.48, 1.48]} />
          <primitive attach="material" object={shellMaterial} />
        </mesh>

        <mesh ref={coreRef} renderOrder={5}>
          <boxGeometry args={[0.78, 0.78, 0.78]} />
          <meshPhysicalMaterial
            color={palette.core}
            transparent
            opacity={0.24}
            roughness={0.08}
            metalness={0.02}
            clearcoat={1}
            clearcoatRoughness={0.12}
            transmission={0.12}
            thickness={0.8}
            emissive={palette.hologram}
            emissiveIntensity={0.12}
            depthWrite={false}
          />
        </mesh>

        <mesh ref={inputRingRef} rotation={[Math.PI / 2, 0, 0]} renderOrder={7}>
          <torusGeometry args={[0.9, 0.024, 16, 120]} />
          <meshBasicMaterial
            color={palette.hologram}
            transparent
            opacity={0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        <mesh ref={signalBeamRef} position={[0, -0.02, 0.9]} scale={[1, 1, 1]} renderOrder={8}>
          <planeGeometry args={[0.92, 0.2]} />
          <meshBasicMaterial
            color={palette.hologram}
            transparent
            opacity={0.02}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>

        {[-0.24, 0, 0.24].map((x, index) => (
          <mesh
            key={x}
            ref={(node) => {
              signalBarsRef.current[index] = node;
            }}
            position={[x, -0.02, 1.02]}
            scale={[0.08, 0.6, 0.02]}
            renderOrder={9}
          >
            <boxGeometry args={[1, 1, 1]} />
            <meshBasicMaterial
              color={index === 1 ? palette.rim : palette.accent}
              transparent
              opacity={0.12}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        ))}

        <lineSegments ref={thinkingFrameRef} geometry={thinkingEdges} material={thinkingFrameMaterial} renderOrder={7} />
        <lineSegments geometry={innerEdges} material={innerEdgeMaterial} renderOrder={7} />
      </group>
    </>
  );
}

export function AgentAvatar({
  state = "idle",
  inputEnergy = 0,
  mouthOpen = 0,
  speechEnergy = 0,
  reducedMotion = false
}) {
  const safeState = TARGETS[state] ? state : "idle";

  return (
    <div
      className="relative flex items-center justify-center pointer-events-none"
      style={{ width: "min(700px, 76vh)", height: "min(700px, 76vh)" }}
    >
      <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,rgba(103,221,255,0.18)_0%,rgba(155,147,255,0.12)_34%,rgba(255,255,255,0)_76%)] blur-3xl" />
      <Canvas
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
        style={{ background: "transparent" }}
      >
        <ClusteredCubeAvatar
          state={safeState}
          inputEnergy={inputEnergy}
          mouthOpen={mouthOpen}
          speechEnergy={speechEnergy}
          reducedMotion={reducedMotion}
        />
      </Canvas>
    </div>
  );
}
