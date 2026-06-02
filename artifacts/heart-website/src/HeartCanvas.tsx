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

// ── Spring physics ───────────────────────────────────────────────────────
// Lower damping (< 0.85) produces natural overshoot before settling
function springStep(
  pos: number, vel: number, target: number,
  stiffness = 0.055, damping = 0.76
): [number, number] {
  const newVel = (vel + (target - pos) * stiffness) * damping;
  return [pos + newVel, newVel];
}

// ── Rose-pink color ──────────────────────────────────────────────────────
function roseColor() {
  const v = Math.random();
  if (v < 0.35) return { r: 255, g: 110 + Math.random() * 60, b: 140 + Math.random() * 55 };
  if (v < 0.60) return { r: 238 + Math.random() * 17, g: 155 + Math.random() * 45, b: 175 + Math.random() * 45 };
  if (v < 0.80) return { r: 255, g: 198 + Math.random() * 30, b: 208 + Math.random() * 22 };
  return               { r: 195 + Math.random() * 35, g: 55 + Math.random() * 40, b: 85 + Math.random() * 40 };
}

// ── Particle state ───────────────────────────────────────────────────────
type PState = "drifting_free" | "gathering" | "formed" | "scattered" | "drifting_away" | "easter_egg";

interface Particle {
  x: number; y: number; vx: number; vy: number;
  baseTx: number; baseTy: number;   // unpulsed heart position
  tx: number; ty: number;           // current pulsed target
  etx: number; ety: number;         // easter-egg text target
  size: number;
  baseOpacity: number; opacity: number;
  r: number; g: number; b: number;
  state: PState;
  gatherDelay: number;
  driftAwayTimer: number; driftAwayMax: number;
  orbitAngle: number; orbitR: number; orbitSpeed: number;
  twinkle: number; twinkleSpeed: number;
}

interface Star { x: number; y: number; size: number; opacity: number; phase: number; speed: number; }

// ── Text messages ────────────────────────────────────────────────────────
const MESSAGES = [
  { text: "Some days are harder than others.",          pause: 3000 },
  { text: "Some days feel overwhelming.",               pause: 3000 },
  { text: "Some days things don't go the way we hoped.", pause: 3200 },
  { text: "But even then...",                           pause: 2500 },
  { text: "I'm still here.",                            pause: 4500, brighten: true },
];
const FINAL_TITLE = "Happy Monthsary, Honey ❤️";
const FINAL_BODY =
  "There may be a lot of things changing around us right now,\nbut my choice remains the same.\n\nIt will always be you, hon.";

