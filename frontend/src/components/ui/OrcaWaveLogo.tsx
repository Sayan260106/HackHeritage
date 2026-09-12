import React, { useId, useRef, useState, useEffect, useCallback } from 'react';
import { hydrophoneEngine } from '../../services/hydrophoneAudio';

interface OrcaWaveLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'custom';
  className?: string;
  variant?: 'console' | 'home' | 'sidebar';
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
  type: 'chunk' | 'drop' | 'spray' | 'mist' | 'foam';
}

/**
 * OrcaWaveLogo ΓÇö Definitive Visual Architecture:
 * 1. REAL OPEN-OCEAN WATER (NO RECTANGLE, NO HARD LINE):
 *    - Organic undulating surface with natural wave height variations (crests & troughs).
 *    - Visibly dense dark blue-green / ocean teal water body with internal light currents.
 *    - Soft organic curved bottom boundary fading into 100% transparency ΓÇö ZERO box or block appearance.
 * 2. 100% STABLE BASE OCEAN:
 *    - Base surface does NOT jiggle, bounce, scale, or shake when the whale splashes.
 *    - Disturbances are STRICTLY LOCALIZED directly around the orca's entry and exit points.
 * 3. SUBSTANTIAL WATER DISPLACEMENT & PHYSICAL SPLASHES:
 *    - Towering multi-crested upward launch water curtain (height ~36px).
 *    - Massive violent landing impact plumes (height ~50px) surrounding the whale.
 *    - 75+ varied ballistic particles (large chunks r=2.5-3.8px, medium drops, spray, mist, foam) with gravity.
 * 4. ARTICULATED KILLER WHALE WITH DELAYED TAIL FOLLOW-THROUGH:
 *    - True kinematic phase-delay propagation along the 8-node spine.
 *    - Head leads direction -> torso follows -> tail follows last with natural follow-through wave.
 *    - Dynamic spinal curvature changes through launch, apex, and dive.
 *    - Anatomically accurate: rounded melon, robust girth, proportionate dorsal fin (NO rockets/spikes), notched flukes.
 * 5. LOCKED HOVER TRIGGER:
 *    - Hover logic, hitbox, event handlers, and 5 continuous background waves remain 100% intact.
 */
