import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  color: string;
  phase: "gathering" | "formed" | "drifting" | "returning";
  driftTimer: number;
  driftDuration: number;
  orbitAngle: number;
  orbitRadius: number;
  orbitSpeed: number;
  sparkle: boolean;
  sparkleTimer: number;
}

interface TextMessage {
  text: string;
  pause: number;
}

const MESSAGES: TextMessage[] = [
  { text: "Some days are harder than others.", pause: 3000 },
  { text: "Some days feel overwhelming.", pause: 3000 },
  { text: "Some days things don't go the way we hoped.", pause: 3000 },
  { text: "But even then...", pause: 2000 },
  { text: "I'm still here.", pause: 4000 },
];

const FINAL_TITLE = "Happy Monthsary, Honey ❤️";
const FINAL_SUBTITLE =
  "There may be a lot of things changing around us right now,\nbut my choice remains the same:\nit will always be you hon.";

function heartX(t: number): number {
  return 16 * Math.pow(Math.sin(t), 3);
}

function heartY(t: number): number {
  return -(
    13 * Math.cos(t) -
    5 * Math.cos(2 * t) -
    2 * Math.cos(3 * t) -
    Math.cos(4 * t)
  );
}

function getHeartPoints(count: number, cx: number, cy: number, scale: number) {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / count) * Math.PI * 2;
    points.push({
      x: cx + heartX(t) * scale,
      y: cy + heartY(t) * scale,
    });
  }
  return points;
}

const PARTICLE_COLORS = [
  "rgba(255, 182, 193, alpha)",
  "rgba(255, 160, 170, alpha)",
  "rgba(255, 200, 210, alpha)",
  "rgba(220, 120, 140, alpha)",
  "rgba(255, 255, 255, alpha)",
  "rgba(230, 180, 190, alpha)",
  "rgba(200, 100, 120, alpha)",
];

function randomColor(opacity: number) {
  const template =
    PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)];
  return template.replace("alpha", String(opacity));
}

