'use client';

import { useEffect, useRef } from 'react';

const CHARS = [
  '0','1','2','3','4','5','6','7','8','9',
  'a','b','c','d','e','f',
  'Fp','G₁','G₂','π','σ','∈',
  '3a','7f','c2','b1','e8','4d',
];

const FONT_SIZE = 13;
const COL_WIDTH = 18;
const INTERVAL = 100;

export function MatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let drops: number[] = [];
    let speeds: number[] = [];
    let cols = 0;

    const init = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      cols = Math.floor(canvas.width / COL_WIDTH);
      drops = Array.from({ length: cols }, () =>
        Math.floor(Math.random() * -(canvas.height / FONT_SIZE))
      );
      speeds = Array.from({ length: cols }, () => 0.2 + Math.random() * 0.5);
      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    init();
    window.addEventListener('resize', init);

    let raf: number;
    let lastTime = 0;

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);
      if (time - lastTime < INTERVAL) return;
      lastTime = time;

      // Fade trail — very slow erase creates ghosting effect
      ctx.fillStyle = 'rgba(3, 7, 18, 0.08)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = `${FONT_SIZE}px monospace`;

      for (let i = 0; i < cols; i++) {
        const y = drops[i] * FONT_SIZE;
        if (y < 0) {
          drops[i] += speeds[i];
          continue;
        }

        const char = CHARS[Math.floor(Math.random() * CHARS.length)];
        ctx.fillStyle = 'rgba(99, 102, 241, 0.22)';
        ctx.fillText(char, i * COL_WIDTH, y);

        drops[i] += speeds[i];

        if (y > canvas.height && Math.random() > 0.97) {
          drops[i] = Math.floor(Math.random() * -20);
        }
      }
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', init);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        zIndex: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
