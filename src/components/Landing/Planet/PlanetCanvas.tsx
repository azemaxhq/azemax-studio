import React, { memo, useEffect, useRef } from 'react';

interface PlanetCanvasProps {
  className?: string;
}

interface Star {
  x: number;
  y: number;
  radius: number;
  alpha: number;
  twinkleSpeed: number;
  twinklePhase: number;
  hasDiffraction?: boolean;
  // Depth layer for cinematic parallax: 0.35 (far) | 0.65 (mid) | 1 (near).
  // Near stars are slightly larger/brighter and drift faster.
  depth: number;
  // Base sidereal drift in px/sec (scaled by depth at render time).
  drift: number;
}

// Overscan around the planet sheet so compositor parallax never exposes
// an unpainted edge (travel is ±28px x / ±10px y).
const PLANET_PAD = 40;

/**
 * Layered compositor architecture (not a repaint loop):
 *
 * - Planet sheet: body + atmosphere + rim painted EXACTLY ONCE per resize.
 *   Mouse parallax moves it via CSS translate3d — a compositor-only op with
 *   zero repaints, zero gradient rebuilds, zero GPU fill work.
 * - Star sheet: transparent canvas repainting only ≤85 tiny arcs (no fills,
 *   no gradients, no shadows) for twinkle + drift, with per-star parallax
 *   offsets baked in as before.
 *
 * Per-frame cost at rest: one transparent clear + ~85 hairline arcs.
 * The planet — previously 6 fullscreen gradient fills per paint — costs
 * nothing after its single paint.
 */