export default function HeartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrameId: number;
    let phase: "gathering" | "beating" = "gathering";
    let startTime = performance.now();

    const PARTICLE_COUNT = 1800;
    const DRIFT_GROUP_SIZE = 80;

    const particles: Particle[] = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      initParticles();
    }

    function initParticles() {
      particles.length = 0;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2 - 40;
      const scale = Math.min(canvas.width, canvas.height) * 0.018;
      const heartPts = getHeartPoints(PARTICLE_COUNT, cx, cy, scale);

      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const hp = heartPts[i];
        const startX = Math.random() * canvas.width;
        const startY = Math.random() * canvas.height;
        const size = Math.random() * 2.5 + 0.8;
        const opacity = Math.random() * 0.6 + 0.3;

        particles.push({
          x: startX,
          y: startY,
          targetX: hp.x,
          targetY: hp.y,
          vx: 0,
          vy: 0,
          size,
          opacity,
          color: randomColor(opacity),
          phase: "gathering",
          driftTimer: 0,
          driftDuration: 0,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitRadius: Math.random() * 3,
          orbitSpeed: (Math.random() * 0.01 + 0.005) * (Math.random() < 0.5 ? 1 : -1),
          sparkle: Math.random() < 0.15,
          sparkleTimer: Math.random() * 100,
        });
      }
      phase = "gathering";
      startTime = performance.now();
    }

    let beatT = 0;
    let driftGroupTimer = 0;

    function tick(now: number) {
      const elapsed = now - startTime;
      const cx = canvas.width / 2;
      const cy = canvas.height / 2 - 40;
      const scale = Math.min(canvas.width, canvas.height) * 0.018;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const grad = ctx.createRadialGradient(cx, cy - 60, 0, cx, cy, canvas.height * 0.7);
      grad.addColorStop(0, "#ffe0e8");
      grad.addColorStop(0.5, "#fbc8d4");
      grad.addColorStop(1, "#e8a0b0");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (phase === "gathering") {
        let allArrived = true;
        for (const p of particles) {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 1.5) {
            allArrived = false;
            p.vx += dx * 0.03;
            p.vy += dy * 0.03;
            p.vx *= 0.88;
            p.vy *= 0.88;
            p.x += p.vx;
            p.y += p.vy;
          } else {
            p.x = p.targetX;
            p.y = p.targetY;
          }
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3);
          glow.addColorStop(0, randomColor(p.opacity));
          glow.addColorStop(1, randomColor(0));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.5, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = randomColor(p.opacity);
          ctx.fill();
        }

        if (allArrived && elapsed > 800) {
          phase = "beating";
          startTime = now;
        }
      } else {
        beatT += 0.04;
        const heartPts = getHeartPoints(PARTICLE_COUNT, cx, cy, scale);

        const beatPulse = 1 + 0.05 * Math.max(0, Math.sin(beatT * 2)) * (Math.sin(beatT * 2) > 0 ? 1 : 0);

        driftGroupTimer++;
        if (driftGroupTimer > 180 + Math.random() * 120) {
          driftGroupTimer = 0;
          const startIdx = Math.floor(Math.random() * (PARTICLE_COUNT - DRIFT_GROUP_SIZE));
          for (let i = startIdx; i < startIdx + DRIFT_GROUP_SIZE; i++) {
            if (particles[i].phase === "formed") {
              particles[i].phase = "drifting";
              particles[i].driftDuration = 80 + Math.random() * 60;
              particles[i].driftTimer = 0;
              particles[i].vx = (Math.random() - 0.5) * 3;
              particles[i].vy = (Math.random() - 0.5) * 3 - 0.5;
            }
          }
        }

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const hp = heartPts[i];

          const tx = hp.x + (beatPulse - 1) * (hp.x - cx);
          const ty = hp.y + (beatPulse - 1) * (hp.y - cy);

          p.sparkleTimer++;
          const sparkleOpacity =
            p.sparkle ? p.opacity * (0.6 + 0.4 * Math.sin(p.sparkleTimer * 0.1)) : p.opacity;

          if (p.phase === "drifting") {
            p.driftTimer++;
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.97;
            p.vy *= 0.97;

            if (p.driftTimer > p.driftDuration) {
              p.phase = "returning";
            }
          } else if (p.phase === "returning") {
            const dx = tx - p.x;
            const dy = ty - p.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            p.vx += dx * 0.04;
            p.vy += dy * 0.04;
            p.vx *= 0.85;
            p.vy *= 0.85;
            p.x += p.vx;
            p.y += p.vy;
            if (dist < 2) {
              p.phase = "formed";
              p.x = tx;
              p.y = ty;
            }
          } else {
            p.phase = "formed";
            p.orbitAngle += p.orbitSpeed;
            p.x = tx + Math.cos(p.orbitAngle) * p.orbitRadius;
            p.y = ty + Math.sin(p.orbitAngle) * p.orbitRadius;
          }

          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 4);
          glow.addColorStop(0, randomColor(sparkleOpacity * 0.8));
          glow.addColorStop(1, randomColor(0));
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 3, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = randomColor(sparkleOpacity);
          ctx.fill();
        }

        const driftedCount = Math.floor(
          60 + 20 * Math.abs(Math.sin(now * 0.0003))
        );
        for (let i = 0; i < driftedCount; i++) {
          const angle = (i / driftedCount) * Math.PI * 2;
          const orbitR = (Math.min(canvas.width, canvas.height) * 0.018 * 18) + Math.sin(now * 0.001 + i) * 10;
          const ox = cx + Math.cos(angle + now * 0.0004) * orbitR;
          const oy = cy + Math.sin(angle + now * 0.0004) * orbitR * 0.8 - 10;
          const size = Math.random() * 1.5 + 0.5;
          const alpha = 0.3 + 0.3 * Math.sin(now * 0.002 + i * 0.3);
          const glow2 = ctx.createRadialGradient(ox, oy, 0, ox, oy, size * 4);
          glow2.addColorStop(0, `rgba(255, 200, 210, ${alpha})`);
          glow2.addColorStop(1, `rgba(255, 200, 210, 0)`);
          ctx.beginPath();
          ctx.arc(ox, oy, size * 3, 0, Math.PI * 2);
          ctx.fillStyle = glow2;
          ctx.fill();
          ctx.beginPath();
          ctx.arc(ox, oy, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 200, 210, ${alpha})`;
          ctx.fill();
        }
      }

      animFrameId = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, display: "block" }}
      />
      <TextOverlay />
    </div>
  );
}

function TextOverlay() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    let cancelled = false;

    async function sleep(ms: number) {
      return new Promise<void>((resolve) => {
        const t = setTimeout(resolve, ms);
        if (cancelled) clearTimeout(t);
      });
    }

    async function fadeIn(elem: HTMLElement, duration = 1200) {
      elem.style.opacity = "0";
      elem.style.display = "block";
      const start = performance.now();
      return new Promise<void>((resolve) => {
        function step(now: number) {
          if (cancelled) { resolve(); return; }
          const t = Math.min((now - start) / duration, 1);
          elem.style.opacity = String(t);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        }
        requestAnimationFrame(step);
      });
    }

    async function fadeOut(elem: HTMLElement, duration = 800) {
      const start = performance.now();
      const startOpacity = parseFloat(elem.style.opacity) || 1;
      return new Promise<void>((resolve) => {
        function step(now: number) {
          if (cancelled) { resolve(); return; }
          const t = Math.min((now - start) / duration, 1);
          elem.style.opacity = String(startOpacity * (1 - t));
          if (t < 1) requestAnimationFrame(step);
          else { elem.style.display = "none"; resolve(); }
        }
        requestAnimationFrame(step);
      });
    }

    async function run() {
      await sleep(3200);

      for (const msg of MESSAGES) {
        if (cancelled) break;
        const div = document.createElement("div");
        div.textContent = msg.text;
        div.style.cssText = `
          display:none;
          position:absolute;
          left:50%;
          top:72%;
          transform:translateX(-50%);
          text-align:center;
          color:rgba(120,40,60,0.92);
          font-size:clamp(16px,3vw,28px);
          font-style:italic;
          font-weight:400;
          letter-spacing:0.04em;
          text-shadow:0 0 24px rgba(255,200,210,0.8), 0 1px 2px rgba(0,0,0,0.08);
          padding:0 24px;
          max-width:680px;
          width:90%;
          line-height:1.6;
          pointer-events:none;
          white-space:nowrap;
        `;
        el.appendChild(div);
        await fadeIn(div);
        await sleep(msg.pause);
        await fadeOut(div);
        el.removeChild(div);
        await sleep(200);
      }

      if (cancelled) return;

      const finalBlock = document.createElement("div");
      finalBlock.style.cssText = `
        display:none;
        position:absolute;
        left:50%;
        top:60%;
        transform:translateX(-50%);
        text-align:center;
        pointer-events:none;
        width:90%;
        max-width:700px;
      `;

      const title = document.createElement("div");
      title.textContent = FINAL_TITLE;
      title.style.cssText = `
        color:rgba(180,40,70,0.96);
        font-size:clamp(22px,4.5vw,48px);
        font-style:italic;
        font-weight:700;
        letter-spacing:0.03em;
        text-shadow:0 0 32px rgba(255,150,170,0.9), 0 0 60px rgba(255,100,130,0.4);
        margin-bottom:24px;
        line-height:1.3;
      `;

      const sub = document.createElement("div");
      sub.style.cssText = `
        color:rgba(110,35,55,0.88);
        font-size:clamp(13px,2.2vw,20px);
        font-style:italic;
        font-weight:400;
        letter-spacing:0.03em;
        line-height:1.9;
        text-shadow:0 0 18px rgba(255,200,210,0.7);
        white-space:pre-line;
      `;
      sub.textContent = FINAL_SUBTITLE;

      finalBlock.appendChild(title);
      finalBlock.appendChild(sub);
      el.appendChild(finalBlock);

      await fadeIn(finalBlock, 2000);
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div
      ref={overlayRef}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    />
  );
}
