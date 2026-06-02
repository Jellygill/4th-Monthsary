import { useEffect, useRef, useState } from "react";

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

// ── Smoothstep easing ─────────────────────────────────────────────────────
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
  sprite: HTMLCanvasElement;        // pre-rendered hardware-accelerated sprite
  state: PState;
  gatherDelay: number;
  driftAwayTimer: number; driftAwayMax: number;
  orbitAngle: number; orbitR: number; orbitSpeed: number;
  twinkle: number; twinkleSpeed: number;
  // Per-particle spring personality for organic recovery
  returnStiffness: number;  // varied per particle so they don't all snap back at once
  returnDamping: number;    // slight damping variety produces gentle overshoot differences
}

interface Star { x: number; y: number; size: number; opacity: number; phase: number; speed: number; }

// ── Text messages ────────────────────────────────────────────────────────
const MESSAGES = [
  { text: "Some days are harder than others.",           pause: 2500 },
  { text: "Some days feel overwhelming.",                pause: 2500 },
  { text: "Some days things don't go the way we hoped.", pause: 2800 },
  { text: "But even then...",                            pause: 2200 },
  { text: "We're still both here.",                      pause: 3200, brighten: true },
  { text: "And we'll keep going together.",              pause: 3200, brighten: true },
];
const FINAL_TITLE = "Happy 4th Monthsary, Honey 🩷";
const FINAL_BODY =
  "There may be a lot of things changing around us right now,\nbut my choice remains the same.\n\nIt will always be you, hon.";