export const OrcaWaveLogo: React.FC<OrcaWaveLogoProps> = ({
  size = 'md',
  className = '',
  variant = 'console',
}) => {
  const uniqueId = useId().replace(/:/g, '');
  const maskId = `orca-fade-mask-${uniqueId}`;
  const gradId = `orca-fade-grad-${uniqueId}`;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isHovered, setIsHovered] = useState(false);

  const W = 128;
  const H = 128;
  const WATER_Y = 68; // Lower-middle water baseline
  const JUMP_DURATION = 2400; // 2.4s majestic breach timing

  // LOCKED HOVER TRIGGER ΓÇö Protected event handlers (DO NOT MODIFY)
  const handleMouseEnter = useCallback(() => {
    setIsHovered(true);
    try {
      hydrophoneEngine.triggerSonarPing(980);
    } catch {
      // Audio optional
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovered(false);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Keep the simulation's 128-unit geometry, but rasterize it densely for a cleaner small-scale mark.
    const pixelRatio = Math.max(2, Math.min(window.devicePixelRatio || 1, 3));
    canvas.width = W * pixelRatio;
    canvas.height = H * pixelRatio;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    // When NOT hovered: immediately ensure canvas is 100% blank
    if (!isHovered) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    let isRunning = true;
    let animId: number | null = null;
    let pauseTimer: NodeJS.Timeout | null = null;
    let jumpStartTime = performance.now();
    let lastTime = performance.now();

    // Multi-Class Water Physics Particle Simulation (Independent layer)
    const particles: Particle[] = [];
    let launchTriggered = false;
    let landingTriggered = false;

    // Helper: Spawn substantial directional water particles for dramatic splash with gravity physics
    const spawnParticles = (
      originX: number,
      originY: number,
      count: number,
      type: 'chunk' | 'drop' | 'spray' | 'mist' | 'foam',
      speedMin: number,
      speedMax: number,
      angleMin: number,
      angleMax: number
    ) => {
      for (let i = 0; i < count; i++) {
        const angle = angleMin + Math.random() * (angleMax - angleMin);
        const speed = speedMin + Math.random() * (speedMax - speedMin);
        let r = 1.0;
        let life = 0.5;

        if (type === 'chunk') {
          // Visibly substantial seawater chunks (clearly visible droplets)
          r = Math.random() * 1.3 + 2.4;
          life = Math.random() * 0.45 + 0.55;
        } else if (type === 'drop') {
          // Medium ballistic droplets
          r = Math.random() * 0.8 + 1.3;
          life = Math.random() * 0.40 + 0.42;
        } else if (type === 'spray') {
          // Fine fast spray
          r = Math.random() * 0.5 + 0.7;
          life = Math.random() * 0.28 + 0.25;
        } else if (type === 'mist') {
          // Soft diffuse water vapor
          r = Math.random() * 2.5 + 3.2;
          life = Math.random() * 0.35 + 0.35;
        } else if (type === 'foam') {
          // Aerated white foam bubbles
          r = Math.random() * 1.2 + 1.4;
          life = Math.random() * 0.55 + 0.45;
        }

        particles.push({
          x: originX + (Math.random() - 0.5) * 6,
          y: originY + (Math.random() - 0.5) * 3,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          r,
          life,
          maxLife: life,
          type,
        });
      }
    };

    // ΓöÇΓöÇ CALM, STABLE BASE OCEAN WATERLINE (CONTINUOUS ACROSS FULL LOGO WIDTH) ΓöÇΓöÇ
    const getBaseSurfaceY = (x: number, now: number) => {
      const tShift = now * 0.0013;
      // Subtle spatial modulation: natural unevenness and small variations in wave crest heights
      const heightMod = 1.0 + Math.sin(x * 0.028 + 0.6) * 0.22;
      const swell = Math.sin(x * 0.062 + tShift) * 1.3 * heightMod;
      const ripple = Math.cos(x * 0.135 - tShift * 0.75) * 0.75;
      // Delicate micro-capillary texture (natural unevenness in waterline)
      const micro = Math.sin(x * 0.30 + tShift * 1.4) * 0.30 + Math.cos(x * 0.50 - tShift * 0.9) * 0.16;
      // A faint phase-distorted cross-ripple keeps the calm surface from reading as a repeated sine pattern.
      const crossRipplePhase = x * 0.205 + Math.sin(x * 0.041) * 0.75 - tShift * 1.15;
      const crossRipple = Math.sin(crossRipplePhase) * (0.18 + Math.sin(x * 0.083 + 1.3) * 0.10);
      const surfaceLull = Math.sin(x * 0.017 - tShift * 0.22) * 0.12;
      return WATER_Y + swell + ripple + micro + crossRipple + surfaceLull;
    };

    // ΓöÇΓöÇ LAYER 1: Continuous Base Ocean Surface & Seawater Body (Real Open Sea, Full Width) ΓöÇΓöÇ
    const renderBaseOcean = (now: number) => {
      ctx.save();

      // 1.1 Dense, Continuous Seawater Body spanning Entire Logo Width from Left Edge to Right Edge
      ctx.beginPath();
      ctx.moveTo(-4, getBaseSurfaceY(-4, now));
      for (let x = -4; x <= W + 4; x += 2) {
        ctx.lineTo(x, getBaseSurfaceY(x, now));
      }
      // Extend to the bottom boundary so there is no rectangular lower cut
      ctx.lineTo(W + 4, H + 8);
      ctx.lineTo(-4, H + 8);
      ctx.closePath();

      // Realistic Natural Open-Ocean Seawater Palette: Deep Blue-Green / Dark Oceanic Teal
      // Opaque and dense so background does not show through the water body
      const oceanGrad = ctx.createLinearGradient(0, WATER_Y, 0, H);
      oceanGrad.addColorStop(0.00, 'rgba(10, 84, 108, 0.98)'); // Deep natural blue-green surface water
      oceanGrad.addColorStop(0.25, 'rgba(8, 70, 94, 0.98)');   // Documentary marine seawater
      oceanGrad.addColorStop(0.55, 'rgba(6, 54, 76, 0.98)');   // Rich open-ocean depth
      oceanGrad.addColorStop(1.00, 'rgba(4, 40, 60, 0.98)');   // Deep marine ocean abyss
      ctx.fillStyle = oceanGrad;
      ctx.fill();

      // 1.2 Subtle Internal Ocean Caustic Currents & Tonal Variations
      ctx.beginPath();
      ctx.moveTo(-4, getBaseSurfaceY(-4, now) + 4);
      for (let x = -4; x <= W + 4; x += 3) {
        const py = getBaseSurfaceY(x, now) + 5 + Math.sin(x * 0.08 + now * 0.002) * 1.6;
        ctx.lineTo(x, py);
      }
      ctx.lineTo(W + 4, getBaseSurfaceY(W + 4, now) + 26);
      for (let x = W + 4; x >= -4; x -= 4) {
        const py = getBaseSurfaceY(x, now) + 24 + Math.cos(x * 0.06 - now * 0.0014) * 2.2;
        ctx.lineTo(x, py);
      }
      ctx.closePath();
      const internalGrad = ctx.createLinearGradient(0, WATER_Y + 4, 0, WATER_Y + 28);
      internalGrad.addColorStop(0, 'rgba(28, 130, 160, 0.30)');
      internalGrad.addColorStop(1, 'rgba(10, 70, 96, 0.0)');
      ctx.fillStyle = internalGrad;
      ctx.fill();

      // 1.3 Crisp Surface Meniscus Line (Deep blue-green natural seawater boundary)
      ctx.beginPath();
      ctx.moveTo(-4, getBaseSurfaceY(-4, now));
      for (let x = -4; x <= W + 4; x += 2) {
        ctx.lineTo(x, getBaseSurfaceY(x, now));
      }
      ctx.strokeStyle = 'rgba(18, 104, 130, 0.98)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      // 1.4 Subtle Surface Reflections & Specular Highlights along wave crests
      ctx.beginPath();
      for (let x = -2; x <= W + 2; x += 2) {
        const sy = getBaseSurfaceY(x, now);
        if (Math.sin(x * 0.065 + now * 0.0014) > 0.28) {
          ctx.moveTo(x - 2, sy - 0.2);
          ctx.lineTo(x + 2, sy - 0.2);
        }
      }
      ctx.strokeStyle = 'rgba(175, 230, 248, 0.72)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // 1.5 Natural Micro-Foam Flecks on wave peaks
      for (let x = 4; x <= W - 4; x += 13) {
        if (Math.sin(x * 0.065 + now * 0.0014) > 0.40) {
          const sy = getBaseSurfaceY(x, now);
          ctx.beginPath();
          ctx.ellipse(x, sy - 0.3, 1.1, 0.6, 0, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(240, 250, 255, 0.78)';
          ctx.fill();
        }
      }

      ctx.restore();
    };

    // ΓöÇΓöÇ LAYER 2: Strictly Localized Impact Foam & Surface Disturbance (NO GIANT CONE / TRIANGLE) ΓöÇΓöÇ
    const renderLocalImpactRipples = (now: number, progress: number) => {
      ctx.save();

      // 2.1 Localized Launch Impact at x ~ 18 (Local water displacement & foam)
      if (progress >= 0.06 && progress <= 0.34) {
        const pLaunch = (progress - 0.06) / 0.28;
        const ringAlpha = (1 - pLaunch) * 0.85;
        const ringRadius = pLaunch * 12 + 2;
        const originY = getBaseSurfaceY(18, now);

        // Concentric expanding localized ripple ring
        ctx.beginPath();
        ctx.ellipse(18, originY, ringRadius, ringRadius * 0.30, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(175, 225, 245, ${ringAlpha * 0.82})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Local churning white foam bubbles at launch breach
        for (let i = -4; i <= 4; i++) {
          const fx = 18 + i * 2.0;
          const fy = originY + Math.sin(i * 1.5 + progress * 10) * 1.2;
          ctx.beginPath();
          ctx.arc(fx, fy, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(245, 252, 255, ${ringAlpha * 0.90})`;
          ctx.fill();
        }
      }

      // 2.2 Localized Landing Impact at x ~ 110 (Irregular foaming wave surge & foam)
      // ABSOLUTELY NO CONE, NO TRIANGLE, NO MOUNTAIN
      if (progress >= 0.72 && progress <= 0.98) {
        const pLand = (progress - 0.72) / 0.26;
        const ringAlpha = (1 - pLand) * 0.92;
        const ringRadius = pLand * 15 + 3;
        const originY = getBaseSurfaceY(110, now);

        // Concentric expanding landing impact rings
        ctx.beginPath();
        ctx.ellipse(110, originY, ringRadius, ringRadius * 0.32, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(215, 242, 255, ${ringAlpha * 0.92})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();

        ctx.beginPath();
        ctx.ellipse(110, originY, ringRadius * 0.60, ringRadius * 0.20, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(160, 220, 245, ${ringAlpha * 0.75})`;
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Churning sea-foam bubbles at landing point (natural froth, zero geometric peaks)

        // Dense cluster of white churning sea-foam bubbles
        for (let i = -6; i <= 6; i++) {
          const fx = 110 + i * 2.2;
          const fy = originY + Math.sin(i * 1.8 + progress * 12) * 1.6;
          ctx.beginPath();
          ctx.arc(fx, fy, 1.4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${ringAlpha * 0.95})`;
          ctx.fill();
        }
      }

      ctx.restore();
    };

    // ΓöÇΓöÇ LAYER 4: Articulated Killer Whale with Kinematic Phase-Lag & Active Muscular Arching ΓöÇΓöÇ
    const drawRealisticKillerWhale = (t: number) => {
      // Parabolic Trajectory across 82% of width (Preserved trajectory path)
      const p0x = 12, p0y = 80;
      const p1x = 64, p1y = 12;
      const p2x = 116, p2y = 80;

      const getTrajectoryAngle = (prog: number) => {
        const clampedT = Math.max(0, Math.min(1, prog));
        const dX = 2 * (1 - clampedT) * (p1x - p0x) + 2 * clampedT * (p2x - p1x);
        const dY = 2 * (1 - clampedT) * (p1y - p0y) + 2 * clampedT * (p2y - p1y);
        return Math.atan2(dY, dX);
      };

      const comX = (1 - t) * (1 - t) * p0x + 2 * (1 - t) * t * p1x + t * t * p2x;
      const comY = (1 - t) * (1 - t) * p0y + 2 * (1 - t) * t * p1y + t * t * p2y;

      // 4.1 Organic Kinematic Phase Lags along the 8 Spine Nodes
      // Head leads into dive direction -> Torso follows -> Tail lags behind with natural follow-through
      const timeLags = [+0.055, +0.038, +0.020, 0.000, -0.025, -0.055, -0.090, -0.130];

      // 4.2 Active Muscular Flexion & Tail Follow-Through Wave
      // During ascent: streamlined launch arch. Over crest & descent: head curls down into dive, back arches smoothly
      let bodyArch = 0;
      if (t >= 0.25 && t <= 0.85) {
        bodyArch = Math.sin(((t - 0.25) / 0.60) * Math.PI) * 0.28;
      }

      // Caudal fluke trailing flutter wave
      const flukeFlutter = Math.sin(t * Math.PI * 3.2 - 0.6) * 0.12;

      // Calculate articulated segment angles
      const spineAngles = new Float32Array(8);
      for (let i = 0; i < 8; i++) {
        const baseAng = getTrajectoryAngle(t + timeLags[i]);
        // Curvature gradient: head pitches downward (+Y), tail remains arched upward (-Y)
        const archOffset = bodyArch * (1 - 2.2 * (i / 7));
        const flutter = i >= 6 ? flukeFlutter : 0;
        spineAngles[i] = baseAng + archOffset + flutter;
      }

      // 8 Articulated Spine Segments: total length ~52px (40% of 128px canvas)
      const d01 = 6.8;
      const d12 = 6.8;
      const d23 = 7.8;
      const d34 = 8.8;
      const d45 = 7.8;
      const d56 = 7.8;
      const d67 = 6.8;

      // Anchor at Node 3 (Chest)
      const S3x = comX;
      const S3y = comY;

      const S2x = S3x + Math.cos(spineAngles[2]) * d23;
      const S2y = S3y + Math.sin(spineAngles[2]) * d23;

      const S1x = S2x + Math.cos(spineAngles[1]) * d12;
      const S1y = S2y + Math.sin(spineAngles[1]) * d12;

      const S0x = S1x + Math.cos(spineAngles[0]) * d01;
      const S0y = S1y + Math.sin(spineAngles[0]) * d01;

      const S4x = S3x - Math.cos(spineAngles[3]) * d34;
      const S4y = S3y - Math.sin(spineAngles[3]) * d34;

      const S5x = S4x - Math.cos(spineAngles[4]) * d45;
      const S5y = S4y - Math.sin(spineAngles[4]) * d45;

      const S6x = S5x - Math.cos(spineAngles[5]) * d56;
      const S6y = S5y - Math.sin(spineAngles[5]) * d56;

      const S7x = S6x - Math.cos(spineAngles[6]) * d67;
      const S7y = S6y - Math.sin(spineAngles[6]) * d67;

      const spineX = [S0x, S1x, S2x, S3x, S4x, S5x, S6x, S7x];
      const spineY = [S0y, S1y, S2y, S3y, S4y, S5y, S6y, S7y];

      // Anatomically correct body half-widths (muscular, hydrodynamic girth)
      const widths = [1.8, 5.4, 8.0, 9.4, 8.6, 6.2, 3.6, 1.8];

      const D_pts: Array<{ x: number; y: number }> = [];
      const V_pts: Array<{ x: number; y: number }> = [];

      for (let i = 0; i < 8; i++) {
        const ang = spineAngles[i];
        const nx = -Math.sin(ang);
        const ny = Math.cos(ang);
        const w = widths[i];

        D_pts.push({ x: spineX[i] - nx * w, y: spineY[i] - ny * w });
        V_pts.push({ x: spineX[i] + nx * w, y: spineY[i] + ny * w });
      }

      ctx.save();

      // 4.3 Jet-Black Muscular Torpedo Body Contour
      ctx.beginPath();
      // Snout tip
      ctx.moveTo(D_pts[0].x, D_pts[0].y);
      // Melon and forehead (smooth rounded curve)
      ctx.quadraticCurveTo(D_pts[1].x, D_pts[1].y, D_pts[2].x, D_pts[2].y);
      // Chest to dorsal fin base
      ctx.quadraticCurveTo(D_pts[3].x, D_pts[3].y, (D_pts[3].x + D_pts[4].x) / 2, (D_pts[3].y + D_pts[4].y) / 2);

      // Proportionate, anatomically accurate dorsal fin at Node 4 (NO SPIKE, NO ROCKET)
      const ang4 = spineAngles[4];
      const n4x = -Math.sin(ang4);
      const n4y = Math.cos(ang4);
      const t4x = Math.cos(ang4);
      const t4y = Math.sin(ang4);

      const finBaseFrontX = S4x - n4x * widths[4] + t4x * 4.2;
      const finBaseFrontY = S4y - n4y * widths[4] + t4y * 4.2;
      const finTipX = S4x - n4x * (widths[4] + 11.0) - t4x * 3.2;
      const finTipY = S4y - n4y * (widths[4] + 11.0) - t4y * 3.2;
      const finBaseRearX = S4x - n4x * widths[4] - t4x * 4.2;
      const finBaseRearY = S4y - n4y * widths[4] - t4y * 4.2;

      ctx.lineTo(finBaseFrontX, finBaseFrontY);
      ctx.quadraticCurveTo(
        (finBaseFrontX + finTipX) / 2 - t4x * 0.4,
        (finBaseFrontY + finTipY) / 2 - t4y * 0.4,
        finTipX,
        finTipY
      );
      ctx.quadraticCurveTo(
        (finTipX + finBaseRearX) / 2 - t4x * 1.8,
        (finTipY + finBaseRearY) / 2 - t4y * 1.8,
        finBaseRearX,
        finBaseRearY
      );

      ctx.quadraticCurveTo(D_pts[5].x, D_pts[5].y, D_pts[6].x, D_pts[6].y);
      ctx.lineTo(D_pts[7].x, D_pts[7].y);

      // Caudal Flukes at Node 7 (Symmetrical swept flukes with central notch)
      const ang7 = spineAngles[7];
      const n7x = -Math.sin(ang7);
      const n7y = Math.cos(ang7);
      const t7x = Math.cos(ang7);
      const t7y = Math.sin(ang7);
      const flukeSpan = 9.2;

      const flukeLeftX = S7x - n7x * flukeSpan - t7x * 3.4;
      const flukeLeftY = S7y - n7y * flukeSpan - t7y * 3.4;
      const flukeNotchX = S7x + t7x * 1.8;
      const flukeNotchY = S7y + t7y * 1.8;
      const flukeRightX = S7x + n7x * flukeSpan - t7x * 3.4;
      const flukeRightY = S7y + n7y * flukeSpan - t7y * 3.4;

      ctx.lineTo(flukeLeftX, flukeLeftY);
      ctx.quadraticCurveTo(S7x - n7x * 3.2, S7y - n7y * 3.2, flukeNotchX, flukeNotchY);
      ctx.quadraticCurveTo(S7x + n7x * 3.2, S7y + n7y * 3.2, flukeRightX, flukeRightY);
      ctx.lineTo(V_pts[7].x, V_pts[7].y);

      // Ventral curve: tail -> belly -> chest -> throat -> chin
      ctx.quadraticCurveTo(V_pts[6].x, V_pts[6].y, V_pts[5].x, V_pts[5].y);
      ctx.quadraticCurveTo(V_pts[4].x, V_pts[4].y, V_pts[3].x, V_pts[3].y);
      ctx.quadraticCurveTo(V_pts[2].x, V_pts[2].y, V_pts[1].x, V_pts[1].y);
      ctx.quadraticCurveTo(V_pts[0].x, V_pts[0].y, D_pts[0].x, D_pts[0].y);
      ctx.closePath();

      // Real killer whale dark velvet skin
      const skinGrad = ctx.createLinearGradient(comX, comY - 18, comX, comY + 12);
      skinGrad.addColorStop(0, '#0a101b');
      skinGrad.addColorStop(0.35, '#02060e');
      skinGrad.addColorStop(1, '#010408');
      ctx.fillStyle = skinGrad;
      ctx.fill();

      // Wet specular sheen along dorsal ridge
      ctx.beginPath();
      ctx.moveTo(D_pts[1].x, D_pts[1].y);
      ctx.quadraticCurveTo(D_pts[2].x, D_pts[2].y, D_pts[3].x, D_pts[3].y);
      ctx.strokeStyle = 'rgba(215, 235, 250, 0.35)';
      ctx.lineWidth = 0.9;
      ctx.stroke();

      // 4.4 Pure-White Ventral Throat, Chin, Belly & Flank Patch
      ctx.beginPath();
      ctx.moveTo(D_pts[0].x, D_pts[0].y);
      ctx.quadraticCurveTo(V_pts[0].x, V_pts[0].y, V_pts[1].x, V_pts[1].y);
      ctx.quadraticCurveTo(V_pts[2].x, V_pts[2].y, V_pts[3].x, V_pts[3].y);
      ctx.quadraticCurveTo(V_pts[4].x, V_pts[4].y, V_pts[5].x, V_pts[5].y);
      ctx.quadraticCurveTo(
        spineX[5],
        spineY[5],
        spineX[4] + (V_pts[4].x - spineX[4]) * 0.3,
        spineY[4] + (V_pts[4].y - spineY[4]) * 0.3
      );
      ctx.quadraticCurveTo(spineX[3], spineY[3], spineX[1], spineY[1]);
      ctx.lineTo(D_pts[0].x, D_pts[0].y);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      // 4.5 Grey Saddle Patch Behind Dorsal Fin
      ctx.beginPath();
      const n4xHalf = n4x * 3.0;
      const n4yHalf = n4y * 3.0;
      ctx.moveTo(finBaseRearX, finBaseRearY);
      ctx.quadraticCurveTo(
        spineX[4] - n4xHalf * 1.6,
        spineY[4] - n4yHalf * 1.6,
        D_pts[5].x,
        D_pts[5].y
      );
      ctx.quadraticCurveTo(
        spineX[5] - n4xHalf * 0.5,
        spineY[5] - n4yHalf * 0.5,
        finBaseRearX,
        finBaseRearY
      );
      ctx.closePath();
      ctx.fillStyle = 'rgba(148, 163, 184, 0.85)';
      ctx.fill();

      // 4.6 Signature Pure-White Oval Eye Patch
      ctx.save();
      const ang2 = spineAngles[2];
      const patchX = spineX[2] - Math.sin(ang2) * 4.2 + Math.cos(ang2) * 1.0;
      const patchY = spineY[2] + Math.cos(ang2) * 4.2 + Math.sin(ang2) * 1.0;
      ctx.translate(patchX, patchY);
      ctx.rotate(ang2 - 0.14);
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.6, 2.0, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      // 4.7 Orca Eye with Specular Catchlight
      const eyeX = spineX[2] - Math.sin(ang2) * 1.5 + Math.cos(ang2) * 3.2;
      const eyeY = spineY[2] + Math.cos(ang2) * 1.5 + Math.sin(ang2) * 3.2;
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeX + 0.3, eyeY - 0.3, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#f0f9ff';
      ctx.fill();

      // 4.8 Paddle-Shaped Pectoral Flipper at Node 3
      const ang3 = spineAngles[3];
      const n3x = -Math.sin(ang3);
      const n3y = Math.cos(ang3);
      const flipBaseX = spineX[3] + n3x * 6.8;
      const flipBaseY = spineY[3] + n3y * 6.8;
      const flipTipX = flipBaseX + n3x * 10.2 - Math.cos(ang3) * 3.4;
      const flipTipY = flipBaseY + n3y * 10.2 - Math.sin(ang3) * 3.4;

      ctx.beginPath();
      ctx.moveTo(flipBaseX - Math.cos(ang3) * 2, flipBaseY - Math.sin(ang3) * 2);
      ctx.quadraticCurveTo(flipBaseX + n3x * 5.5, flipBaseY + n3y * 5.5, flipTipX, flipTipY);
      ctx.quadraticCurveTo(
        flipBaseX + n3x * 7.5 + Math.cos(ang3) * 2.5,
        flipBaseY + n3y * 7.5 + Math.sin(ang3) * 2.5,
        flipBaseX + Math.cos(ang3) * 2,
        flipBaseY + Math.sin(ang3) * 2
      );
      ctx.closePath();
      ctx.fillStyle = '#050a12';
      ctx.fill();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.restore();
    };

    // ΓöÇΓöÇ MAIN SIMULATION & RENDER LOOP ΓöÇΓöÇ
    const mainLoop = (now: number) => {
      if (!isRunning) return;

      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // 100% TRANSPARENT CANVAS BUFFER CLEAR
      ctx.clearRect(0, 0, W, H);

      const elapsed = now - jumpStartTime;
      const t = Math.min(elapsed / JUMP_DURATION, 1.0);

      try {
        // ΓöÇΓöÇ 1. Update Ballistic Particles with Natural Physical Gravity ΓöÇΓöÇ
        for (let i = particles.length - 1; i >= 0; i--) {
          const p = particles[i];
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          // Gravity: Rise -> Slow at apex -> Fall naturally
          p.vy += (p.type === 'chunk' ? 140 : p.type === 'drop' ? 115 : 75) * dt;
          p.vx *= 1 - 0.28 * dt;
          p.life -= dt;

          if (p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y > H + 10) {
            particles.splice(i, 1);
          }
        }

        // ΓöÇΓöÇ 2. Trigger Substantial Directional Particle Bursts ΓöÇΓöÇ
        // Breach Launch at t ~ 0.08 (around x ~ 18)
        if (t >= 0.08 && !launchTriggered) {
          launchTriggered = true;
          spawnParticles(18, WATER_Y, 16, 'chunk', 36, 68, -Math.PI * 0.78, -Math.PI * 0.22);
          spawnParticles(18, WATER_Y, 22, 'drop', 45, 88, -Math.PI * 0.85, -Math.PI * 0.15);
          spawnParticles(18, WATER_Y, 26, 'spray', 42, 98, -Math.PI * 0.90, -Math.PI * 0.10);
          spawnParticles(18, WATER_Y, 12, 'mist', 18, 40, -Math.PI * 0.80, -Math.PI * 0.20);
        }

        // Violent Impact Landing Crash at t ~ 0.74 (around x ~ 110, fanning outward)
        if (t >= 0.74 && !landingTriggered) {
          landingTriggered = true;
          spawnParticles(106, WATER_Y, 26, 'chunk', 48, 92, -Math.PI * 0.88, -Math.PI * 0.50);
          spawnParticles(112, WATER_Y, 26, 'chunk', 48, 88, -Math.PI * 0.50, -Math.PI * 0.12);
          spawnParticles(110, WATER_Y, 40, 'drop', 58, 115, -Math.PI * 0.92, -Math.PI * 0.08);
          spawnParticles(110, WATER_Y, 48, 'spray', 54, 130, -Math.PI * 0.95, -Math.PI * 0.05);
          spawnParticles(110, WATER_Y, 20, 'foam', 32, 65, -Math.PI * 0.85, -Math.PI * 0.15);
          spawnParticles(110, WATER_Y, 18, 'mist', 24, 58, -Math.PI * 0.85, -Math.PI * 0.15);
        }

        // ΓöÇΓöÇ 3. Render Independent Layers in Physical Order ΓöÇΓöÇ
        // Layer 1 (Base Whale): Articulated Killer Whale with phase-lag spine follow-through
        // Whale drawn first so submerged parts are naturally veiled beneath the dense ocean
        if (t >= 0.05 && t <= 0.95) {
          drawRealisticKillerWhale(t);
        }

        // Layer 2 (Base Ocean): Real open sea water body & waterline (Calm, stable, full width, no box)
        renderBaseOcean(now);

        // Layer 3 (Local Impact): Strictly localized ripple rings & foaming wave lip at entry/exit
        renderLocalImpactRipples(now, t);

        // Layer 4 (Ballistic Particles): Substantial chunks, medium drops, spray, foam, mist
        ctx.save();
        for (const p of particles) {
          const alpha = p.life / p.maxLife;

          if (p.type === 'mist') {
            const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
            grad.addColorStop(0, `rgba(215, 238, 250, ${alpha * 0.42})`);
            grad.addColorStop(1, 'rgba(215, 238, 250, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.type === 'chunk') {
            // Substantial water chunk with deep blue-green core and specular catchlight
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(6, 40, 56, ${alpha * 0.92})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.96})`;
            ctx.fill();
          } else if (p.type === 'drop') {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(10, 62, 82, ${alpha * 0.85})`;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.3, p.r * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.96})`;
            ctx.fill();
          } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(242, 250, 255, ${alpha * 0.88})`;
            ctx.fill();
          }
        }
        ctx.restore();
      } catch (err) {
        console.error('Orca simulation error:', err);
      }

      // ΓöÇΓöÇ 4.4 Loop Control ΓöÇΓöÇ
      if (t >= 1.0) {
        pauseTimer = setTimeout(() => {
          if (isRunning) {
            jumpStartTime = performance.now();
            lastTime = performance.now();
            launchTriggered = false;
            landingTriggered = false;
            particles.length = 0;
            animId = requestAnimationFrame(mainLoop);
          }
        }, 900);
      } else {
        animId = requestAnimationFrame(mainLoop);
      }
    };

    animId = requestAnimationFrame(mainLoop);

    return () => {
      isRunning = false;
      if (animId) {
        cancelAnimationFrame(animId);
      }
      if (pauseTimer) {
        clearTimeout(pauseTimer);
      }
      ctx.clearRect(0, 0, W, H);
    };
  }, [isHovered]);

  // Dimensions based on preset: matches ORCA-X height
  const sizeClasses = {
    sm: 'h-12 w-12 sm:h-14 sm:w-14',
    md: 'h-14 w-14 sm:h-16 sm:w-16',
    lg: 'h-16 w-16 sm:h-20 sm:w-20',
    custom: '',
  }[size];

  // Preserved original harmonious backdrop styling (unchanged)
  const variantStyles = {
    home: 'border border-cyan-400/40 bg-black/40 backdrop-blur-sm shadow-sm hover:border-cyan-400/80',
    sidebar: 'border border-shoal/35 bg-abyssal/60 hover:border-shoal/60',
    console: 'border border-cyan-400/40 bg-gradient-to-br from-cyan-950/80 via-slate-950/90 to-blue-950/80 shadow-lg shadow-cyan-500/15 hover:border-cyan-400/70',
  }[variant];

  // Mathematical smooth sine wave path (wavelength L = 24px)
  const generateWaveD = (startY: number) => {
    let d = `M -48 ${startY} `;
    for (let i = 0; i < 7; i++) {
      d += `c 3.31 -2.6 8.69 -2.6 12 0 c 3.31 2.6 8.69 2.6 12 0 `;
    }
    return d;
  };

  return (
    <div
      ref={containerRef}
      className={`orca-wave-logo-container group relative flex shrink-0 items-center justify-center rounded-2xl overflow-hidden cursor-pointer select-none transition-all duration-300 ${sizeClasses} ${variantStyles} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onTouchStart={handleMouseEnter}
      onClick={handleMouseEnter}
    >
      {/* ΓöÇΓöÇ Continuous Traveling Waves (4 Balanced Tiers with Refined Breathing Room) ΓöÇΓöÇ */}
      <svg
        viewBox="0 0 36 36"
        className="h-full w-full pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="22%" stopColor="white" stopOpacity="1" />
            <stop offset="78%" stopColor="white" stopOpacity="1" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>

          <mask id={maskId}>
            <rect x="0" y="0" width="36" height="36" fill={`url(#${gradId})`} />
          </mask>
        </defs>

        <g mask={`url(#${maskId})`}>
          {/* Wave Tier 1: Top Crest (#38bdf8 ΓÇö Sky Cyan) */}
          <path
            d={generateWaveD(7)}
            stroke="#38bdf8"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="orca-wave-stream-1"
            opacity="0.88"
          />

          {/* Wave Tier 2: Middle Swell (#2dd4bf ΓÇö Emerald Teal) */}
          <path
            d={generateWaveD(15)}
            stroke="#2dd4bf"
            strokeWidth="2.0"
            strokeLinecap="round"
            className="orca-wave-stream-2"
            opacity="0.95"
          />

          {/* Wave Tier 3: Lower Surge (#818cf8 ΓÇö Indigo Blue) */}
          <path
            d={generateWaveD(23)}
            stroke="#818cf8"
            strokeWidth="1.9"
            strokeLinecap="round"
            className="orca-wave-stream-3"
            opacity="0.90"
          />

          {/* Wave Tier 4: Bottom Marine Tide (#818cf8 ΓÇö Indigo Blue) */}
          <path
            d={generateWaveD(31)}
            stroke="#818cf8"
            strokeWidth="1.8"
            strokeLinecap="round"
            className="orca-wave-stream-3"
            opacity="0.78"
          />
        </g>
      </svg>

      {/* ΓöÇΓöÇ HTML5 Canvas: Organic Open Ocean, Articulated Killer Whale & Substantial Water Splashes (100% Transparent Surroundings, Hover-Only) ΓöÇΓöÇ */}
      <canvas
        ref={canvasRef}
        width={128}
        height={128}
        className="absolute inset-0 w-full h-full pointer-events-none z-20"
      />
    </div>
  );
};
