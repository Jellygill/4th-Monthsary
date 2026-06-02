import { useEffect, useRef } from "react";

// ── Heart parametric equation ──────────────────────────────────────────────
function heartX(t: number) { return 16 * Math.pow(Math.sin(t), 3); }
function heartY(t: number) {
  return -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
}
function getHeartPoints(n: number, cx: number, cy: number, scale: number) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    pts.push({ x: cx + heartX(t) * scale, y: cy + heartY(t) * scale });
  }
  return pts;
}

// ── Easing ─────────────────────────────────────────────────────────────────
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Particle ───────────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number;
  tx: number; ty: number;          // current heart target (pulsed)
  baseTx: number; baseTy: number;  // un-pulsed heart target
  vx: number; vy: number;
  size: number;
  baseOpacity: number;
  opacity: number;
  hue: number;                     // 0-360, warm gold-white range
  gathered: boolean;
  drifting: boolean;
  driftTimer: number;
  driftMax: number;
  driftVx: number; driftVy: number;
  orbitAngle: number;
  orbitR: number;
  orbitSpeed: number;
}

// ── Star field ─────────────────────────────────────────────────────────────
interface Star {
  x: number; y: number;
  size: number;
  opacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

// ── Text sequence ──────────────────────────────────────────────────────────
const MESSAGES = [
  { text: "Some days are harder than others.", pause: 3000 },
  { text: "Some days feel overwhelming.", pause: 3000 },
  { text: "Some days things don't go the way we hoped.", pause: 3200 },
  { text: "But even then...", pause: 2500 },
  { text: "I'm still here.", pause: 4500, brighten: true },
];
const FINAL_TITLE = "Happy Monthsary, Honey ❤️";
const FINAL_BODY =
  "There may be a lot of things changing around us right now,\nbut my choice remains the same.\n\nIt will always be you, hon.";

// ── Main component ─────────────────────────────────────────────────────────
export default function HeartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const brightenRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf: number;

    const HEART_N = 2200;
    const STAR_N = 280;
    const DRIFT_GROUP = 100;

    const particles: Particle[] = [];
    const stars: Star[] = [];

    let appPhase: "gathering" | "beating" = "gathering";
    let gatherStart = performance.now();
    let driftCooldown = 0;
    let beatTime = 0;
    let globalBrightness = 1; // boosted to ~1.4 on "I'm still here"