// ── Sample text pixels from an offscreen canvas ──────────────────────────
// Returns a FIXED-SIZE array of exactly `targetCount` points spread evenly
// across all detected letter pixels — guaranteeing every character is
// represented regardless of string length or raw pixel count.
function sampleTextPixels(
  text: string, canvasW: number, canvasH: number,
  cx: number, cy: number, _scale: number,
  targetCount: number
): { x: number; y: number }[] {
  const W = Math.floor(canvasW * 0.88);
  // Taller canvas = thicker strokes for better particle density
  const H = Math.floor(canvasH * 0.22);
  const tmp = document.createElement("canvas");
  tmp.width = W; tmp.height = H;
  const c = tmp.getContext("2d")!;
  c.fillStyle = "#000";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#fff";
  let fs = Math.max(20, Math.floor(H * 0.52));
  c.font = `900 ${fs}px Arial, sans-serif`;
  while (c.measureText(text).width > W * 0.90 && fs > 13) {
    fs -= 1;
    c.font = `900 ${fs}px Arial, sans-serif`;
  }
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, W / 2, H / 2);
  const data = c.getImageData(0, 0, W, H).data;
  // Collect ALL lit pixels first
  const all: { x: number; y: number }[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4] > 30) {
        all.push({
          x: cx + (x - W / 2),
          y: cy - _scale * 7 + (y - H / 2),
        });
      }
    }
  }
  if (all.length === 0) return [];
  // Sub-sample evenly so we always return exactly targetCount points
  // spread proportionally across the full character set.
  const out: { x: number; y: number }[] = [];
  const use = Math.min(targetCount, all.length);
  const stride = all.length / use;
  for (let i = 0; i < use; i++) {
    out.push(all[Math.floor(i * stride)]);
  }
  return out;
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
  const eggClickCountRef = useRef(0);

  // ── Canvas / animation ──────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf: number;

    const isMobile      = window.innerWidth < 768;
    const HEART_N       = isMobile ? 1500 : 2400;
    const STAR_N        = isMobile ? 150 : 300;
    // Repulsion parameters — wider breeze area, gentle force, plus cursor dragging!
    const REPULSE_R     = 165;   // noticeably wider interaction breeze (flowing water splash)
    const REPULSE_F     = 0.26;  // gentler push so interaction feels calm and readable
    const REPULSE_DEAD  = 8;     // tiny dead-zone at cursor centre
    const BEAT_PERIOD   = 185;      // slower, calmer heartbeat cycle
    const BEAT_PEAK_PH  = 0.10;    // normalised phase where first bump peaks

    const particles: Particle[] = [];
    const stars: Star[]         = [];

    let appPhase: "gathering" | "beating" = "gathering";
    let gatherFrame  = 0;
    let beatTime     = 0;
    let beatPulse    = 1.0;
    let driftCooldown = 280;
    let globalBrightness = 1.0;
    let pulseStrength    = 1.0;   // weakens when disturbed, recovers organically
    let prevPhase        = 0;     // to detect beat peak crossing
    // Track how many particles are currently displaced (0–1 normalised)
    let displacedFraction = 0.0;  // rises as particles scatter, falls as they return

    // Mouse tracking velocity
    let prevMx = -9999;
    let prevMy = -9999;

    // Keep enough particles in the heart so the shape never looks cut in half.
    const EGG_N = Math.min(1200, Math.floor(HEART_N * 0.42));

    // ── waitForBeat ────────────────────────────────────────────────────
    waitForBeatRef.current = () =>
      new Promise<void>((resolve) => { beatResolverRef.current = resolve; });

    // ── Pre-rendered sprites for 60 FPS performance on mobile ───
    const sprites: HTMLCanvasElement[] = [];
    const SPRITE_COUNT = 16;
    const SPRITE_SIZE = 64;

    function buildSprites() {
      sprites.length = 0;
      for (let i = 0; i < SPRITE_COUNT; i++) {
        const sCanvas = document.createElement("canvas");
        sCanvas.width = SPRITE_SIZE;
        sCanvas.height = SPRITE_SIZE;
        const sctx = sCanvas.getContext("2d")!;
        const col = roseColor();
        const center = SPRITE_SIZE / 2;
        const radius = SPRITE_SIZE / 2;

        const halo = sctx.createRadialGradient(center, center, 0, center, center, radius);
        halo.addColorStop(0,   `rgba(${col.r},${col.g},${col.b},0.28)`);
        halo.addColorStop(0.5, `rgba(${col.r},${col.g},${col.b},0.09)`);
        halo.addColorStop(1,   `rgba(${col.r},${col.g},${col.b},0)`);
        sctx.beginPath();
        sctx.arc(center, center, radius, 0, Math.PI * 2);
        sctx.fillStyle = halo;
        sctx.fill();

        sctx.beginPath();
        sctx.arc(center, center, SPRITE_SIZE * 0.05, 0, Math.PI * 2);
        sctx.fillStyle = "rgba(255,242,246,1.0)";
        sctx.fill();
        sprites.push(sCanvas);
      }
    }

    const orbitSprite = document.createElement("canvas");
    const sparkleSprite = document.createElement("canvas");
    const textSprite = document.createElement("canvas");

    function buildSpecialSprites() {
      const size = SPRITE_SIZE;
      const center = size / 2;
      const radius = size / 2;

      // Orbit sprite (rose pink)
      orbitSprite.width = size;
      orbitSprite.height = size;
      const octx = orbitSprite.getContext("2d")!;
      const oHalo = octx.createRadialGradient(center, center, 0, center, center, radius);
      oHalo.addColorStop(0,   "rgba(240,120,150,0.30)");
      oHalo.addColorStop(0.5, "rgba(240,120,150,0.10)");
      oHalo.addColorStop(1,   "rgba(240,120,150,0)");
      octx.beginPath();
      octx.arc(center, center, radius, 0, Math.PI * 2);
      octx.fillStyle = oHalo;
      octx.fill();
      octx.beginPath();
      octx.arc(center, center, size * 0.05, 0, Math.PI * 2);
      octx.fillStyle = "rgba(255,242,246,1.0)";
      octx.fill();

      // Sparkle sprite (bright pink)
      sparkleSprite.width = size;
      sparkleSprite.height = size;
      const sctx = sparkleSprite.getContext("2d")!;
      const sHalo = sctx.createRadialGradient(center, center, 0, center, center, radius);
      sHalo.addColorStop(0,   "rgba(255,160,180,0.30)");
      sHalo.addColorStop(0.5, "rgba(255,160,180,0.10)");
      sHalo.addColorStop(1,   "rgba(255,160,180,0)");
      sctx.beginPath();
      sctx.arc(center, center, radius, 0, Math.PI * 2);
      sctx.fillStyle = sHalo;
      sctx.fill();
      sctx.beginPath();
      sctx.arc(center, center, size * 0.05, 0, Math.PI * 2);
      sctx.fillStyle = "rgba(255,242,246,1.0)";
      sctx.fill();

      // Text sprite (crisp pink) for easter egg lettering, optimized for performance.
      textSprite.width = size;
      textSprite.height = size;
      const tctx = textSprite.getContext("2d")!;
      const tHalo = tctx.createRadialGradient(center, center, 0, center, center, radius);
      tHalo.addColorStop(0,   "rgba(255,140,190,0.28)");
      tHalo.addColorStop(0.55,"rgba(255,96,164,0.12)");
      tHalo.addColorStop(1,   "rgba(255,96,164,0)");
      tctx.beginPath();
      tctx.arc(center, center, radius, 0, Math.PI * 2);
      tctx.fillStyle = tHalo;
      tctx.fill();
      tctx.beginPath();
      tctx.arc(center, center, size * 0.07, 0, Math.PI * 2);
      tctx.fillStyle = "rgba(255,160,206,0.98)";
      tctx.fill();
      tctx.beginPath();
      tctx.arc(center, center, size * 0.03, 0, Math.PI * 2);
      tctx.fillStyle = "rgba(255,226,239,0.95)";
      tctx.fill();
    }

    // Build the high-performance sprites once on mount
    buildSprites();
    buildSpecialSprites();

    // Viewport dimensions in CSS pixels (used in all layout calculations)
    let width  = window.innerWidth;
    let height = window.innerHeight;

    // ── resize & build ─────────────────────────────────────────────────
    function resize() {
      const dpr = window.devicePixelRatio || 1;
      width  = window.innerWidth;
      height = window.innerHeight;

      // Set hardware/physical size
      canvas.width  = width * dpr;
      canvas.height = height * dpr;

      // Maintain responsive layout size in CSS pixels
      canvas.style.width  = `${width}px`;
      canvas.style.height = `${height}px`;

      // Scale drawings automatically
      ctx.scale(dpr, dpr);

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
          x: Math.random() * width,
          y: Math.random() * height,
          size: Math.random() * 1.1 + 0.2,
          opacity: Math.random() * 0.45 + 0.05,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.012 + 0.004,
        });
      }
    }

    function buildParticles() {
      particles.length = 0;
      const cx = width / 2;
      const cy = height * 0.46;
      const scale = Math.min(width, height) * 0.0165;
      const heartPts = getHeartPoints(HEART_N, cx, cy, scale);

      for (let i = 0; i < HEART_N; i++) {
        const hp  = heartPts[i];
        const sx  = (Math.random() - 0.5) * width  * 1.8 + cx;
        const sy  = (Math.random() - 0.5) * height * 1.8 + cy;
        // Each particle gets its own spring personality so recovery is organic
        const returnStiffness = 0.028 + Math.random() * 0.032; // 0.028–0.060
        const returnDamping   = 0.70  + Math.random() * 0.10;  // 0.70–0.80 (allows gentle overshoot)
        const sprite = sprites[Math.floor(Math.random() * sprites.length)];
        
        particles.push({
          x: sx, y: sy, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
          baseTx: hp.x, baseTy: hp.y,
          tx: hp.x, ty: hp.y,
          etx: hp.x, ety: hp.y,
          size: Math.random() * 2.0 + 0.5,
          baseOpacity: Math.random() * 0.5 + 0.3,
          opacity: 0,
          sprite,
          state: "drifting_free",
          gatherDelay: Math.floor(
            120 + (Math.abs(sx - cx) + Math.abs(sy - cy)) * 0.11 + Math.random() * 110
          ),
          driftAwayTimer: 0, driftAwayMax: 0,
          orbitAngle: Math.random() * Math.PI * 2,
          orbitR: Math.random() * 2.2 + 0.3,
          orbitSpeed: (Math.random() * 0.003 + 0.001) * (Math.random() < 0.5 ? 1 : -1),
          twinkle: Math.random() * Math.PI * 2,
          twinkleSpeed: Math.random() * 0.06 + 0.02,
          returnStiffness,
          returnDamping,
        });
      }
    }

    // ── draw a single glowing particle using a pre-rendered sprite ───
    function drawParticle(
      x: number, y: number, size: number, opacity: number,
      sprite: HTMLCanvasElement
    ) {
      const a = Math.min(1, Math.max(0, opacity));
      if (a < 0.015) return;

      ctx.globalAlpha = a;
      // High-resolution canvas rendering size
      const dSize = size * 14;
      ctx.drawImage(
        sprite,
        x - dSize / 2,
        y - dSize / 2,
        dSize,
        dSize
      );
      ctx.globalAlpha = 1.0;
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
      const cx = width / 2, cy = height / 2;
      const bg = ctx.createRadialGradient(cx, cy * 0.8, 0, cx, cy, Math.max(width, height) * 0.85);
      bg.addColorStop(0, "#110818");
      bg.addColorStop(0.4, "#080510");
      bg.addColorStop(1, "#020308");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);
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
      // Glow softens as the heart is disturbed, rebuilds as particles return
      // displacedFraction (0–1) drives the softening: higher = more disturbed
      const disturbSoften = 1 - displacedFraction * 0.42;  // at peak disturbance glow is ~58% normal
      const baseAlpha = finalStateRef.current ? 0.09 : 0.06;
      const alpha = baseAlpha * globalBrightness * disturbSoften * beatPulse;
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
        drawParticle(ox, oy, 0.55, a, orbitSprite);
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
        drawParticle(sx, sy, 0.6, a, sparkleSprite);
      }
    }

    // ── easter egg activation ────────────────────────────────────────────
    function activateEasterEgg() {
      if (eggPhaseRef.current !== "idle" || appPhase !== "beating") return;
      const cx  = width / 2;
      const cy  = height * 0.46;
      const sc  = Math.min(width, height) * 0.0165;
      const messages = [
        "For Mary Iris ❤️",
        "I love you hon ❤️",
        "Play with me next season sa ml hon ;<",
        "I was looking at your pictures while making this",
        "67 67 67",
        "ikaw ang bubu sa buhay ko",
        "Tell your friends may asawa ka na",
        "Caramel Sundae date with me?",
        "Tell Sage I said hi"
      ];
      const msg = messages[eggClickCountRef.current % messages.length];
      eggClickCountRef.current += 1;

      // Ask sampleTextPixels to return exactly EGG_N points spread evenly
      // across every character — so all letters are covered, short or long.
      const candidates = particles.filter(p => p.state === "formed");
      const use = Math.min(EGG_N, candidates.length);
      const pts = sampleTextPixels(msg, width, height, cx, cy - sc * 11, sc, use);
      if (pts.length === 0) return;

      // Shuffle candidates so particles come from all over the heart.
      const shuffled = candidates.slice().sort(() => Math.random() - 0.5);

      for (let i = 0; i < pts.length; i++) {
        const p = shuffled[i];
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
      const onCanvas = mx > 0 && mx < canvas.width && my > 0 && my < canvas.height;

      // Calculate and clamp mouse velocity to keep the drag graceful and slow
      let mvx = 0;
      let mvy = 0;
      if (prevMx > -9000 && mx > -9000 && onCanvas) {
        const rawMvx = mx - prevMx;
        const rawMvy = my - prevMy;
        const len = Math.sqrt(rawMvx * rawMvx + rawMvy * rawMvy);
        if (len > 10) {
          mvx = (rawMvx / len) * 10;
          mvy = (rawMvy / len) * 10;
        } else {
          mvx = rawMvx;
          mvy = rawMvy;
        }
      }
      prevMx = mx;
      prevMy = my;

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
              p.vx += (Math.random() - 0.5) * 0.03; p.vy += (Math.random() - 0.5) * 0.03;
              p.vx *= 0.96; p.vy *= 0.96;
              p.x += p.vx;  p.y += p.vy;
            }
          }
          if (p.state === "gathering") {
            [p.x, p.vx] = springStep(p.x, p.vx, p.baseTx, 0.012, 0.85);
            [p.y, p.vy] = springStep(p.y, p.vy, p.baseTy, 0.012, 0.85);
            const dx = p.baseTx - p.x, dy = p.baseTy - p.y;
            if (dx * dx + dy * dy < 4) {
              p.state = "formed"; p.x = p.baseTx; p.y = p.baseTy; p.vx = 0; p.vy = 0;
            }
          }
          const ta = 0.80 + 0.20 * Math.sin(p.twinkle);
          drawParticle(p.x, p.y, p.size, p.opacity * ta, p.sprite);
        }

        const mostlyFormed = gatherFrame > 620;
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

      // ── Track displaced fraction to drive emotional feedback ────────
      // Count how many particles are not in "formed" state (normalised 0–1)
      let displacedCount = 0;
      for (const p of particles) {
        if (p.state === "scattered" || p.state === "drifting_away") displacedCount++;
      }
      const targetDisplacedFraction = displacedCount / HEART_N;
      // Slow, organic transition — rises quickly on disturbance, fades slowly on recovery
      const dfRate = targetDisplacedFraction > displacedFraction ? 0.08 : 0.018;
      displacedFraction += (targetDisplacedFraction - displacedFraction) * dfRate;

      // ── Disturbance signal for legacy refs ───────────────────────────
      const hdx = mx - cx, hdy = my - cy;
      const heartDist = Math.sqrt(hdx * hdx + hdy * hdy);
      const rawProximity = onCanvas ? Math.max(0, 1 - heartDist / (scale * 22)) : 0;
      disturbanceRef.current += (rawProximity - disturbanceRef.current) * 0.035;

      // ── Heartbeat weakens when disturbed, recovers as particles return ─
      // pulseStrength dips to 0.55 at full disturbance, never fully disappears
      const targetPulseStrength = 1.0 - displacedFraction * 0.45;
      pulseStrength += (Math.max(0.55, targetPulseStrength) - pulseStrength) * 0.022;

      const finalBoost = finalStateRef.current ? 0.18 : 0;
      const brightenBoost = brightenRef.current ? 0.6 : 0;
      // Brightness dims when disturbed, rebuilds as particles return
      const disturbDim = displacedFraction * 0.30;
      const targetBrightness = Math.max(0.55, 1.0 + brightenBoost + finalBoost - disturbDim);
      globalBrightness += (targetBrightness - globalBrightness) * 0.012;

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
            const speed = Math.random() * 0.55 + 0.18;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.12;
          }
        }
      }

      // ── Easter egg timer ─────────────────────────────────────────────
      if (eggPhaseRef.current === "forming" || eggPhaseRef.current === "holding") {
        eggTimerRef.current++;
        // Hold longer so each wording is easy to read before dissolving
        if (eggPhaseRef.current === "holding" && eggTimerRef.current > 420) {
          eggPhaseRef.current = "dissolving";
          eggTimerRef.current = 0;
        }
        // Transition forming → holding when particles settle
        if (eggPhaseRef.current === "forming" && eggTimerRef.current > 120) {
          eggPhaseRef.current = "holding";
          eggTimerRef.current = 0;
        }
      }

      // Pre-compute repulsion squared radii
      const repR2      = REPULSE_R * REPULSE_R;
      const repDead2   = REPULSE_DEAD * REPULSE_DEAD;

      // ── Per-particle update ──────────────────────────────────────────
      for (const p of particles) {
        p.twinkle += p.twinkleSpeed;
        const ta = 0.82 + 0.18 * Math.sin(p.twinkle);

        // ── Gentle repulsion & Drag: cursor pushes and drags nearby particles ────
        // Skip easter-egg particles so they keep forming their letters.
        if (p.state !== "easter_egg" && onCanvas) {
          const rdx = p.x - mx;   // vector FROM cursor TO particle (repulsion direction)
          const rdy = p.y - my;
          const rd2 = rdx * rdx + rdy * rdy;

          if (rd2 < repR2 && rd2 > repDead2) {
            const rd = Math.sqrt(rd2);
            // Force tapers from strong near cursor to zero at radius edge
            // smoothstep gives a very soft, cinematic falloff
            const falloff = smoothstep(REPULSE_R, REPULSE_DEAD, rd);  // 0 at edge, 1 near cursor
            
            // ── 1. Gentle repulsion force ──
            const str = falloff * REPULSE_F;
            p.vx += (rdx / rd) * str;
            p.vy += (rdy / rd) * str;

            // ── 2. Dragging force (nearby particles follow the swipe direction) ──
            const dragStr = falloff * 0.03;
            p.vx += mvx * dragStr;
            p.vy += mvy * dragStr;

            // ── 3. Smooth velocity cap: the heart drifts gracefully like a fluid, never harsh ──
            const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
            const maxSpd = 0.62;
            if (spd > maxSpd) { p.vx = (p.vx / spd) * maxSpd; p.vy = (p.vy / spd) * maxSpd; }
            if (p.state === "formed") p.state = "scattered";
          }
        }

        // State machine
        if (p.state === "easter_egg") {
          if (eggPhaseRef.current === "dissolving") {
            // Return to heart ONLY — gentler, slow spring
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, 0.005, 0.90);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, 0.005, 0.90);
            const dx = p.tx - p.x, dy = p.ty - p.y;
            if (dx * dx + dy * dy < 9 && Math.abs(p.vx) < 0.28 && Math.abs(p.vy) < 0.28) {
              p.state = "formed"; p.vx = 0; p.vy = 0;
            }
          } else {
            // Spring toward egg text target — slow, dreamy firefly glide
            [p.x, p.vx] = springStep(p.x, p.vx, p.etx, 0.004, 0.92);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ety, 0.004, 0.92);
          }

        } else if (p.state === "formed") {
          // Micro-orbit keeps particles alive and breathing
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
            // Spring return with per-particle personality — slow and dreamy return
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, p.returnStiffness * 0.11, p.returnDamping * 1.2);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, p.returnStiffness * 0.11, p.returnDamping * 1.2);
            const dx = p.tx - p.x, dy = p.ty - p.y;
            if (dx * dx + dy * dy < 4 && Math.abs(p.vx) < 0.25 && Math.abs(p.vy) < 0.25) {
              p.state = "formed"; p.vx = 0; p.vy = 0;
            }
          }
          if (p.driftAwayTimer > p.driftAwayMax + 100) {
            p.state = "formed"; p.x = p.tx; p.y = p.ty; p.vx = 0; p.vy = 0;
          }

        } else if (p.state === "scattered") {
          // Spring return from cursor repulsion — per-particle spring for organic variation
          // If cursor is close, we dynamically suspend the return force so it "flows like water"!
          const rdx = p.x - mx;
          const rdy = p.y - my;
          const dist2 = rdx * rdx + rdy * rdy;
          if (dist2 < repR2 && onCanvas) {
            const ks = p.returnStiffness * 0.05; // almost no fight, lets it splash freely!
            const kd = 0.95;
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, ks, kd);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, ks, kd);
          } else {
            const ks = p.returnStiffness * 0.11; // dreamy slow drift back
            const kd = 0.93;
            [p.x, p.vx] = springStep(p.x, p.vx, p.tx, ks, kd);
            [p.y, p.vy] = springStep(p.y, p.vy, p.ty, ks, kd);
          }
          const dx = p.tx - p.x, dy = p.ty - p.y;
          if (dx * dx + dy * dy < 5 && Math.abs(p.vx) < 0.20 && Math.abs(p.vy) < 0.20) {
            p.state = "formed"; p.vx = 0; p.vy = 0;
          }
        }

        // Displaced particles dim very subtly — they're still beautiful, just displaced
        const displacedDim = (p.state === "scattered") ? 0.82 : 1.0;
        const op = p.baseOpacity * ta * globalBrightness * displacedDim;
        // Easter-egg particles: uniform fixed size so dot density is even across all letters.
        // Smaller size = more precise letterforms with no oversized blobs.
        const EASTER_EGG_SIZE = 0.75;
        const drawSize = p.state === "easter_egg" ? EASTER_EGG_SIZE : p.size;
        const drawOp   = p.state === "easter_egg" ? Math.min(op * 3.2, 1) : op;
        if (p.state === "easter_egg") {
          drawParticle(p.x, p.y, drawSize, drawOp, textSprite);
        } else {
          drawParticle(p.x, p.y, drawSize, drawOp, p.sprite);
        }
      }

      // Check if dissolving is done (all egg particles returned)
      if (eggPhaseRef.current === "dissolving") {
        const stillEgg = particles.some(p => p.state === "easter_egg");
        if (!stillEgg) eggPhaseRef.current = "idle";
      }

      // Dynamically fade out click hint caption when in final monthsary message screen
      const caption = document.getElementById("click-caption");
      if (caption) {
        caption.style.opacity = finalStateRef.current ? "0" : "0.55";
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
      await sleep(4000);
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
        await sleep(520);
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
      <style>{`
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.20; transform: translateX(-50%) scale(0.97); }
          50% { opacity: 0.55; transform: translateX(-50%) scale(1.03); }
        }
        @keyframes musicPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,110,145,0.0); }
          50% { box-shadow: 0 0 0 6px rgba(255,110,145,0.18); }
        }
      `}</style>

      {/* ── Background music ─────────────────────────────────────────────── */}
      <MusicPlayer />

      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, display: "block", cursor: "default" }}
      />
      <div
        id="click-caption"
        style={{
          position: "absolute",
          left: "50%",
          bottom: "2.5%",
          transform: "translateX(-50%)",
          fontFamily: "'Inter', system-ui, sans-serif",
          fontSize: "clamp(10px, 1.8vw, 12px)",
          color: "rgba(255, 198, 212, 0.42)",
          pointerEvents: "none",
          letterSpacing: "0.15em",
          textAlign: "center",
          whiteSpace: "nowrap",
          opacity: 0.55,
          transition: "opacity 1s ease-in-out",
          animation: "pulseGlow 2.5s infinite ease-in-out",
          textShadow: "0 0 10px rgba(255, 110, 145, 0.12)"
        }}
      >
        ( touch the heart for a surprise 🩷 )
      </div>
      <div
        ref={overlayRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      />
    </div>
  );
}