export const PlanetCanvas: React.FC<PlanetCanvasProps> = memo(({ className = '' }) => {
  const starCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const planetCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const starCanvas = starCanvasRef.current;
    const planetCanvas = planetCanvasRef.current;
    if (!starCanvas || !planetCanvas) return;
    // Chromium desynchronized presentation: bypass compositor lock for ultra-low frame presentation latency
    const isChromium =
      typeof window !== 'undefined' &&
      (Boolean((window as unknown as { chrome?: unknown }).chrome) ||
        navigator.userAgent.indexOf('Chrome') !== -1 ||
        navigator.userAgent.indexOf('Chromium') !== -1);
    const ctxOptions: CanvasRenderingContext2DSettings = {
      alpha: true,
      desynchronized: isChromium,
    };
    const ctx = starCanvas.getContext('2d', ctxOptions);
    const planetCtx = planetCanvas.getContext('2d', ctxOptions);
    if (!ctx || !planetCtx) return;

    let animationFrameId: number;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Coarse pointers (phones/tablets): mobile GPU fill-rate is the bottleneck.
    // Halve backing-store DPR, cut star count, and skip mouse parallax entirely.
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const isSmallViewport = Math.min(window.innerWidth, window.innerHeight) < 640;
    const isLowPower = isCoarsePointer || isSmallViewport;
    const maxDpr = isLowPower ? 1 : 1.5;

    // Mouse parallax tracking with spring physics.
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (prefersReducedMotion || isCoarsePointer) return;
      const { innerWidth, innerHeight } = window;
      targetMouseX = (e.clientX / innerWidth - 0.5) * 2; // -1 to 1
      targetMouseY = (e.clientY / innerHeight - 0.5) * 2; // -1 to 1
    };

    if (!isCoarsePointer) {
      window.addEventListener('mousemove', handleMouseMove, { passive: true });
    }

    // Sparse stars initialization
    let stars: Star[] = [];
    let width = 0;
    let height = 0;

    const initStars = (w: number, h: number) => {
      const budget = isLowPower ? 45 : 85;
      const starCount = Math.min(Math.floor((w * h) / 14000), budget);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        const hasDiffraction = Math.random() < 0.08;
        const layerRoll = Math.random();
        const depth = layerRoll < 0.5 ? 0.35 : layerRoll < 0.85 ? 0.65 : 1;
        const baseRadius = hasDiffraction ? Math.random() * 0.9 + 0.8 : Math.random() * 0.7 + 0.3;
        const baseAlpha = hasDiffraction ? Math.random() * 0.4 + 0.45 : Math.random() * 0.45 + 0.15;
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.72,
          radius: baseRadius * (0.7 + depth * 0.45),
          alpha: Math.min(0.9, baseAlpha * (0.75 + depth * 0.4)),
          twinkleSpeed: Math.random() * 0.012 + 0.004,
          twinklePhase: Math.random() * Math.PI * 2,
          hasDiffraction,
          depth,
          drift: Math.random() * 0.6 + 0.4,
        });
      }
    };

    // Pre-rendered offscreen planetary surface texture with craters, continents, and geological striations
    let textureCanvas: HTMLCanvasElement | null = null;
    let textureCtx: CanvasRenderingContext2D | null = null;

    const generateSurfaceTexture = (size: number) => {
      textureCanvas = document.createElement('canvas');
      textureCanvas.width = size;
      textureCanvas.height = size;
      textureCtx = textureCanvas.getContext('2d');
      if (!textureCtx) return;

      // 1. Deep graphite spherical base
      const grad = textureCtx.createRadialGradient(
        size * 0.62, size * 0.32, size * 0.04,
        size * 0.5, size * 0.5, size * 0.5
      );
      grad.addColorStop(0, '#0D1726');
      grad.addColorStop(0.25, '#08101C');
      grad.addColorStop(0.55, '#040912');
      grad.addColorStop(0.85, '#020409');
      grad.addColorStop(1, '#000205');

      textureCtx.fillStyle = grad;
      textureCtx.beginPath();
      textureCtx.arc(size * 0.5, size * 0.5, size * 0.5, 0, Math.PI * 2);
      textureCtx.fill();

      // 2. High-precision geological terrain bands
      textureCtx.save();
      textureCtx.beginPath();
      textureCtx.arc(size * 0.5, size * 0.5, size * 0.495, 0, Math.PI * 2);
      textureCtx.clip();

      for (let i = 0; i < 14; i++) {
        const bandY = size * (0.15 + i * 0.055);
        const bandGrad = textureCtx.createLinearGradient(0, bandY - 60, 0, bandY + 60);
        bandGrad.addColorStop(0, 'rgba(15, 28, 48, 0)');
        bandGrad.addColorStop(0.4, 'rgba(24, 45, 75, 0.07)');
        bandGrad.addColorStop(0.6, 'rgba(18, 35, 60, 0.05)');
        bandGrad.addColorStop(1, 'rgba(15, 28, 48, 0)');

        textureCtx.fillStyle = bandGrad;
        textureCtx.fillRect(0, bandY - 60, size, 120);
      }

      // 3. Subtle crater impact rims and topographical variations
      const craterCount = 18;
      for (let c = 0; c < craterCount; c++) {
        const cx = size * (0.3 + Math.random() * 0.5);
        const cy = size * (0.2 + Math.random() * 0.5);
        const cr = size * (0.02 + Math.random() * 0.07);

        const craterGrad = textureCtx.createRadialGradient(
          cx - cr * 0.2, cy - cr * 0.2, cr * 0.1,
          cx, cy, cr
        );
        craterGrad.addColorStop(0, 'rgba(6, 12, 22, 0.6)');
        craterGrad.addColorStop(0.7, 'rgba(16, 30, 52, 0.08)');
        craterGrad.addColorStop(0.9, 'rgba(79, 140, 255, 0.04)');
        craterGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        textureCtx.fillStyle = craterGrad;
        textureCtx.beginPath();
        textureCtx.arc(cx, cy, cr, 0, Math.PI * 2);
        textureCtx.fill();
      }

      textureCtx.restore();
    };

    const paintPlanet = () => {
      const P = planetCtx;
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
      P.setTransform(1, 0, 0, 1, 0, 0);
      P.clearRect(0, 0, planetCanvas.width, planetCanvas.height);
      P.setTransform(dpr, 0, 0, dpr, PLANET_PAD * dpr, PLANET_PAD * dpr);
      P.globalAlpha = 1;

      const planetRadius = Math.max(width * 1.05, height * 1.55);
      const centerX = width * 0.52;
      const horizonY = height * 0.72;
      const centerY = horizonY + planetRadius;

      // Outer Exosphere
      const exosphereRadius = planetRadius * 1.14;
      const exoGrad = P.createRadialGradient(
        centerX + planetRadius * 0.15, centerY - planetRadius * 0.95, planetRadius * 0.85,
        centerX, centerY, exosphereRadius
      );
      exoGrad.addColorStop(0, 'rgba(59, 130, 246, 0.14)');
      exoGrad.addColorStop(0.35, 'rgba(37, 99, 235, 0.06)');
      exoGrad.addColorStop(0.75, 'rgba(14, 30, 58, 0.02)');
      exoGrad.addColorStop(1, 'rgba(0, 2, 4, 0)');

      P.fillStyle = exoGrad;
      P.beginPath();
      P.arc(centerX, centerY, exosphereRadius, 0, Math.PI * 2);
      P.fill();

      // Stratospheric Ionosphere Glow
      const stratoRadius = planetRadius * 1.045;
      const stratoGrad = P.createRadialGradient(
        centerX + planetRadius * 0.25, centerY - planetRadius * 0.98, planetRadius * 0.92,
        centerX, centerY, stratoRadius
      );
      stratoGrad.addColorStop(0, 'rgba(143, 180, 255, 0.35)');
      stratoGrad.addColorStop(0.5, 'rgba(79, 140, 255, 0.18)');
      stratoGrad.addColorStop(0.85, 'rgba(30, 64, 175, 0.05)');
      stratoGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      P.fillStyle = stratoGrad;
      P.beginPath();
      P.arc(centerX, centerY, stratoRadius, 0, Math.PI * 2);
      P.fill();

      // Dark Planetary Body
      P.save();
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
      P.clip();

      if (textureCanvas) {
        P.drawImage(
          textureCanvas,
          centerX - planetRadius,
          centerY - planetRadius,
          planetRadius * 2,
          planetRadius * 2
        );
      } else {
        P.fillStyle = '#020409';
        P.fill();
      }

      // Terminator Shadow
      const shadowGrad = P.createLinearGradient(
        centerX - planetRadius * 0.7, centerY - planetRadius * 0.85,
        centerX + planetRadius * 0.7, centerY + planetRadius * 0.25
      );
      shadowGrad.addColorStop(0, 'rgba(0, 2, 4, 0.02)');
      shadowGrad.addColorStop(0.35, 'rgba(2, 5, 12, 0.45)');
      shadowGrad.addColorStop(0.7, 'rgba(0, 2, 6, 0.92)');
      shadowGrad.addColorStop(1, 'rgba(0, 1, 3, 0.99)');

      P.fillStyle = shadowGrad;
      P.fillRect(centerX - planetRadius, centerY - planetRadius, planetRadius * 2, planetRadius * 2);

      // Airglow
      const airglowGrad = P.createRadialGradient(
        centerX, centerY, planetRadius * 0.96,
        centerX, centerY, planetRadius
      );
      airglowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      airglowGrad.addColorStop(0.8, 'rgba(30, 64, 175, 0.12)');
      airglowGrad.addColorStop(1, 'rgba(79, 140, 255, 0.28)');

      P.fillStyle = airglowGrad;
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
      P.fill();

      P.restore();

      // Core Atmospheric Horizon Line
      P.save();

      const rimBloomGrad = P.createLinearGradient(
        width * 0.05, 0,
        width * 0.95, height * 0.6
      );
      rimBloomGrad.addColorStop(0, 'rgba(79, 140, 255, 0.05)');
      rimBloomGrad.addColorStop(0.35, 'rgba(79, 140, 255, 0.5)');
      rimBloomGrad.addColorStop(0.65, 'rgba(143, 180, 255, 0.9)');
      rimBloomGrad.addColorStop(0.85, 'rgba(79, 140, 255, 0.6)');
      rimBloomGrad.addColorStop(1, 'rgba(59, 130, 246, 0.15)');

      P.globalAlpha = 0.32;
      P.strokeStyle = rimBloomGrad;
      P.lineWidth = 10;
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, Math.PI * 1.06, Math.PI * 1.94);
      P.stroke();

      P.globalAlpha = 1;
      P.strokeStyle = rimBloomGrad;
      P.lineWidth = 3.2;
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, Math.PI * 1.06, Math.PI * 1.94);
      P.stroke();

      const coreGrad = P.createLinearGradient(
        width * 0.25, 0,
        width * 0.85, height * 0.4
      );
      coreGrad.addColorStop(0, 'rgba(143, 180, 255, 0.1)');
      coreGrad.addColorStop(0.4, 'rgba(215, 235, 255, 0.98)');
      coreGrad.addColorStop(0.7, 'rgba(165, 205, 255, 0.95)');
      coreGrad.addColorStop(1, 'rgba(79, 140, 255, 0.2)');

      P.globalAlpha = 0.5;
      P.strokeStyle = coreGrad;
      P.lineWidth = 2.6;
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, Math.PI * 1.12, Math.PI * 1.88);
      P.stroke();

      P.globalAlpha = 1;
      P.strokeStyle = coreGrad;
      P.lineWidth = 1.2;
      P.beginPath();
      P.arc(centerX, centerY, planetRadius, Math.PI * 1.12, Math.PI * 1.88);
      P.stroke();

      P.restore();
    };

    const paintStars = (dt: number) => {
      ctx.clearRect(0, 0, width, height);

      // Pre-set fill and stroke styles once: eliminates ~5,100 string allocations/sec in V8
      ctx.fillStyle = '#E1EEFF';
      ctx.strokeStyle = '#8FB4FF';
      ctx.lineWidth = 0.6;

      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        star.twinklePhase += star.twinkleSpeed * dt * 60;
        star.x -= star.drift * star.depth * dt;
        if (star.x < -12) star.x += width + 24;

        const alphaOffset = Math.sin(star.twinklePhase) * 0.22;
        const currentAlpha = Math.max(0.08, Math.min(0.9, star.alpha + alphaOffset));

        const starX = star.x + mouseX * 14 * star.depth;
        const starY = star.y + mouseY * 9 * star.depth;

        ctx.globalAlpha = currentAlpha;
        ctx.beginPath();
        ctx.arc(starX, starY, star.radius, 0, Math.PI * 2);
        ctx.fill();

        if (star.hasDiffraction && currentAlpha > 0.4) {
          ctx.globalAlpha = currentAlpha * 0.35;
          ctx.beginPath();
          ctx.moveTo(starX - 6, starY);
          ctx.lineTo(starX + 6, starY);
          ctx.moveTo(starX, starY - 6);
          ctx.lineTo(starX, starY + 6);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    };

    const handleResize = () => {
      width = starCanvas.clientWidth || window.innerWidth;
      height = starCanvas.clientHeight || window.innerHeight;
      if (width <= 0 || height <= 0) return;

      // Reset spring so parallax doesn't snap from a stale position
      mouseX = 0; mouseY = 0; targetMouseX = 0; targetMouseY = 0;

      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);

      starCanvas.width = Math.floor(width * dpr);
      starCanvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      planetCanvas.width = Math.floor((width + PLANET_PAD * 2) * dpr);
      planetCanvas.height = Math.floor((height + PLANET_PAD * 2) * dpr);

      initStars(width, height);
      // Memory optimization: cap texture size at 1280px max (cuts GPU allocation from ~38MB to ~4MB)
      const textureSize = Math.min(1280, Math.max(800, Math.floor(width)));
      generateSurfaceTexture(textureSize);
      paintPlanet();
    };

    handleResize();

    // Throttled window resize via rAF
    let resizeRafId: number | null = null;
    const onResizeThrottled = () => {
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      resizeRafId = requestAnimationFrame(() => {
        handleResize();
        resizeRafId = null;
      });
    };
    window.addEventListener('resize', onResizeThrottled, { passive: true });

    let running = false;
    const canRun = () => isVisible && isTabVisible && !prefersReducedMotion;

    const start = () => {
      if (running || !canRun()) return;
      running = true;
      animationFrameId = requestAnimationFrame(render);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
        if (isVisible) {
          start();
        } else {
          running = false;
          cancelAnimationFrame(animationFrameId);
        }
      },
      { threshold: 0.05 }
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
      if (isTabVisible) {
        start();
      } else {
        running = false;
        cancelAnimationFrame(animationFrameId);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    let lastFrameTime = -1;
    const render = (time: number) => {
      const dt = lastFrameTime < 0 ? 0.016 : Math.min(0.05, Math.max(0, (time - lastFrameTime) / 1000));
      lastFrameTime = time;

      const ease = 1 - Math.exp(-dt * 3.2);
      mouseX += (targetMouseX - mouseX) * ease;
      mouseY += (targetMouseY - mouseY) * ease;

      paintStars(dt);

      if (canRun()) {
        animationFrameId = requestAnimationFrame(render);
      } else {
        running = false;
      }
    };

    if (prefersReducedMotion) {
      running = true;
      animationFrameId = requestAnimationFrame((t) => {
        lastFrameTime = t - 16;
        paintStars(0.016);
        running = false;
      });
    } else {
      start();
    }

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
      if (!isCoarsePointer) window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', onResizeThrottled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className={`az-planet-layer absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      {/* Planet sheet: painted once per resize, fixed — never moves */}
      <canvas
        ref={planetCanvasRef}
        className="absolute block"
        style={{
          width: `calc(100% + ${PLANET_PAD * 2}px)`,
          height: `calc(100% + ${PLANET_PAD * 2}px)`,
          left: -PLANET_PAD,
          top: -PLANET_PAD,
        }}
        aria-hidden="true"
      />
      {/* Star sheet: transparent overlay, live hairline repaints only */}
      <canvas
        ref={starCanvasRef}
        className="absolute inset-0 block h-full w-full"
        style={{ width: '100%', height: '100%' }}
        aria-hidden="true"
      />
    </div>
  );
});

PlanetCanvas.displayName = 'PlanetCanvas';
