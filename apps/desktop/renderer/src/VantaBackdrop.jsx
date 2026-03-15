import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

const STATE_OPTS = {
  idle:        { baseColor: 0x6ea8ff, color2: 0xb49cff, amplitudeFactor: 0.55, size: 1.08, ringFactor: 0.9,  rotationFactor: 0.12 },
  listening:   { baseColor: 0x66d8ff, color2: 0x8fb6ff, amplitudeFactor: 0.72, size: 0.98, ringFactor: 1.02, rotationFactor: 0.18 },
  thinking:    { baseColor: 0x9d91ff, color2: 0xef8ce3, amplitudeFactor: 0.84, size: 0.94, ringFactor: 1.08, rotationFactor: 0.22 },
  speaking:    { baseColor: 0x71caff, color2: 0xbc8dff, amplitudeFactor: 0.96, size: 0.9,  ringFactor: 1.12, rotationFactor: 0.26 },
  interrupted: { baseColor: 0xffaa93, color2: 0x95d2ff, amplitudeFactor: 0.48, size: 1.02, ringFactor: 0.84, rotationFactor: 0.08 },
};

export function VantaBackdrop({ state, reducedMotion = false }) {
  const containerRef = useRef(null);
  const effectRef    = useRef(null);

  const options = useMemo(() => {
    const o  = STATE_OPTS[state] ?? STATE_OPTS.idle;
    const mf = reducedMotion ? 0.4 : 1;
    return {
      ...o,
      mouseControls:   !reducedMotion,
      touchControls:   false,
      gyroControls:    false,
      minHeight:       200,
      minWidth:        200,
      backgroundColor: 0xf8f9fa,   // ← light theme background
      backgroundAlpha: 1,
      amplitudeFactor: o.amplitudeFactor * mf,
    };
  }, [reducedMotion, state]);

  useEffect(() => {
    let mounted = true;

    if (!containerRef.current) return undefined;

    window.THREE = THREE;

    import("vanta/dist/vanta.halo.min.js")
      .then((module) => {
        if (!mounted || !containerRef.current) return;

        const haloFactory =
          module.default?.default ??
          module.default ??
          module._vantaEffect;

        if (typeof haloFactory !== "function") {
          throw new TypeError("Vanta HALO factory is not available");
        }

        effectRef.current = haloFactory({
          el: containerRef.current,
          THREE,
          ...options,
        });
      })
      .catch((error) => {
        console.warn("Failed to initialize Vanta backdrop", error);
      });

    return () => {
      mounted = false;
      effectRef.current?.destroy?.();
      effectRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    effectRef.current?.setOptions?.(options);
  }, [options]);

  return (
    <div
      ref={containerRef}
      aria-hidden="true"
      className="absolute inset-0 z-0 pointer-events-none"
    />
  );
}