// ── Music Player ─────────────────────────────────────────────────────────
const TRACKS = [
  { src: "/bruno-mars.mp3",    label: "Bruno Mars" },
  { src: "/marias.mp3",        label: "The Marías" },
  { src: "/daniel-caesar.mp3", label: "Daniel Caesar" },
];

function MusicPlayer() {
  const audioRef                    = useRef<HTMLAudioElement>(null);
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const hasStartedRef               = useRef(false);

  // Auto-start on first user interaction anywhere on the page
  useEffect(() => {
    function tryStart() {
      if (hasStartedRef.current) return;
      hasStartedRef.current = true;
      const a = audioRef.current;
      if (!a) return;
      a.volume = 0.35;
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    window.addEventListener("click",      tryStart, { once: true });
    window.addEventListener("touchstart", tryStart, { once: true });
    return () => {
      window.removeEventListener("click",      tryStart);
      window.removeEventListener("touchstart", tryStart);
    };
  }, []);

  // When track index changes (after a track ends), play the new one
  useEffect(() => {
    if (!hasStartedRef.current) return;
    const a = audioRef.current;
    if (!a) return;
    a.load();
    a.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [currentIdx]);

  function handleEnded() {
    setCurrentIdx(prev => (prev + 1) % TRACKS.length);
  }

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
    } else {
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }

  return (
    <>
      <audio
        ref={audioRef}
        src={TRACKS[currentIdx].src}
        onEnded={handleEnded}
        preload="auto"
      />
      {/* Floating music toggle — top-right corner */}
      <button
        onClick={togglePlay}
        title={isPlaying ? `Now playing: ${TRACKS[currentIdx].label} — click to pause` : "Play music"}
        style={{
          position: "absolute",
          top: "16px",
          right: "18px",
          zIndex: 99,
          background: "rgba(20, 5, 18, 0.75)",
          border: "1px solid rgba(255,140,175,0.30)",
          borderRadius: "50%",
          width: "42px",
          height: "42px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          backdropFilter: "blur(10px)",
          animation: isPlaying ? "musicPulse 2s infinite ease-in-out" : "none",
          transition: "opacity 0.3s, border-color 0.3s",
          opacity: isPlaying ? 0.85 : 0.55,
          fontSize: "18px",
          lineHeight: 1,
          color: "rgba(255,198,212,0.92)",
          padding: 0,
        }}
      >
        {isPlaying ? "♫" : "♩"}
      </button>
    </>
  );
}