    // ── resize & init ──────────────────────────────────────────────────────
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      buildStars();
      buildParticles();
      appPhase = "gathering";
      gatherStart = performance.now();
      beatTime = 0;
    }

    function buildStars() {
      stars.length = 0;
      for (let i = 0; i < STAR_N; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 1.2 + 0.2,
          opacity: Math.random() * 0.5 + 0.05,
          twinkleSpeed: Math.random() * 0.02 + 0.005,
          twinklePhase: Math.random() * Math.PI * 2,
        });
      }
    }

    function buildParticles() {
      particles.length = 0;
      const cx = canvas.width / 2;
      const cy = canvas.height * 0.46;
      const scale = Math.min(canvas.width, canvas.height) * 0.0165;
      const heartPts = getHeartPoints(HEART_N, cx, cy, scale);

      for (let i = 0; i < HEART_N; i++) {
        const hp = heartPts[i];
        const hue = 28 + Math.random() * 40; // warm gold 28-68°
        const size = Math.random() * 1.8 + 0.5;
        const baseOpacity = Math.random() * 0.55 + 0.3;
        particles.push({
          x: (Math.random() - 0.5) * canvas.width * 1.6 + cx,
          y: (Math.random() - 0.5) * canvas.height * 1.6 + cy,
          tx: hp.x, ty: hp.y,
          baseTx: hp.x, baseTy: hp.y,
          vx: 0, vy: 0,
          size,
          baseOpacity,
          opacity: 0,
          hue,
          gathered: false,
          drifting: false,
          driftTimer: 0,
          driftMax: 0,
          driftVx: 0, driftVy: 0,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitR: Math.random() * 2.5 + 0.5,
          orbitSpeed: (Math.random() * 0.008 + 0.003) * (Math.random() < 0.5 ? 1 : -1),
        });
      }
    }

    // ── draw background ────────────────────────────────────────────────────
    function drawBackground(now: number) {
      // Deep dark gradient
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const bg = ctx.createRadialGradient(cx, cy * 0.85, 0, cx, cy, Math.max(canvas.width, canvas.height) * 0.8);
      bg.addColorStop(0, "#0d1525");
      bg.addColorStop(0.45, "#070B14");
      bg.addColorStop(1, "#020408");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Stars
      for (const s of stars) {
        s.twinklePhase += s.twinkleSpeed;
        const alpha = s.opacity * (0.5 + 0.5 * Math.sin(s.twinklePhase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(200,220,255,${alpha})`;
        ctx.fill();
      }
    }

    // ── draw single glowing particle ───────────────────────────────────────
    function drawParticle(x: number, y: number, size: number, opacity: number, hue: number) {
      const bright = globalBrightness;
      const r = Math.round(255 * bright);
      const g = Math.round((180 + hue * 0.5) * bright);
      const b = Math.round((80 + hue * 0.8) * Math.min(bright, 1.0));
      const clamp = (v: number) => Math.min(255, Math.max(0, v));

      // Outer soft halo
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 6);
      halo.addColorStop(0, `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${opacity * 0.25})`);
      halo.addColorStop(1, `rgba(${clamp(r)},${clamp(g)},${clamp(b)},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 6, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // Inner glow
      const inner = ctx.createRadialGradient(x, y, 0, x, y, size * 2.2);
      inner.addColorStop(0, `rgba(255,240,200,${Math.min(opacity * 1.4, 1)})`);
      inner.addColorStop(0.4, `rgba(${clamp(r)},${clamp(g)},${clamp(b)},${opacity * 0.8})`);
      inner.addColorStop(1, `rgba(${clamp(r)},${clamp(g)},${clamp(b)},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 2.2, 0, Math.PI * 2);
      ctx.fillStyle = inner;
      ctx.fill();

      // Core dot
      ctx.beginPath();
      ctx.arc(x, y, size * 0.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,248,220,${Math.min(opacity * 1.6, 1)})`;
      ctx.fill();
    }

    // ── heartbeat pulse ────────────────────────────────────────────────────
    function getPulse(t: number): number {
      // Realistic heartbeat: two bumps (systole + dicrotic notch), ~60 bpm
      const period = 120; // frames at 60fps ≈ 1 beat/2s for dramatic feel
      const phase = (t % period) / period;
      // first bump
      const b1 = Math.exp(-Math.pow((phase - 0.12) / 0.05, 2)) * 0.08;
      // second smaller bump
      const b2 = Math.exp(-Math.pow((phase - 0.22) / 0.04, 2)) * 0.045;
      return 1 + b1 + b2;
    }

    // ── main render loop ───────────────────────────────────────────────────
    function tick(now: number) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground(now);

      const cx = canvas.width / 2;
      const cy = canvas.height * 0.46;
      const scale = Math.min(canvas.width, canvas.height) * 0.0165;

      // smooth globalBrightness toward target
      const targetBrightness = brightenRef.current ? 1.55 : 1.0;
      globalBrightness += (targetBrightness - globalBrightness) * 0.008;

      if (appPhase === "gathering") {
        // ── phase 1: particles fly toward heart ──
        let allIn = true;
        const elapsed = (now - gatherStart) / 1000;

        for (const p of particles) {
          const dx = p.baseTx - p.x;
          const dy = p.baseTy - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > 2) {
            allIn = false;
            // delayed start based on initial distance for staggered feel
            const delay = Math.sqrt(dx * dx + dy * dy) * 0.0008;
            if (elapsed > delay) {
              p.vx += dx * 0.018;
              p.vy += dy * 0.018;
              p.vx *= 0.9;
              p.vy *= 0.9;
              p.x += p.vx;
              p.y += p.vy;
            }
            // fade in as they approach
            p.opacity = Math.min(p.baseOpacity, p.opacity + 0.008);
          } else {
            p.x = p.baseTx;
            p.y = p.baseTy;
            p.gathered = true;
            p.opacity = p.baseOpacity;
          }

          drawParticle(p.x, p.y, p.size, p.opacity, p.hue);
        }

        if (allIn && elapsed > 1.5) {
          appPhase = "beating";
          beatTime = 0;
        }
      } else {
        // ── phase 2: beating heart ──
        beatTime++;
        const pulse = getPulse(beatTime);
        const heartPts = getHeartPoints(HEART_N, cx, cy, scale * pulse);

        // update targets with pulse
        for (let i = 0; i < HEART_N; i++) {
          particles[i].tx = heartPts[i].x;
          particles[i].ty = heartPts[i].y;
        }

        // periodic drift groups
        driftCooldown--;
        if (driftCooldown <= 0) {
          driftCooldown = 200 + Math.random() * 160;
          const start = Math.floor(Math.random() * (HEART_N - DRIFT_GROUP));
          for (let i = start; i < start + DRIFT_GROUP; i++) {
            const p = particles[i];
            if (!p.drifting) {
              p.drifting = true;
              p.driftTimer = 0;
              p.driftMax = 90 + Math.random() * 70;
              const angle = Math.random() * Math.PI * 2;
              const speed = Math.random() * 2 + 0.8;
              p.driftVx = Math.cos(angle) * speed;
              p.driftVy = Math.sin(angle) * speed - 0.4;
            }
          }
        }

        // ambient float particles (distant specks orbiting far outside)
        const orbitScale = scale * 17;
        const ambientCount = 55;
        for (let i = 0; i < ambientCount; i++) {
          const ang = (i / ambientCount) * Math.PI * 2 + beatTime * 0.0006;
          const r = orbitScale + Math.sin(beatTime * 0.003 + i * 0.7) * scale * 3;
          const ax = cx + Math.cos(ang) * r;
          const ay = cy + Math.sin(ang) * r * 0.75 - scale * 1.5;
          const ao = 0.08 + 0.07 * Math.sin(beatTime * 0.015 + i * 0.4);
          drawParticle(ax, ay, 0.6, ao, 40);
        }

        // rising sparkles
        const sparkleCount = 12;
        for (let i = 0; i < sparkleCount; i++) {
          const seed = (beatTime * 0.3 + i * 97.3) % 1000;
          const sx = cx + (((seed * 7.3) % 1) - 0.5) * scale * 28;
          const sy = cy - scale * 8 - ((beatTime * 0.4 + i * 60) % (scale * 18));
          const so = Math.max(0, 0.25 - ((beatTime * 0.4 + i * 60) % (scale * 18)) / (scale * 18) * 0.25);
          drawParticle(sx, sy, 0.7, so * globalBrightness, 35 + Math.sin(seed) * 15);
        }

        // update & draw each heart particle
        for (const p of particles) {
          if (p.drifting) {
            p.driftTimer++;
            if (p.driftTimer < p.driftMax * 0.4) {
              // drift outward
              p.x += p.driftVx;
              p.y += p.driftVy;
              p.driftVx *= 0.96;
              p.driftVy *= 0.96;
            } else if (p.driftTimer < p.driftMax) {
              // return home
              const dx = p.tx - p.x;
              const dy = p.ty - p.y;
              p.vx += dx * 0.035;
              p.vy += dy * 0.035;
              p.vx *= 0.88;
              p.vy *= 0.88;
              p.x += p.vx;
              p.y += p.vy;
            } else {
              p.drifting = false;
              p.x = p.tx;
              p.y = p.ty;
              p.vx = 0;
              p.vy = 0;
            }
          } else {
            // gentle micro-orbit at heart target
            p.orbitAngle += p.orbitSpeed;
            p.x = p.tx + Math.cos(p.orbitAngle) * p.orbitR;
            p.y = p.ty + Math.sin(p.orbitAngle) * p.orbitR;
          }

          // breathing opacity
          p.opacity = p.baseOpacity * (0.8 + 0.2 * Math.sin(beatTime * 0.04 + p.orbitAngle));

          drawParticle(p.x, p.y, p.size, p.opacity * globalBrightness, p.hue);
        }

        // center ambient glow of heart
        const glowSize = scale * 9 * pulse;
        const heartGlow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowSize);
        heartGlow.addColorStop(0, `rgba(255,160,80,${0.04 * globalBrightness})`);
        heartGlow.addColorStop(0.5, `rgba(255,100,60,${0.025 * globalBrightness})`);
        heartGlow.addColorStop(1, "rgba(255,80,40,0)");
        ctx.beginPath();
        ctx.arc(cx, cy, glowSize, 0, Math.PI * 2);
        ctx.fillStyle = heartGlow;
        ctx.fill();
      }

      raf = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, []);

  // ── text sequence ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current!;
    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise<void>((res) => { const t = setTimeout(res, ms); if (cancelled) clearTimeout(t); });

    const animate = (elem: HTMLElement, fromOpacity: number, toOpacity: number, ms: number) =>
      new Promise<void>((res) => {
        const start = performance.now();
        const step = (now: number) => {
          if (cancelled) { res(); return; }
          const frac = easeInOutCubic(Math.min((now - start) / ms, 1));
          elem.style.opacity = String(fromOpacity + (toOpacity - fromOpacity) * frac);
          if (frac < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });

    const makeText = (styles: string) => {
      const d = document.createElement("div");
      d.style.cssText = styles;
      d.style.opacity = "0";
      el.appendChild(d);
      return d;
    };

    async function run() {
      // Wait for heart to form
      await sleep(4200);

      for (const msg of MESSAGES) {
        if (cancelled) return;
        const div = makeText(`
          position:absolute;
          left:50%;
          bottom:16%;
          transform:translateX(-50%);
          color:rgba(255,255,255,0.92);
          font-family:'Cormorant Garamond',Georgia,serif;
          font-size:clamp(15px,2.8vw,26px);
          font-style:italic;
          font-weight:300;
          letter-spacing:0.08em;
          text-align:center;
          text-shadow:0 0 30px rgba(255,200,120,0.4),0 0 60px rgba(255,150,80,0.15);
          white-space:nowrap;
          pointer-events:none;
          width:max-content;
          max-width:88vw;
        `);
        div.textContent = msg.text;

        if (msg.brighten) brightenRef.current = true;
        await animate(div, 0, 1, 1400);
        await sleep(msg.pause);
        await animate(div, 1, 0, 900);
        el.removeChild(div);
        await sleep(300);
      }

      if (cancelled) return;

      // Final scene
      const finalWrap = makeText(`
        position:absolute;
        left:50%;
        bottom:10%;
        transform:translateX(-50%);
        text-align:center;
        pointer-events:none;
        width:90vw;
        max-width:640px;
      `);

      const titleEl = document.createElement("div");
      titleEl.textContent = FINAL_TITLE;
      titleEl.style.cssText = `
        font-family:'Cormorant Garamond',Georgia,serif;
        font-size:clamp(22px,4vw,44px);
        font-weight:400;
        font-style:italic;
        letter-spacing:0.06em;
        color:rgba(255,255,255,0.97);
        text-shadow:0 0 40px rgba(255,180,100,0.6),0 0 80px rgba(255,120,60,0.25);
        margin-bottom:28px;
        line-height:1.3;
      `;

      const bodyEl = document.createElement("div");
      bodyEl.textContent = FINAL_BODY;
      bodyEl.style.cssText = `
        font-family:'Inter',system-ui,sans-serif;
        font-size:clamp(12px,1.8vw,17px);
        font-weight:300;
        letter-spacing:0.05em;
        color:rgba(255,255,255,0.62);
        text-shadow:0 0 20px rgba(255,180,100,0.2);
        line-height:2;
        white-space:pre-line;
      `;

      finalWrap.appendChild(titleEl);
      finalWrap.appendChild(bodyEl);

      await animate(finalWrap, 0, 1, 2400);
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, display: "block" }}
      />
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
