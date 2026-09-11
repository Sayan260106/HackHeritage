import React, { useEffect, useRef, useCallback } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface ScrollyCanvasBackgroundProps {
  className?: string;
  totalFrames?: number;
  initialFrame?: number;
}

const TOTAL_FRAMES = 1076;
const DISK_FRAMES = 301;

function getFrameUrl(index: number): string {
  // Interpolate index (0 to 1075) smoothly across available disk files (frame_0001.avif to frame_0301.avif)
  const normalizedIndex = Math.min(TOTAL_FRAMES - 1, Math.max(0, index));
  const frameNum = Math.min(DISK_FRAMES, Math.floor((normalizedIndex / (TOTAL_FRAMES - 1)) * (DISK_FRAMES - 1)) + 1);
  const padded = String(frameNum).padStart(4, "0");
  return `/bg/frame_${padded}.avif`;
}

export const ScrollyCanvasBackground: React.FC<ScrollyCanvasBackgroundProps> = ({
  className = "",
  totalFrames = TOTAL_FRAMES,
  initialFrame = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>([]);
  const loadedSetRef = useRef<Set<number>>(new Set());

  // Animation state
  const targetFrameRef = useRef<number>(initialFrame);
  const currentFrameFloatRef = useRef<number>(initialFrame);
  const renderedFrameRef = useRef<number>(-1);
  const rafIdRef = useRef<number | null>(null);

  const reducedMotion = usePrefersReducedMotion();

  // Helper to draw a specific frame to the canvas
  const drawFrame = useCallback((frameIdx: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    // Find the closest loaded frame to avoid black flickers
    let imgToDraw = imagesRef.current[frameIdx];
    if (!imgToDraw || !imgToDraw.complete || imgToDraw.naturalWidth === 0) {
      let minDistance = Infinity;
      let closestIdx = -1;
      for (const loadedIdx of loadedSetRef.current) {
        const dist = Math.abs(loadedIdx - frameIdx);
        if (dist < minDistance) {
          minDistance = dist;
          closestIdx = loadedIdx;
        }
      }
      if (closestIdx !== -1) {
        imgToDraw = imagesRef.current[closestIdx];
      }
    }

    if (!imgToDraw || !imgToDraw.complete || imgToDraw.naturalWidth === 0) {
      return;
    }

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    if (canvasWidth === 0 || canvasHeight === 0) return;

    // Calculate aspect-ratio "cover" coordinates directly on canvas pixels
    const imgWidth = imgToDraw.naturalWidth;
    const imgHeight = imgToDraw.naturalHeight;
    const scale = Math.max(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;
    const drawX = (canvasWidth - drawWidth) / 2;
    const drawY = (canvasHeight - drawHeight) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(imgToDraw, drawX, drawY, drawWidth, drawHeight);

    renderedFrameRef.current = frameIdx;
  }, []);

  // Resize canvas according to display size & DPR
  const handleResize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.floor(rect.width * dpr);
    const h = Math.floor(rect.height * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      // Redraw current frame after resize
      if (renderedFrameRef.current >= 0) {
        drawFrame(renderedFrameRef.current);
      }
    }
  }, [drawFrame]);

  // Load single image with caching and async decoding
  const loadSingleImage = useCallback(
    (index: number): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        if (imagesRef.current[index]?.complete && imagesRef.current[index]?.naturalWidth !== 0) {
          resolve(imagesRef.current[index]!);
          return;
        }

        const img = new Image();
        img.decoding = "async";
        img.src = getFrameUrl(index);

        img.onload = () => {
          imagesRef.current[index] = img;
          loadedSetRef.current.add(index);

          // If this is the initial frame, draw immediately
          if (index === 0 && renderedFrameRef.current === -1) {
            drawFrame(0);
          } else if (Math.abs(renderedFrameRef.current - index) <= 1) {
            drawFrame(index);
          }
          resolve(img);
        };

        img.onerror = () => {
          reject(new Error(`Failed to load frame ${index}`));
        };
      });
    },
    [drawFrame],
  );

  // Progressive image preloader:
  // Phase 1: Hero batch (frames 0..45) loads immediately
  // Phase 2: Skeleton keyframe sampling (every 12th frame across 1076)
  // Phase 3: Fill in remaining frames in background chunks
  useEffect(() => {
    let isCancelled = false;
    imagesRef.current = new Array(totalFrames).fill(null);
    loadedSetRef.current.clear();

    async function preloadSequence() {
      // Phase 1: Eagerly load initial hero frames
      const heroBatch: Promise<HTMLImageElement>[] = [];
      for (let i = 0; i < Math.min(45, totalFrames); i++) {
        heroBatch.push(loadSingleImage(i));
      }
      await Promise.allSettled(heroBatch);
      if (isCancelled) return;

      // Draw initial frame as soon as hero batch is ready
      drawFrame(0);

      // Phase 2: Skeleton keyframes across entire sequence (every 12th frame)
      // This provides instant full-page scrub responsiveness
      const skeletonBatch: Promise<HTMLImageElement>[] = [];
      for (let i = 45; i < totalFrames; i += 12) {
        skeletonBatch.push(loadSingleImage(i));
      }
      await Promise.allSettled(skeletonBatch);
      if (isCancelled) return;

      // Phase 3: Progressively stream all remaining frames in gentle chunks
      const CHUNK_SIZE = 20;
      for (let i = 45; i < totalFrames; i += CHUNK_SIZE) {
        if (isCancelled) break;
        const chunk: Promise<HTMLImageElement>[] = [];
        for (let j = i; j < Math.min(i + CHUNK_SIZE, totalFrames); j++) {
          if (!imagesRef.current[j]) {
            chunk.push(loadSingleImage(j));
          }
        }
        await Promise.allSettled(chunk);
        // Yield to browser main thread so scrolling remains silky 60fps
        await new Promise((r) => setTimeout(r, 12));
      }
    }

    preloadSequence();

    return () => {
      isCancelled = true;
    };
  }, [totalFrames, loadSingleImage, drawFrame]);

  // Handle scroll events and map page progress to target frame with neighborhood prefetch
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      const maxScroll = Math.max(
        1,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      const progress = Math.min(1, Math.max(0, scrollY / maxScroll));
      const target = Math.min(totalFrames - 1, Math.max(0, Math.round(progress * (totalFrames - 1))));
      targetFrameRef.current = target;

      // Opportunistically prefetch immediate neighborhood around current scroll position
      if (!imagesRef.current[target]) {
        loadSingleImage(target);
      }
      for (let offset = 1; offset <= 12; offset++) {
        if (target + offset < totalFrames && !imagesRef.current[target + offset]) {
          loadSingleImage(target + offset);
        }
        if (target - offset >= 0 && !imagesRef.current[target - offset]) {
          loadSingleImage(target - offset);
        }
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    handleResize();
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [totalFrames, handleResize, loadSingleImage]);

  // Main 60fps animation loop with inertial lerping
  useEffect(() => {
    let lastRendered = -1;

    const tick = () => {
      if (reducedMotion) {
        const target = targetFrameRef.current;
        if (target !== lastRendered) {
          drawFrame(target);
          lastRendered = target;
        }
        rafIdRef.current = requestAnimationFrame(tick);
        return;
      }

      // Smooth inertia interpolation
      const target = targetFrameRef.current;
      const current = currentFrameFloatRef.current;
      const diff = target - current;

      // Responsive, buttery-smooth momentum interpolation across 1076 frames
      if (Math.abs(diff) < 0.001) {
        currentFrameFloatRef.current = target;
      } else {
        currentFrameFloatRef.current += diff * 0.16;
      }

      const roundedFrame = Math.min(
        totalFrames - 1,
        Math.max(0, Math.round(currentFrameFloatRef.current)),
      );

      if (roundedFrame !== lastRendered) {
        drawFrame(roundedFrame);
        lastRendered = roundedFrame;
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [totalFrames, drawFrame, reducedMotion]);

  return (
    <div className={`pointer-events-none fixed inset-0 z-0 overflow-hidden ${className}`}>
      {/* Pinned Canvas Engine */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full object-cover"
        style={{
          filter: "contrast(1.08) saturate(1.15) brightness(0.9)",
        }}
      />

      {/* Balanced uniform cinematic film tone - preserves vibrant frames without any top gradient bar */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/25 pointer-events-none"
      />

      {/* Subtle Precision Sonar Grid / Telemetry Scan Accent */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.02] bg-[linear-gradient(to_right,#00f2fe_1px,transparent_1px),linear-gradient(to_bottom,#00f2fe_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none"
      />
    </div>
  );
};

export default ScrollyCanvasBackground;