// ── Sample text pixels from an offscreen canvas ──────────────────────────
function sampleTextPixels(
  text: string, canvasW: number, canvasH: number,
  cx: number, cy: number, scale: number
): { x: number; y: number }[] {
  const W = Math.floor(scale * 36);
  const H = Math.floor(scale * 12);
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const c = tmp.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#fff";
  const fs = Math.max(10, Math.floor(H * 0.55));
  c.font = `300 ${fs}px 'Cormorant Garamond', Georgia, serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, W / 2, H / 2);
  const data = c.getImageData(0, 0, W, H).data;
  const pts: { x: number; y: number }[] = [];
  const step = 2;
  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      if (data[(y * W + x) * 4] > 100) {
        // map to canvas coordinates centred on heart
        pts.push({
          x: cx + (x - W / 2) * 1.1,
          y: cy + (y - H / 2) * 1.1,
        });
      }
    }
  }
  return pts;
}

// ── Component ────────────────────────────────────────────────────────────
export default function HeartCanvas() {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const overlayRef   = useRef<HTMLDivElement>(null);

  // Shared state between useEffects (no re-renders needed)
  const brightenRef      = useRef(false);
  const finalStateRef    = useRef(false);
  const mouseRef         = useRef({ x: -9999, y: -9999 });
  // Beat sync: canvas sets resolver; text sequence awaits it
  const beatResolverRef  = useRef<(() => void) | null>(null);
  const waitForBeatRef   = useRef<() => Promise<void>>(() => Promise.resolve());
  // Disturbance (0–1): exposed to text sequence to subtly stall if heart is disturbed
  const disturbanceRef   = useRef(0);
  // Easter egg
  const eggPhaseRef      = useRef<"idle" | "forming" | "holding" | "dissolving">("idle");
  const eggTimerRef      = useRef(0);

  // ── Canvas / animation ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf: number;

    const HEART_N       = 2400;
    const STAR_N        = 260;
    const REPULSE_R     = 115;
    const REPULSE_F     = 3.5;
    const BEAT_PERIOD   = 130;      // frames per heartbeat cycle
    const BEAT_PEAK_PH  = 0.10;    // normalised phase where first bump peaks

    const particles: Particle[] = [];
    const stars: Star[]         = [];

    let appPhase: "gathering" | "beating" = "gathering";
    let gatherFrame  = 0;
    let beatTime     = 0;
    let beatPulse    = 1.0;
    let driftCooldown = 280;
    let globalBrightness = 1.0;
    let pulseStrength    = 1.0;   // 0.4–1.0; reduced when heart is disturbed
    let prevPhase        = 0;     // to detect beat peak crossing

    // Egg particles: first ~500 particles are commandeered for easter egg
    const EGG_N = 500;

    // ── waitForBeat ────────────────────────────────────────────────────
    waitForBeatRef.current = () =>
      new Promise<void>((resolve) => { beatResolverRef.current = resolve; });

    // ── resize & build ─────────────────────────────────────────────────
    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      buildStars();
      buildParticles();
      appPhase    = "gathering";
      gatherFrame = 0;
      beatTime    = 0;
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
        const hp  = heartPts[i];
        const col = roseColor();
        const sx  = (Math.random() - 0.5) * canvas.width  * 1.8 + cx;
        const sy  = (Math.random() - 0.5) * canvas.height * 1.8 + cy;
        particles.push({
          x: sx, y: sy, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          baseTx: hp.x, baseTy: hp.y,
          tx: hp.x, ty: hp.y,
          etx: hp.x, ety: hp.y,
          size: Math.random() * 2.0 + 0.5,
          baseOpacity: Math.random() * 0.5 + 0.3,
          opacity: 0,
          r: col.r, g: col.g, b: col.b,
          state: "drifting_free",
          gatherDelay: Math.floor(
            60 + (Math.abs(sx - cx) + Math.abs(sy - cy)) * 0.08 + Math.random() * 80
          ),
          driftAwayTimer: 0, driftAwayMax: 0,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitR: Math.random() * 2.2 + 0.3,
          orbitSpeed: (Math.random() * 0.007 + 0.002) * (Math.random() < 0.5 ? 1 : -1),
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpeed: Math.random() * 0.06 + 0.02,
        });
      }
    }

    // ── draw a single glowing particle ──────────────────────────────────
    function drawParticle(
      x: number, y: number, size: number, opacity: number,
      r: number, g: number, b: number
    ) {
      const a = Math.min(1, Math.max(0, opacity));
      if (a < 0.01) return;

      // soft wide halo
      const halo = ctx.createRadialGradient(x, y, 0, x, y, size * 7);
      halo.addColorStop(0, `rgba(${r},${g},${b},${a * 0.17})`);
      halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 7, 0, Math.PI * 2);
      ctx.fillStyle = halo;
      ctx.fill();

      // inner glow
      const inner = ctx.createRadialGradient(x, y, 0, x, y, size * 2.5);
      inner.addColorStop(0, `rgba(255,228,232,${Math.min(a * 1.35, 1)})`);
      inner.addColorStop(0.4, `rgba(${r},${g},${b},${a * 0.88})`);
      inner.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.beginPath();
      ctx.arc(x, y, size * 2.5, 0, Math.PI * 2);
      ctx.fillStyle = inner;
      ctx.fill();

      // bright core
      ctx.beginPath();
      ctx.arc(x, y, size * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,242,245,${Math.min(a * 1.5, 1)})`;
      ctx.fill();
    }

    // ── heartbeat pulse ─────────────────────────────────────────────────
    function getRawPulse(t: number): number {
      const phase = (t % BEAT_PERIOD) / BEAT_PERIOD;
      const b1 = Math.exp(-Math.pow((phase - 0.10) / 0.045, 2)) * 0.075;
      const b2 = Math.exp(-Math.pow((phase - 0.20) / 0.038, 2)) * 0.038;
      return 1 + (b1 + b2) * pulseStrength;
    }

    // ── background ───────────────────────────────────────────────────────
    function drawBackground() {
      const cx = canvas.width / 2, cy = canvas.height / 2;
      const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(canvas.width, canvas.height) * 0.85);
      bg.addColorStop(0, "#110818");
      bg.addColorStop(0.4, "#080510");
      bg.addColorStop(1, "#020308");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        s.phase += s.speed;
        const a = s.opacity * (0.45 + 0.55 * Math.sin(s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,215,225,${a})`;
        ctx.fill();
      }
    }

    // ── heart ambient glow ───────────────────────────────────────────────
    function drawHeartGlow(cx: number, cy: number, scale: number) {
      // Glow is warmer and stronger in final state, dimmer when disturbed
      const baseAlpha = finalStateRef.current ? 0.09 : 0.06;
      const alpha = baseAlpha * globalBrightness * (1 - disturbanceRef.current * 0.5) * beatPulse;
      const radius = scale * (finalStateRef.current ? 13 : 11) * beatPulse;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, `rgba(230,70,110,${alpha})`);
      g.addColorStop(0.4, `rgba(180,30,70,${alpha * 0.65})`);
      g.addColorStop(1, "rgba(180,30,70,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    }

    // ── orbit ring ───────────────────────────────────────────────────────
    function drawOrbitRing(cx: number, cy: number, scale: number) {
      const count = 60;
      const baseR = scale * 18;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 + beatTime * 0.0005;
        const r = baseR + Math.sin(beatTime * 0.002 + i * 0.8) * scale * 2.5;
        const ox = cx + Math.cos(ang) * r;
        const oy = cy + Math.sin(ang) * r * 0.72 - scale * 1.2;
        const a = (0.065 + 0.055 * Math.sin(beatTime * 0.012 + i * 0.35)) * beatPulse * globalBrightness;
        drawParticle(ox, oy, 0.55, a, 240, 120, 150);
      }
    }

    // ── rising sparkles ──────────────────────────────────────────────────
    function drawSparkles(cx: number, cy: number, scale: number) {
      for (let i = 0; i < 14; i++) {
        const seed = (beatTime * 0.35 + i * 91.7) % 800;
        const sx = cx + (((seed * 6.1) % 1) - 0.5) * scale * 26;
        const progress = (beatTime * 0.35 + i * 55) % (scale * 20);
        const sy = cy - scale * 9 - progress;
        const a = Math.max(0, (1 - progress / (scale * 20)) * 0.28 * globalBrightness);
        drawParticle(sx, sy, 0.6, a, 255, 160, 180);
      }
    }

    // ── easter egg activation ────────────────────────────────────────────
    function activateEasterEgg() {
      if (eggPhaseRef.current !== "idle" || appPhase !== "beating") return;
      const cx  = canvas.width / 2;
      const cy  = canvas.height * 0.46;
      const sc  = Math.min(canvas.width, canvas.height) * 0.0165;
      const pts = sampleTextPixels("For Mary Iris ❤️", canvas.width, canvas.height, cx, cy - sc * 5, sc);
      if (pts.length === 0) return;

      // Assign egg targets to first EGG_N particles
      const use = Math.min(EGG_N, pts.length, HEART_N);
      // Shuffle pts to pick uniformly distributed text pixels
      for (let i = pts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pts[i], pts[j]] = [pts[j], pts[i]];
      }
      for (let i = 0; i < use; i++) {
        const p = particles[i];
        p.etx = pts[i].x;
        p.ety = pts[i].y;
        p.state = "easter_egg";
        p.vx = 0; p.vy = 0;
      }
      eggPhaseRef.current = "forming";
      eggTimerRef.current = 0;
    }

    // ── main loop ────────────────────────────────────────────────────────
    function tick() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawBackground();

      const cx    = canvas.width / 2;
      const cy    = canvas.height * 0.46;
      const scale = Math.min(canvas.width, canvas.height) * 0.0165;
      const mx    = mouseRef.current.x;
      const my    = mouseRef.current.y;
      const rr    = REPULSE_R * REPULSE_R;

      // ── Gathering phase ──────────────────────────────────────────────
      if (appPhase === "gathering") {
        gatherFrame++;
        for (const p of particles) {
          p.opacity = Math.min(p.baseOpacity, p.opacity + 0.005);
          p.twinkle += p.twinkleSpeed;

          if (p.state === "drifting_free") {
            if (gatherFrame >= p.gatherDelay) {
              p.state = "gathering";
            } else {
              p.vx += (Math.random() - 0.5) * 0.04; p.vy += (Math.random() - 0.5) * 0.04;
              p.vx *= 0.96; p.vy *= 0.96;
              p.x += p.vx;  p.y += p.vy;
            }
          }
          if (p.state === "gathering") {
            [p.x, p.vx] = springStep(p.x, p.vx, p.baseTx, 0.032, 0.80);
            [p.y, p.vy] = springStep(p.y, p.vy, p.baseTy, 0.032, 0.80);
            const dx = p.baseTx - p.x, dy = p.baseTy - p.y;
            if (dx * dx + dy * dy < 4) {
              p.state = "formed"; p.x = p.baseTx; p.y = p.baseTy; p.vx = 0; p.vy = 0;
            }
          }
          const ta = 0.80 + 0.20 * Math.sin(p.twinkle);
          drawParticle(p.x, p.y, p.size, p.opacity * ta, p.r, p.g, p.b);
        }

        const mostlyFormed = gatherFrame > 380;
        if (mostlyFormed) {
          appPhase = "beating";
          for (const p of particles) {
            if (p.state !== "formed") {
              p.x = p.baseTx; p.y = p.baseTy; p.vx = 0; p.vy = 0; p.state = "formed";
            }
          }
        }
        raf = requestAnimationFrame(tick);
        return;
      }

      // ── Beating phase ────────────────────────────────────────────────
      beatTime++;

      // ── Beat peak detection → fire beat signal ────────────────────
      const curPhase = (beatTime % BEAT_PERIOD) / BEAT_PERIOD;
      if (prevPhase < BEAT_PEAK_PH && curPhase >= BEAT_PEAK_PH) {
        if (beatResolverRef.current) {
          beatResolverRef.current();
          beatResolverRef.current = null;
        }
      }
      prevPhase = curPhase;

      // ── Disturbance factor ──────────────────────────────────────────
      let distCount = 0;
      for (const p of particles) {
        if (p.state === "scattered" || p.state === "drifting_away") distCount++;
      }
      const rawDisturbance = distCount / HEART_N;
      disturbanceRef.current += (rawDisturbance - disturbanceRef.current) * 0.04;
      const d = disturbanceRef.current;

      // ── Emotional feedback: beat strength & brightness ───────────────
      const targetPulseStrength = 1 - d * 0.52;   // weaker beat when disturbed
      pulseStrength += (targetPulseStrength - pulseStrength) * 0.025;

      const finalBoost = finalStateRef.current ? 0.18 : 0;
      const brightenBoost = brightenRef.current ? 0.6 : 0;
      const targetBrightness = 1.0 + brightenBoost + finalBoost - d * 0.38;
      globalBrightness += (Math.max(0.4, targetBrightness) - globalBrightness) * 0.008;

      // ── Pulse ────────────────────────────────────────────────────────
      const rawPulse = getRawPulse(beatTime);
      beatPulse += (rawPulse - beatPulse) * 0.15;

      // ── Update heart targets ─────────────────────────────────────────
      const heartPts = getHeartPoints(HEART_N, cx, cy, scale * beatPulse);
      for (let i = 0; i < HEART_N; i++) {
        particles[i].tx = heartPts[i].x;
        particles[i].ty = heartPts[i].y;
      }

      // ── Random drift groups ──────────────────────────────────────────
      // Fewer drifters in final state
      const driftGroupSize = finalStateRef.current ? 35 : 90;
      driftCooldown--;
      if (driftCooldown <= 0) {
        driftCooldown = (finalStateRef.current ? 310 : 190) + Math.floor(Math.random() * 150);
        const start = Math.floor(Math.random() * (HEART_N - driftGroupSize));
        for (let i = start; i < start + driftGroupSize; i++) {
          const p = particles[i];
          if (p.state === "formed") {
            p.state = "drifting_away";
            p.driftAwayTimer = 0;
            p.driftAwayMax   = 80 + Math.floor(Math.random() * 70);
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 1.5 + 0.5;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.3;
          }
        }
      }

      // ── Easter egg timer ─────────────────────────────────────────────
      if (eggPhaseRef.current === "forming" || eggPhaseRef.current === "holding") {
        eggTimerRef.current++;
        // After ~3.5 s holding, dissolve
        if (eggPhaseRef.current === "holding" && eggTimerRef.current > 210) {
          eggPhaseRef.current = "dissolving";
          eggTimerRef.current = 0;
        }
        // Transition forming → holding when particles settle
        if (eggPhaseRef.current === "forming" && eggTimerRef.current > 90) {
          eggPhaseRef.current = "holding";
          eggTimerRef.current = 0;
        }
      }

      // ── Per-particle update ──────────────────────────────────────────
      for (const p of particles) {
        p.twinkle += p.twinkleSpeed;
        const ta = 0.82 + 0.18 * Math.sin(p.twinkle);

        // Mouse repulsion (skip easter-egg particles mid-display)
        if (p.state !== "easter_egg") {
          const rdx = p.x - mx, rdy = p.y - my;
          const rd2 = rdx * rdx + rdy * rdy;
          if (rd2 < rr && rd2 > 0.01) {
            const rd  = Math.sqrt(rd2);
            const str = (1 - rd / REPULSE_R) * REPULSE_F;
            p.vx += (rdx / rd) * str;
            p.vy += (rdy / rd) * str;
            if (p.state === "formed") p.state = "scattered";
          }
        }

        // State machine
        if (p.state === "easter_egg") {
          // Spring toward egg target
          [p.x, p.vx] = springStep(p.x, p.vx, p.etx, 0.06, 0.74);
          [p.y, p.vy] = springStep(p.y, p.vy, p.ety, 0.06, 0.74);
          // When dissolving, spring back to heart
          if (eggPhaseRef.current === "dissolving") {
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, 0.05, 0.76);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, 0.05, 0.76);
            const dx = p.tx - p.x, dy = p.ty - p.y;
            if (dx * dx + dy * dy < 8 && Math.abs(p.vx) < 0.3 && Math.abs(p.vy) < 0.3) {
              p.state = "formed"; p.vx = 0; p.vy = 0;
            }
          }

        } else if (p.state === "formed") {
          // Micro-orbit
          p.orbitAngle += p.orbitSpeed;
          const ox = p.tx + Math.cos(p.orbitAngle) * p.orbitR;
          const oy = p.ty + Math.sin(p.orbitAngle) * p.orbitR;
          p.x += (ox - p.x) * 0.15;
          p.y += (oy - p.y) * 0.15;

        } else if (p.state === "drifting_away") {
          p.driftAwayTimer++;
          if (p.driftAwayTimer < p.driftAwayMax * 0.45) {
            p.x += p.vx; p.y += p.vy;
            p.vx *= 0.94; p.vy *= 0.94;
          } else {
            // Spring return with natural overshoot (damping < 0.85)
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, 0.055, 0.73);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, 0.055, 0.73);
            const dx = p.tx - p.x, dy = p.ty - p.y;
            if (dx * dx + dy * dy < 4 && Math.abs(p.vx) < 0.25 && Math.abs(p.vy) < 0.25) {
              p.state = "formed"; p.vx = 0; p.vy = 0;
            }
          }
          if (p.driftAwayTimer > p.driftAwayMax + 80) {
            p.state = "formed"; p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0;
          }

        } else if (p.state === "scattered") {
          // Spring return from mouse push — lower stiffness for graceful arc
          [p.x, p.vx] = springStep(p.x, p.vx, p.tx, 0.038, 0.75);
          [p.y, p.vy] = springStep(p.y, p.vy, p.ty, 0.038, 0.75);
          const dx = p.tx - p.x, dy = p.ty - p.y;
          if (dx * dx + dy * dy < 6 && Math.abs(p.vx) < 0.22 && Math.abs(p.vy) < 0.22) {
            p.state = "formed"; p.vx = 0; p.vy = 0;
          }
        }

        const op = p.baseOpacity * ta * globalBrightness;
        drawParticle(p.x, p.y, p.size, op, p.r, p.g, p.b);
      }

      // Check if dissolving is done (all egg particles returned)
      if (eggPhaseRef.current === "dissolving") {
        const stillEgg = particles.slice(0, EGG_N).some(p => p.state === "easter_egg");
        if (!stillEgg) eggPhaseRef.current = "idle";
      }

      drawHeartGlow(cx, cy, scale);
      drawOrbitRing(cx, cy, scale);
      drawSparkles(cx, cy, scale);

      raf = requestAnimationFrame(tick);
    }

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);

    // ── Click → easter egg ───────────────────────────────────────────────
    function onCanvasClick(e: MouseEvent | TouchEvent) {
      if (appPhase !== "beating") return;
      const rect = canvas.getBoundingClientRect();
      const cx   = canvas.width / 2;
      const cy   = canvas.height * 0.46;
      const scale = Math.min(canvas.width, canvas.height) * 0.0165;
      const hitR  = scale * 18; // generous hit zone around heart
      let px: number, py: number;
      if ("touches" in e) {
        px = e.touches[0].clientX - rect.left;
        py = e.touches[0].clientY - rect.top;
      } else {
        px = (e as MouseEvent).clientX - rect.left;
        py = (e as MouseEvent).clientY - rect.top;
      }
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy < hitR * hitR) {
        activateEasterEgg();
      }
    }

    canvas.addEventListener("click", onCanvasClick);
    canvas.addEventListener("touchstart", onCanvasClick, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("click", onCanvasClick);
      canvas.removeEventListener("touchstart", onCanvasClick);
    };
  }, []);

  // ── Mouse / touch move tracking ────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    function onMove(x: number, y: number) {
      const r = canvas.getBoundingClientRect();
      mouseRef.current = { x: x - r.left, y: y - r.top };
    }
    function onLeave() { mouseRef.current = { x: -9999, y: -9999 }; }
    const mm = (e: MouseEvent) => onMove(e.clientX, e.clientY);
    const tm = (e: TouchEvent) => { if (e.touches.length) onMove(e.touches[0].clientX, e.touches[0].clientY); };
    canvas.addEventListener("mousemove", mm);
    canvas.addEventListener("mouseleave", onLeave);
    canvas.addEventListener("touchmove", tm, { passive: true });
    canvas.addEventListener("touchend", onLeave);
    return () => {
      canvas.removeEventListener("mousemove", mm);
      canvas.removeEventListener("mouseleave", onLeave);
      canvas.removeEventListener("touchmove", tm);
      canvas.removeEventListener("touchend", onLeave);
    };
  }, []);

  // ── Text sequence ──────────────────────────────────────────────────────
  useEffect(() => {
    const el = overlayRef.current!;
    let cancelled = false;

    const sleep = (ms: number) =>
      new Promise<void>((res) => { const t = setTimeout(res, ms); if (cancelled) clearTimeout(t); });

    const fadeAnim = (elem: HTMLElement, from: number, to: number, ms: number) =>
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

    // Wait for next heartbeat using the shared signal
    const waitBeat = () => {
      if (cancelled) return Promise.resolve();
      return waitForBeatRef.current();
    };

    async function run() {
      // Wait for heart to finish forming, then sync to next beat
      await sleep(5200);
      if (cancelled) return;

      for (const msg of MESSAGES) {
        if (cancelled) return;

        // Sync text reveal to the next heartbeat peak
        await waitBeat();
        if (cancelled) return;

        const div = document.createElement("div");
        div.textContent = msg.text;
        div.style.cssText = `
          position:absolute;
          left:50%;bottom:15%;
          transform:translateX(-50%);
          opacity:0;
          color:rgba(255,228,234,0.90);
          font-family:'Cormorant Garamond',Georgia,serif;
          font-size:clamp(15px,2.8vw,27px);
          font-style:italic;font-weight:300;
          letter-spacing:0.08em;
          text-align:center;
          text-shadow:0 0 30px rgba(255,110,145,0.5),0 0 70px rgba(215,55,95,0.2);
          white-space:nowrap;max-width:90vw;
          pointer-events:none;
        `;
        el.appendChild(div);

        if (msg.brighten) brightenRef.current = true;

        await fadeAnim(div, 0, 1, 1200);
        await sleep(msg.pause);
        await fadeAnim(div, 1, 0, 900);
        el.removeChild(div);
        await sleep(260);
      }
      if (cancelled) return;

      // Signal final state → calmer, warmer heart
      finalStateRef.current = true;

      await waitBeat();
      if (cancelled) return;

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
        text-shadow:0 0 40px rgba(255,110,145,0.7),0 0 90px rgba(215,55,95,0.3);
        margin-bottom:26px;line-height:1.3;
      `;

      const body = document.createElement("div");
      body.textContent = FINAL_BODY;
      body.style.cssText = `
        font-family:'Inter',system-ui,sans-serif;
        font-size:clamp(12px,1.8vw,17px);
        font-weight:300;letter-spacing:0.05em;
        color:rgba(255,198,212,0.65);
        text-shadow:0 0 20px rgba(255,90,125,0.2);
        line-height:2;white-space:pre-line;
      `;

      wrap.appendChild(title);
      wrap.appendChild(body);
      el.appendChild(wrap);
      await fadeAnim(wrap, 0, 1, 2400);
    }

    run();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, display: "block", cursor: "default" }}
      />
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}
