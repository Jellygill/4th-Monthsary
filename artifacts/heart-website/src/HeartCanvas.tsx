import { useEffect, useRef } from "react";

// ── Heart parametric equation ────────────────────────────────────────────
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

// ── Easing ───────────────────────────────────────────────────────────────
function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Spring ───────────────────────────────────────────────────────────────
// Returns updated [position, velocity] with spring + damping
function springStep(
  pos: number, vel: number, target: number,
  stiffness = 0.06, damping = 0.72, overshoot = 1.0
): [number, number] {
  const force = (target - pos) * stiffness * overshoot;
  const newVel = (vel + force) * damping;
  const newPos = pos + newVel;
  return [newPos, newVel];
}

// ── Types ────────────────────────────────────────────────────────────────
interface Particle {
  // position & physics
  x: number; y: number;
  vx: number; vy: number;
  // heart target (base + pulsed)
  baseTx: number; baseTy: number;
  tx: number; ty: number;
  // appearance
  size: number;
  baseOpacity: number;
  opacity: number;
  r: number; g: number; b: number; // rose-pink color with variation
  // state
  state: "drifting_free" | "gathering" | "formed" | "scattered" | "drifting_away";
  gatherDelay: number;    // stagger: wait this many frames before homing
  driftAwayTimer: number;
  driftAwayMax: number;
  repulsed: boolean;      // currently pushed by mouse
  // micro orbit
  orbitAngle: number;
  orbitR: number;
  orbitSpeed: number;
  // sparkle
  twinkle: number;
  twinkleSpeed: number;
}

interface Star {
  x: number; y: number;
  size: number;
  opacity: number;
  phase: number;
  speed: number;
}

// ── Text messages ────────────────────────────────────────────────────────
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

// ── Rose-pink particle color ─────────────────────────────────────────────
function roseColor() {
  // Warm rose pink: R high, G low-mid, B mid
  const variant = Math.random();
  if (variant < 0.35) return { r: 255, g: 120 + Math.random() * 60, b: 150 + Math.random() * 50 }; // warm rose
  if (variant < 0.6)  return { r: 240 + Math.random() * 15, g: 160 + Math.random() * 40, b: 180 + Math.random() * 40 }; // blush
  if (variant < 0.8)  return { r: 255, g: 200 + Math.random() * 30, b: 210 + Math.random() * 20 }; // near-white pink
  return                      { r: 200 + Math.random() * 30, g: 60 + Math.random() * 40, b: 90 + Math.random() * 40 };  // deep rose
}

