import React, { useEffect, useRef } from 'react';

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
}

export const PlanetCanvas: React.FC<PlanetCanvasProps> = ({ className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let animationFrameId: number;
    let isVisible = true;
    let isTabVisible = !document.hidden;

    // Check prefers-reduced-motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Mouse parallax tracking with spring physics
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      if (prefersReducedMotion) return;
      const { innerWidth, innerHeight } = window;
      targetMouseX = (e.clientX / innerWidth - 0.5) * 2; // -1 to 1
      targetMouseY = (e.clientY / innerHeight - 0.5) * 2; // -1 to 1
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    // Sparse stars initialization
    let stars: Star[] = [];
    let width = 0;
    let height = 0;

    const initStars = (w: number, h: number) => {
      const starCount = Math.min(Math.floor((w * h) / 14000), 85);
      stars = [];
      for (let i = 0; i < starCount; i++) {
        // ~6% of stars have a microscopic optical diffraction cross (faint navigation stars)
        const hasDiffraction = Math.random() < 0.08;
        stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.72,
          radius: hasDiffraction ? Math.random() * 0.9 + 0.8 : Math.random() * 0.7 + 0.3,
          alpha: hasDiffraction ? Math.random() * 0.4 + 0.45 : Math.random() * 0.45 + 0.15,
          twinkleSpeed: Math.random() * 0.012 + 0.004,
          twinklePhase: Math.random() * Math.PI * 2,
          hasDiffraction,
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

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = canvas.clientWidth;
      height = canvas.clientHeight;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.scale(dpr, dpr);

      initStars(width, height);
      generateSurfaceTexture(Math.max(1400, Math.floor(width * 1.6)));
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    // Pause rendering when scrolled out of view or tab hidden
    const observer = new IntersectionObserver(
      (entries) => {
        isVisible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 }
    );
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    const handleVisibilityChange = () => {
      isTabVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Render loop
    const render = (_time: number) => {
      if (!isVisible || !isTabVisible) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Smooth mouse lerp
      if (!prefersReducedMotion) {
        mouseX += (targetMouseX - mouseX) * 0.035;
        mouseY += (targetMouseY - mouseY) * 0.035;
      }

      ctx.clearRect(0, 0, width, height);

      // 1. Render Sparse Background Space Stars with Realistic Twinkle & Diffraction
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        if (!prefersReducedMotion) {
          star.twinklePhase += star.twinkleSpeed;
        }
        const alphaOffset = Math.sin(star.twinklePhase) * 0.22;
        const currentAlpha = Math.max(0.08, Math.min(0.9, star.alpha + alphaOffset));

        // Parallax offset (stars move subtly opposite to camera motion)
        const starX = star.x + mouseX * 14;
        const starY = star.y + mouseY * 9;

        // Draw star core
        ctx.fillStyle = `rgba(225, 238, 255, ${currentAlpha})`;
        ctx.beginPath();
        ctx.arc(starX, starY, star.radius, 0, Math.PI * 2);
        ctx.fill();

        // Delicate optical cross for navigation stars
        if (star.hasDiffraction && currentAlpha > 0.4) {
          ctx.strokeStyle = `rgba(143, 180, 255, ${currentAlpha * 0.35})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath();
          ctx.moveTo(starX - 6, starY);
          ctx.lineTo(starX + 6, starY);
          ctx.moveTo(starX, starY - 6);
          ctx.lineTo(starX, starY + 6);
          ctx.stroke();
        }
      }

      // 2. Compute Enormous Planetary Horizon Geometry
      // Center is positioned well below the viewport, creating a vast natural horizon curve
      const planetRadius = Math.max(width * 1.05, height * 1.55);
      const centerX = width * 0.52 + mouseX * 28;
      const centerY = height + planetRadius * 0.72 + mouseY * 18;

      // 3. Render Multi-Pass Atmospheric Scattering (Rayleigh & Mie Scattering)
      
      // Pass A: Outer Diffuse Exosphere Haze (Soft blue dispersion extending into space)
      const exosphereRadius = planetRadius * 1.14;
      const exoGrad = ctx.createRadialGradient(
        centerX + planetRadius * 0.15, centerY - planetRadius * 0.95, planetRadius * 0.85,
        centerX, centerY, exosphereRadius
      );
      exoGrad.addColorStop(0, 'rgba(59, 130, 246, 0.14)');
      exoGrad.addColorStop(0.35, 'rgba(37, 99, 235, 0.06)');
      exoGrad.addColorStop(0.75, 'rgba(14, 30, 58, 0.02)');
      exoGrad.addColorStop(1, 'rgba(0, 2, 4, 0)');

      ctx.fillStyle = exoGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, exosphereRadius, 0, Math.PI * 2);
      ctx.fill();

      // Pass B: Stratospheric Ionosphere Glow (Grazing angle glow concentrated at horizon crest)
      const stratoRadius = planetRadius * 1.045;
      const stratoGrad = ctx.createRadialGradient(
        centerX + planetRadius * 0.25, centerY - planetRadius * 0.98, planetRadius * 0.92,
        centerX, centerY, stratoRadius
      );
      stratoGrad.addColorStop(0, 'rgba(143, 180, 255, 0.35)');
      stratoGrad.addColorStop(0.5, 'rgba(79, 140, 255, 0.18)');
      stratoGrad.addColorStop(0.85, 'rgba(30, 64, 175, 0.05)');
      stratoGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = stratoGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, stratoRadius, 0, Math.PI * 2);
      ctx.fill();

      // 4. Render Dark Planetary Body
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
      ctx.clip();

      if (textureCanvas) {
        ctx.drawImage(
          textureCanvas,
          centerX - planetRadius,
          centerY - planetRadius,
          planetRadius * 2,
          planetRadius * 2
        );
      } else {
        ctx.fillStyle = '#020409';
        ctx.fill();
      }

      // 5. Planetary Terminator & Solar Shadow (Day-to-night gradient across body)
      const shadowGrad = ctx.createLinearGradient(
        centerX - planetRadius * 0.7, centerY - planetRadius * 0.85,
        centerX + planetRadius * 0.7, centerY + planetRadius * 0.25
      );
      shadowGrad.addColorStop(0, 'rgba(0, 2, 4, 0.02)');
      shadowGrad.addColorStop(0.35, 'rgba(2, 5, 12, 0.45)');
      shadowGrad.addColorStop(0.7, 'rgba(0, 2, 6, 0.92)');
      shadowGrad.addColorStop(1, 'rgba(0, 1, 3, 0.99)');

      ctx.fillStyle = shadowGrad;
      ctx.fillRect(centerX - planetRadius, centerY - planetRadius, planetRadius * 2, planetRadius * 2);

      // Subtle atmospheric airglow wash along inner edge of the planet
      const airglowGrad = ctx.createRadialGradient(
        centerX, centerY, planetRadius * 0.96,
        centerX, centerY, planetRadius
      );
      airglowGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
      airglowGrad.addColorStop(0.8, 'rgba(30, 64, 175, 0.12)');
      airglowGrad.addColorStop(1, 'rgba(79, 140, 255, 0.28)');

      ctx.fillStyle = airglowGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, planetRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();

      // 6. Razor-Thin Electric Blue Core Atmospheric Horizon Line (The signature Azemax rim)
      ctx.save();

      // Layer 1: Ambient electric bloom
      const rimBloomGrad = ctx.createLinearGradient(
        width * 0.05, 0,
        width * 0.95, height * 0.6
      );
      rimBloomGrad.addColorStop(0, 'rgba(79, 140, 255, 0.05)');
      rimBloomGrad.addColorStop(0.35, 'rgba(79, 140, 255, 0.5)');
      rimBloomGrad.addColorStop(0.65, 'rgba(143, 180, 255, 0.9)');
      rimBloomGrad.addColorStop(0.85, 'rgba(79, 140, 255, 0.6)');
      rimBloomGrad.addColorStop(1, 'rgba(59, 130, 246, 0.15)');

      ctx.strokeStyle = rimBloomGrad;
      ctx.lineWidth = 3.2;
      ctx.shadowColor = '#4F8CFF';
      ctx.shadowBlur = 18;
      ctx.beginPath();
      ctx.arc(centerX, centerY, planetRadius, Math.PI * 1.06, Math.PI * 1.94);
      ctx.stroke();

      // Layer 2: Sub-pixel high-intensity white-hot core line (Simulating intense grazing sunlight)
      const coreGrad = ctx.createLinearGradient(
        width * 0.25, 0,
        width * 0.85, height * 0.4
      );
      coreGrad.addColorStop(0, 'rgba(143, 180, 255, 0.1)');
      coreGrad.addColorStop(0.4, 'rgba(215, 235, 255, 0.98)');
      coreGrad.addColorStop(0.7, 'rgba(165, 205, 255, 0.95)');
      coreGrad.addColorStop(1, 'rgba(79, 140, 255, 0.2)');

      ctx.shadowBlur = 6;
      ctx.shadowColor = '#8FB4FF';
      ctx.strokeStyle = coreGrad;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, planetRadius, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className={`absolute inset-0 pointer-events-none overflow-hidden ${className}`}>
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ width: '100%', height: '100%' }}
        aria-hidden="true"
      />
    </div>
  );
};
