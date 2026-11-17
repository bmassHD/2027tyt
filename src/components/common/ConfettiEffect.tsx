import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfettiEffectProps {
  triggerKey: number;
  durationMs?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  tiltAngle: number;
  tiltSpeed: number;
  shape: 'rect' | 'circle' | 'ribbon';
  opacity: number;
}

const CONFETTI_COLORS = [
  '#10b981', // emerald
  '#f59e0b', // amber/gold
  '#ef4444', // red
  '#3b82f6', // blue
  '#ec4899', // pink
  '#14b8a6', // teal
  '#eab308', // yellow
  '#8b5cf6', // violet
];

export const ConfettiEffect: React.FC<ConfettiEffectProps> = ({
  triggerKey,
  durationMs = 4600,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);

  const [renderedTriggerKey, setRenderedTriggerKey] = useState(0);

  useEffect(() => {
    if (!triggerKey || triggerKey <= 0 || typeof window === 'undefined') return;
    setActive(true);
    setRenderedTriggerKey(triggerKey);
  }, [triggerKey]);

  useEffect(() => {
    if (!active || renderedTriggerKey <= 0 || typeof window === 'undefined') return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let cancelled = false;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = window.innerWidth;
    let height = window.innerHeight;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const particles: Particle[] = [];
    const shapes: Particle['shape'][] = ['rect', 'rect', 'ribbon', 'circle'];

    const spawnCannon = (originX: number, originY: number, angleBase: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = angleBase + (Math.random() - 0.5) * 0.85;
        const speed = 10 + Math.random() * 14;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: 6 + Math.random() * 6,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.2,
          tiltAngle: Math.random() * Math.PI * 2,
          tiltSpeed: 0.08 + Math.random() * 0.1,
          shape: shapes[Math.floor(Math.random() * shapes.length)],
          opacity: 1,
        });
      }
    };

    const spawnTopShower = (count: number) => {
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * width,
          y: -20 - Math.random() * (height * 0.35),
          vx: (Math.random() - 0.5) * 3.5,
          vy: 2.5 + Math.random() * 4.5,
          size: 6 + Math.random() * 6,
          color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.16,
          tiltAngle: Math.random() * Math.PI * 2,
          tiltSpeed: 0.06 + Math.random() * 0.1,
          shape: shapes[Math.floor(Math.random() * shapes.length)],
          opacity: 1,
        });
      }
    };

    // Dual side cannons + top shower
    spawnCannon(width * 0.08, height * 0.92, -Math.PI / 3, 55);
    spawnCannon(width * 0.92, height * 0.92, (-2 * Math.PI) / 3, 55);
    spawnTopShower(55);

    const startTime = performance.now();

    const frame = (now: number) => {
      if (cancelled) return;
      const elapsed = now - startTime;
      const fadeStart = durationMs * 0.7;

      ctx.clearRect(0, 0, width, height);

      let aliveCount = 0;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.vy += 0.24; // gravity
        p.vx *= 0.992; // air drag
        p.x += p.vx;
        p.y += p.vy + Math.sin(p.tiltAngle) * 0.6;
        p.rotation += p.rotationSpeed;
        p.tiltAngle += p.tiltSpeed;

        if (elapsed > fadeStart) {
          p.opacity = Math.max(0, 1 - (elapsed - fadeStart) / (durationMs - fadeStart));
        }

        if (p.opacity <= 0.01 || p.y > height + 40) continue;
        aliveCount++;

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.scale(1, Math.cos(p.tiltAngle) * 0.85 + 0.15);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'ribbon') {
          ctx.fillRect(-p.size * 0.75, -p.size * 0.25, p.size * 1.5, p.size * 0.5);
        } else {
          ctx.fillRect(-p.size * 0.5, -p.size * 0.35, p.size, p.size * 0.7);
        }
        ctx.restore();
      }

      if (elapsed < durationMs && aliveCount > 0) {
        rafId = window.requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, width, height);
        window.removeEventListener('resize', resize);
        setActive(false);
      }
    };

    rafId = window.requestAnimationFrame(frame);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', resize);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [active, renderedTriggerKey, durationMs]);

  if (!active || typeof document === 'undefined') return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 top-0 left-0 w-full h-[100dvh] z-[160] pointer-events-none m-0"
    />,
    document.body
  );
};