// ── Component ────────────────────────────────────────────────────────────
export default function HeartCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const brightenRef = useRef(false);
  const mouseRef = useRef({ x: -9999, y: -9999, active: false });

  // Canvas / animation
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf: number;

    const HEART_N = 2400;
    const STAR_N = 260;
    const REPULSE_RADIUS = 110;
    const REPULSE_FORCE = 3.8;
    const DRIFT_GROUP = 90;

    const particles: Particle[] = [];
    const stars: Star[] = [];

    let appPhase: "gathering" | "beating" = "gathering";
    let gatherFrame = 0;
    let beatTime = 0;
    let driftCooldown = 280;
    let globalBrightness = 1.0;
    let beatPulse = 1.0;

    // ── resize ──────────────────────────────────────────────────────────
    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      buildStars();
      buildParticles();
      appPhase = "gathering";
      gatherFrame = 0;
      beatTime = 0;
    }

    function buildStars() {
      stars.length = 0;
      for (let i = 0; i < STAR_N; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 1.1 + 0.2,
          opacity: Math.random() * 0.45 + 0.05,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.012 + 0.004,
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
        const col = roseColor();
        const size = Math.random() * 2.0 + 0.5;
        const baseOpacity = Math.random() * 0.5 + 0.3;

        // scatter randomly across screen
        const startX = (Math.random() - 0.5) * canvas.width * 1.8 + cx;
        const startY = (Math.random() - 0.5) * canvas.height * 1.8 + cy;

        particles.push({
          x: startX, y: startY,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          baseTx: hp.x, baseTy: hp.y,
          tx: hp.x, ty: hp.y,
          size,
          baseOpacity,
          opacity: 0,
          r: col.r, g: col.g, b: col.b,
          state: "drifting_free",
          // stagger gather: particles farther out start later
          gatherDelay: Math.floor(
            60 + (Math.abs(startX - cx) + Math.abs(startY - cy)) * 0.08 +
            Math.random() * 80
          ),
          driftAwayTimer: 0,
          driftAwayMax: 0,
          repulsed: false,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitR: Math.random() * 2.2 + 0.3,
          orbitSpeed: (Math.random() * 0.007 + 0.002) * (Math.random() < 0.5 ? 1 : -1),
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpeed: Math.random() * 0.06 + 0.02,
        });
      }
    }

    // ── draw single particle ─────────────────────────────────────────────
    function drawParticle(
      x: number, y: number,
      size: number, opacity: number,
      r: number, g: number, b: number,
      brightness = 1.0
    ) {
      const ro = Math.min(255, r * brightness);
      const go = Math.min(255, g * brightness);
      const bo = Math.min(255, b * brightness);
      const a = Math.min(1, opacity);

      // wide soft halo
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 7);
      halo.addColorStop(0, `rgba(${ro},${go},${bo},${a * 0.18})`);
      halo.addColorStop(1, `rgba(${ro},${go},${bo},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 7, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // inner glow
      const inner = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
      inner.addColorStop(0, `rgba(255,230,235,${Math.min(a * 1.3, 1)})`);
      inner.addColorStop(0.4, `rgba(${ro},${go},${bo},${a * 0.9})`);
      inner.addColorStop(1, `rgba(${ro},${go},${bo},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = inner;
      ctx.fill();

      // bright core
      ctx.beginPath();
      ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,240,245,${Math.min(a * 1.5, 1)})`;
      ctx.fill();
    }

    // ── heartbeat pulse function ─────────────────────────────────────────
    function getPulse(t: number): number {
      const period = 130;
      const phase = (t % period) / period;
      const b1 = Math.exp(-Math.pow((phase - 0.10) / 0.045, 2)) * 0.075;
      const b2 = Math.exp(-Math.pow((phase - 0.20) / 0.038, 2)) * 0.038;
      return 1 + b1 + b2;
    }

    // ── background ───────────────────────────────────────────────────────
    function drawBackground() {
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(canvas.width, canvas.height) * 0.85);
      bg.addColorStop(0, "#110818");
      bg.addColorStop(0.4, "#080510");
      bg.addColorStop(1, "#020308");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // twinkle stars
      for (const s of stars) {
        s.phase += s.speed;
        const a = s.opacity * (0.45 + 0.55 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,220,230,${a})`;
        ctx.fill();
      }
    }

    // ── heart ambient glow ───────────────────────────────────────────────
    function drawHeartGlow(cx: number, cy: number, scale: number, pulse: number) {
      const r = scale * 11 * pulse;
      const gb = globalBrightness;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(220,60,100,${0.06 * gb})`);
      g.addColorStop(0.4, `rgba(180,30,70,${0.04 * gb})`);
      g.addColorStop(1, "rgba(180,30,70,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // ── rising sparkles ──────────────────────────────────────────────────
    function drawSparkles(cx: number, cy: number, scale: number) {
      const count = 14;
      for (let i = 0; i < count; i++) {
        const seed = (beatTime * 0.35 + i * 91.7) % 800;
        const sx = cx + (((seed * 6.1) % 1) - 0.5) * scale * 26;
        const progress = (beatTime * 0.35 + i * 55) % (scale * 20);
        const sy = cy - scale * 9 - progress;
        const rawA = 1 - progress / (scale * 20);
        const a = Math.max(0, rawA * 0.3);
        drawParticle(sx, sy, 0.6, a, 255, 160, 180, globalBrightness);
      }
    }

    // ── ambient orbit ring ───────────────────────────────────────────────
    function drawOrbitRing(cx: number, cy: number, scale: number, pulse: number) {
      const count = 60;
      const baseR = scale * 18;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + beatTime * 0.0005;
        const r = baseR + Math.sin(beatTime * 0.002 + i * 0.8) * scale * 2.5;
        const ox = cx + Math.cos(ang) * r;
        const oy = cy + Math.sin(ang) * r * 0.72 - scale * 1.2;
        const a = (0.07 + 0.06 * Math.sin(beatTime * 0.012 + i * 0.35)) * pulse * globalBrightness;
        drawParticle(ox, oy, 0.55, a, 240, 120, 150, 1);
      }
    }

    // ── main loop ────────────────────────────────────────────────────────
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground();

      const cx = canvas.width / 2;
      const cy = canvas.height * 0.46;
      const scale = Math.min(canvas.width, canvas.height) * 0.0165;

      // smooth brightness
      const targetBrightness = brightenRef.current ? 1.6 : 1.0;
      globalBrightness += (targetBrightness - globalBrightness) * 0.007;

      const mouse = mouseRef.current;

      if (appPhase === "gathering") {
        gatherFrame++;

        for (const p of particles) {
          // fade in slowly
          p.opacity = Math.min(p.baseOpacity, p.opacity + 0.005);
          p.twinkle += p.twinkleSpeed;

          if (p.state === "drifting_free") {
            // slow natural drift until gather delay expires
            if (gatherFrame >= p.gatherDelay) {
              p.state = "gathering";
            } else {
              p.x += p.vx;
              p.y += p.vy;
              // gentle random drift
              p.vx += (Math.random() - 0.5) * 0.04;
              p.vy += (Math.random() - 0.5) * 0.04;
              p.vx *= 0.96;
              p.vy *= 0.96;
            }
          }

          if (p.state === "gathering") {
            // spring toward heart target
            const [nx, nvx] = springStep(p.x, p.vx, p.baseTx, 0.035, 0.78);
            const [ny, nvy] = springStep(p.y, p.vy, p.baseTy, 0.035, 0.78);
            p.x = nx; p.vx = nvx;
            p.y = ny; p.vy = nvy;

            const dx = p.baseTx - p.x;
            const dy = p.baseTy - p.y;
            if (dx * dx + dy * dy < 4) {
              p.state = "formed";
              p.x = p.baseTx;
              p.y = p.baseTy;
              p.vx = 0; p.vy = 0;
            }
          }

          const twinkleA = 0.8 + 0.2 * Math.sin(p.twinkle);
          drawParticle(p.x, p.y, p.size, p.opacity * twinkleA, p.r, p.g, p.b, globalBrightness);
        }

        // check all gathered
        const allFormed = gatherFrame > 200 && particles.every(p => p.state === "formed" || p.state === "gathering");
        const mostlyFormed = gatherFrame > 380;
        if (allFormed || mostlyFormed) {
          appPhase = "beating";
          // ensure all snapped
          for (const p of particles) {
            if (p.state !== "formed") {
              p.x = p.baseTx; p.y = p.baseTy;
              p.vx = 0; p.vy = 0;
              p.state = "formed";
            }
          }
        }
      } else {
        // ── beating phase ────────────────────────────────────────────
        beatTime++;
        const rawPulse = getPulse(beatTime);
        // smooth pulse
        beatPulse += (rawPulse - beatPulse) * 0.15;

        const heartPts = getHeartPoints(HEART_N, cx, cy, scale * beatPulse);
        for (let i = 0; i < HEART_N; i++) {
          particles[i].tx = heartPts[i].x;
          particles[i].ty = heartPts[i].y;
        }

        // random drift group
        driftCooldown--;
        if (driftCooldown <= 0) {
          driftCooldown = 190 + Math.floor(Math.random() * 150);
          const start = Math.floor(Math.random() * (HEART_N - DRIFT_GROUP));
          for (let i = start; i < start + DRIFT_GROUP; i++) {
            const p = particles[i];
            if (p.state === "formed") {
              p.state = "drifting_away";
              p.driftAwayTimer = 0;
              p.driftAwayMax = 80 + Math.floor(Math.random() * 70);
              const angle = Math.random() * Math.PI * 2;
              const speed = Math.random() * 1.6 + 0.6;
              p.vx = Math.cos(angle) * speed;
              p.vy = Math.sin(angle) * speed - 0.3;
            }
          }
        }

        // mouse repulsion: mark particles close to mouse
        const mx = mouse.x, my = mouse.y;
        const rr = REPULSE_RADIUS * REPULSE_RADIUS;

        for (const p of particles) {
          p.twinkle += p.twinkleSpeed;
          const twinkleA = 0.82 + 0.18 * Math.sin(p.twinkle);

          // repulsion check
          const rdx = p.x - mx;
          const rdy = p.y - my;
          const rd2 = rdx * rdx + rdy * rdy;
          if (rd2 < rr && rd2 > 0.01) {
            const rd = Math.sqrt(rd2);
            const strength = (1 - rd / REPULSE_RADIUS) * REPULSE_FORCE;
            p.vx += (rdx / rd) * strength;
            p.vy += (rdy / rd) * strength;
            if (p.state === "formed") p.state = "scattered";
            p.repulsed = true;
          } else {
            p.repulsed = false;
          }

          if (p.state === "formed") {
            // micro orbit at heart target
            p.orbitAngle += p.orbitSpeed;
            const ox = p.tx + Math.cos(p.orbitAngle) * p.orbitR;
            const oy = p.ty + Math.sin(p.orbitAngle) * p.orbitR;
            p.x += (ox - p.x) * 0.15;
            p.y += (oy - p.y) * 0.15;

          } else if (p.state === "drifting_away") {
            p.driftAwayTimer++;
            if (p.driftAwayTimer < p.driftAwayMax * 0.45) {
              // drift outward
              p.x += p.vx;
              p.y += p.vy;
              p.vx *= 0.94;
              p.vy *= 0.94;
            } else {
              // spring back — with overshoot
              const [nx, nvx] = springStep(p.x, p.vx, p.tx, 0.055, 0.74, 1.12);
              const [ny, nvy] = springStep(p.y, p.vy, p.ty, 0.055, p.vy < 0 ? 0.74 : 0.74, 1.12);
              p.x = nx; p.vx = nvx;
              p.y = ny; p.vy = nvy;

              const dx = p.tx - p.x;
              const dy = p.ty - p.y;
              if (dx * dx + dy * dy < 3 && Math.abs(p.vx) < 0.3 && Math.abs(p.vy) < 0.3) {
                p.state = "formed";
                p.vx = 0; p.vy = 0;
              }
            }

            if (p.driftAwayTimer > p.driftAwayMax + 60) {
              p.state = "formed";
              p.x = p.tx; p.y = p.ty;
              p.vx = 0; p.vy = 0;
            }

          } else if (p.state === "scattered") {
            // spring return from mouse repulsion
            p.vx *= 0.88;
            p.vy *= 0.88;
            const [nx, nvx] = springStep(p.x, p.vx, p.tx, 0.042, 0.76, 1.08);
            const [ny, nvy] = springStep(p.y, p.vy, p.ty, 0.042, 0.76, 1.08);
            p.x = nx; p.vx = nvx;
            p.y = ny; p.vy = nvy;

            const dx = p.tx - p.x;
            const dy = p.ty - p.y;
            if (dx * dx + dy * dy < 6 && Math.abs(p.vx) < 0.25 && Math.abs(p.vy) < 0.25) {
              p.state = "formed";
              p.vx = 0; p.vy = 0;
            }
          }

          const op = p.baseOpacity * twinkleA * globalBrightness;
          drawParticle(p.x, p.y, p.size, op, p.r, p.g, p.b, 1.0);
        }

        drawHeartGlow(cx, cy, scale, beatPulse);
        drawOrbitRing(cx, cy, scale, beatPulse);
        drawSparkles(cx, cy, scale);
      }

      raf = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  // ── mouse / touch tracking ────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;

    function onMove(x: number, y: number) {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: x - rect.left, y: y - rect.top, active: true };
    }
    function onLeave() {
      mouseRef.current = { x: -9999, y: -9999, active: false };
    }
    function onMouseMove(e: MouseEvent) { onMove(e.clientX, e.clientY); }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
    }

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("touchmove", onTouchMove, { passive: true });
    canvas.addEventListener("touchend", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onLeave);
    };
  }, []);

  // ── text sequence ─────────────────────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current!;
    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise<void>((res) => { const t = setTimeout(res, ms); if (cancelled) clearTimeout(t); });

    const animate = (elem: HTMLElement, from: number, to: number, ms: number) =>
      new Promise<void>((res) => {
        const start = performance.now();
        const step = (now: number) => {
          if (cancelled) { res(); return; }
          const f = easeInOutCubic(Math.min((now - start) / ms, 1));
          elem.style.opacity = String(from + (to - from) * f);
          if (f < 1) requestAnimationFrame(step); else res();
        };
        requestAnimationFrame(step);
      });

    async function run() {
      // wait for heart to finish forming
      await sleep(5000);
      if (cancelled) return;

      for (const msg of MESSAGES) {
        if (cancelled) return;
        const div = document.createElement("div");
        div.textContent = msg.text;
        div.style.cssText = `
          position:absolute;
          left:50%;bottom:15%;
          transform:translateX(-50%);
          opacity:0;
          color:rgba(255,230,235,0.90);
          font-family:'Cormorant Garamond',Georgia,serif;
          font-size:clamp(15px,2.8vw,27px);
          font-style:italic;font-weight:300;
          letter-spacing:0.08em;
          text-align:center;
          text-shadow:0 0 30px rgba(255,120,150,0.5),0 0 70px rgba(220,60,100,0.2);
          white-space:nowrap;max-width:90vw;
          pointer-events:none;
        `;
        el.appendChild(div);
        if (msg.brighten) brightenRef.current = true;
        await animate(div, 0, 1, 1400);
        await sleep(msg.pause);
        await animate(div, 1, 0, 900);
        el.removeChild(div);
        await sleep(280);
      }
      if (cancelled) return;

      // final message
      const wrap = document.createElement("div");
      wrap.style.cssText = `
        position:absolute;left:50%;bottom:9%;
        transform:translateX(-50%);
        text-align:center;opacity:0;
        pointer-events:none;width:90vw;max-width:660px;
      `;

      const title = document.createElement("div");
      title.textContent = FINAL_TITLE;
      title.style.cssText = `
        font-family:'Cormorant Garamond',Georgia,serif;
        font-size:clamp(22px,4vw,46px);
        font-weight:400;font-style:italic;
        letter-spacing:0.06em;
        color:rgba(255,235,240,0.97);
        text-shadow:0 0 40px rgba(255,120,150,0.7),0 0 90px rgba(220,60,100,0.3);
        margin-bottom:26px;line-height:1.3;
      `;

      const body = document.createElement("div");
      body.textContent = FINAL_BODY;
      body.style.cssText = `
        font-family:'Inter',system-ui,sans-serif;
        font-size:clamp(12px,1.8vw,17px);
        font-weight:300;letter-spacing:0.05em;
        color:rgba(255,200,215,0.65);
        text-shadow:0 0 20px rgba(255,100,130,0.2);
        line-height:2;white-space:pre-line;
      `;

      wrap.appendChild(title);
      wrap.appendChild(body);
      el.appendChild(wrap);
      await animate(wrap, 0, 1, 2400);
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
