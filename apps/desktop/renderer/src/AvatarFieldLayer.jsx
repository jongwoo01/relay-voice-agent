import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

const STATE_PALETTES = {
  idle: { core: "#71b7ff", secondary: "#a18bff", accent: "#ff9277" },
  listening: { core: "#5bc6ff", secondary: "#91b8ff", accent: "#ffd4c9" },
  thinking: { core: "#9c92ff", secondary: "#ef8ce3", accent: "#ffae89" },
  speaking: { core: "#66d9ff", secondary: "#bc8dff", accent: "#ff9c80" },
  interrupted: { core: "#85d1ff", secondary: "#ff9e8f", accent: "#ffc0a0" }
};

function buildParticleCloud(count, innerRadius, outerRadius, spreadY) {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const angle = Math.random() * Math.PI * 2;
    const radius = innerRadius + Math.random() * (outerRadius - innerRadius);
    const y = (Math.random() - 0.5) * spreadY;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius * 0.32;

    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;

    const tint = 0.72 + Math.random() * 0.28;
    colors[offset] = tint;
    colors[offset + 1] = tint;
    colors[offset + 2] = 1;
  }

  return { positions, colors };
}

function HologramFieldScene({
  state,
  speechEnergy,
  fieldIntensity,
  glowIntensity,
  reducedMotion
}) {
  const palette = STATE_PALETTES[state];
  const fieldGroupRef = useRef(null);
  const primaryHaloRef = useRef(null);
  const secondaryHaloRef = useRef(null);
  const ringInnerRef = useRef(null);
  const ringOuterRef = useRef(null);
  const mistUpperRef = useRef(null);
  const mistLowerRef = useRef(null);
  const particlesPrimaryRef = useRef(null);
  const particlesSecondaryRef = useRef(null);

  const primaryCloud = useMemo(() => buildParticleCloud(220, 0.72, 1.36, 2.2), []);
  const secondaryCloud = useMemo(() => buildParticleCloud(150, 0.92, 1.74, 2.7), []);

  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    const motionScale = reducedMotion ? 0.34 : 1;
    const speech = speechEnergy.get();
    const field = fieldIntensity.get();
    const glow = glowIntensity.get();
    const combined = Math.min(1, field * 0.7 + glow * 0.3 + speech * 0.45);

    if (fieldGroupRef.current) {
      fieldGroupRef.current.rotation.z = time * 0.07 * motionScale;
      fieldGroupRef.current.rotation.x = Math.sin(time * 0.21) * 0.05 * motionScale;
      fieldGroupRef.current.position.y = Math.sin(time * 0.72) * 0.08 * motionScale;
    }

    if (primaryHaloRef.current) {
      primaryHaloRef.current.material.opacity = 0.12 + glow * 0.18 + speech * 0.08;
      primaryHaloRef.current.scale.setScalar(
        1.58 + combined * 0.24 + Math.sin(time * 1.2) * 0.03 * motionScale
      );
    }

    if (secondaryHaloRef.current) {
      secondaryHaloRef.current.material.opacity = 0.08 + glow * 0.12;
      secondaryHaloRef.current.scale.setScalar(
        1.94 + field * 0.28 + Math.cos(time * 0.9) * 0.025 * motionScale
      );
    }

    if (ringInnerRef.current) {
      ringInnerRef.current.rotation.z = time * 0.28 * motionScale;
      ringInnerRef.current.material.opacity = 0.12 + combined * 0.18;
      ringInnerRef.current.scale.setScalar(1.02 + speech * 0.05);
    }

    if (ringOuterRef.current) {
      ringOuterRef.current.rotation.z = -time * 0.18 * motionScale;
      ringOuterRef.current.material.opacity = 0.05 + field * 0.14;
      ringOuterRef.current.scale.setScalar(1.18 + glow * 0.08);
    }

    if (mistUpperRef.current) {
      mistUpperRef.current.material.opacity = 0.06 + glow * 0.08;
      mistUpperRef.current.position.y = 0.68 + Math.sin(time * 0.8) * 0.04 * motionScale;
      mistUpperRef.current.rotation.z = time * 0.09 * motionScale;
    }

    if (mistLowerRef.current) {
      mistLowerRef.current.material.opacity = 0.05 + field * 0.1;
      mistLowerRef.current.position.y = -0.74 + Math.cos(time * 0.7) * 0.04 * motionScale;
      mistLowerRef.current.rotation.z = -time * 0.06 * motionScale;
    }

    if (particlesPrimaryRef.current) {
      particlesPrimaryRef.current.rotation.z = time * 0.08 * motionScale;
      particlesPrimaryRef.current.rotation.y = time * 0.1 * motionScale;
      particlesPrimaryRef.current.material.opacity = 0.16 + combined * 0.18;
      particlesPrimaryRef.current.material.size = 0.03 + combined * 0.016;
    }

    if (particlesSecondaryRef.current) {
      particlesSecondaryRef.current.rotation.z = -time * 0.05 * motionScale;
      particlesSecondaryRef.current.rotation.x = time * 0.06 * motionScale;
      particlesSecondaryRef.current.material.opacity = 0.08 + glow * 0.14;
      particlesSecondaryRef.current.material.size = 0.02 + field * 0.012;
    }
  });

  return (
    <group ref={fieldGroupRef}>
      <mesh ref={secondaryHaloRef}>
        <circleGeometry args={[1.26, 64]} />
        <meshBasicMaterial
          color={palette.secondary}
          transparent
          opacity={0.14}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={primaryHaloRef}>
        <circleGeometry args={[0.98, 64]} />
        <meshBasicMaterial
          color={palette.core}
          transparent
          opacity={0.2}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={mistUpperRef} position={[0, 0.68, -0.2]}>
        <circleGeometry args={[0.74, 48]} />
        <meshBasicMaterial
          color={palette.secondary}
          transparent
          opacity={0.08}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={mistLowerRef} position={[0, -0.74, -0.18]}>
        <circleGeometry args={[0.88, 48]} />
        <meshBasicMaterial
          color={palette.accent}
          transparent
          opacity={0.06}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringInnerRef} rotation={[0, 0, Math.PI / 4]}>
        <torusGeometry args={[1.1, 0.012, 12, 96]} />
        <meshBasicMaterial
          color={palette.core}
          transparent
          opacity={0.16}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh ref={ringOuterRef} rotation={[0.2, 0.1, Math.PI / 8]}>
        <torusGeometry args={[1.36, 0.008, 12, 96]} />
        <meshBasicMaterial
          color={palette.secondary}
          transparent
          opacity={0.1}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <points ref={particlesPrimaryRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[primaryCloud.positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[primaryCloud.colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          vertexColors
          size={0.032}
          sizeAttenuation
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <points ref={particlesSecondaryRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[secondaryCloud.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={palette.accent}
          size={0.024}
          sizeAttenuation
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}

export default function AvatarFieldLayer(props) {
  return (
    <div className="agent-avatar-field" aria-hidden="true">
      <Canvas
        orthographic
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, 5], zoom: 126 }}
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <HologramFieldScene {...props} />
      </Canvas>
    </div>
  );
}
