import React, { useEffect, useRef, useCallback } from "react";
import { usePrefersReducedMotion } from "../../hooks/usePrefersReducedMotion";

interface ScrollyCanvasBackgroundProps {
  className?: string;
  totalFrames?: number;
  initialFrame?: number;
}

const TOTAL_FRAMES = 240;

function getFrameUrl(index: number): string {
  const padded = String(index).padStart(6, "0");
  return `/frames/frame_${padded}.jpeg`;
}

export const ScrollyCanvasBackground: React.FC<ScrollyCanvasBackgroundProps> = ({
  className = "",
  totalFrames = TOTAL_FRAMES,
  initialFrame = 0,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<(HTMLImageElement | null)[]>(new Array(totalFrames).fill(null));
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
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Find the closest loaded frame to avoid black flickers
    let imgToDraw = imagesRef.current[frameIdx];
    if (!imgToDraw || !imgToDraw.complete || imgToDraw.naturalWidth === 0) {
      // Seek closest loaded frame
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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvasWidth = canvas.width / dpr;
    const canvasHeight = canvas.height / dpr;

    // Calculate aspect-ratio "cover" coordinates
    const imgWidth = imgToDraw.naturalWidth;
    const imgHeight = imgToDraw.naturalHeight;
    const scale = Math.max(canvasWidth / imgWidth, canvasHeight / imgHeight);
    const drawWidth = imgWidth * scale;
    const drawHeight = imgHeight * scale;
    const drawX = (canvasWidth - drawWidth) / 2;
    const drawY = (canvasHeight - drawHeight) / 2;

    ctx.save();
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(imgToDraw, drawX, drawY, drawWidth, drawHeight);
    ctx.restore();

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
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
      // Redraw current frame after resize
      if (renderedFrameRef.current >= 0) {
        drawFrame(renderedFrameRef.current);
      }
    }
  }, [drawFrame]);

  // Load single image with caching
  const loadSingleImage = useCallback(
    (index: number): Promise<HTMLImageElement> => {
      return new Promise((resolve, reject) => {
        if (imagesRef.current[index]?.complete) {
          resolve(imagesRef.current[index]!);
          return;
        }

        const img = new Image();
        img.src = getFrameUrl(index);
        img.onload = () => {
          imagesRef.current[index] = img;
          loadedSetRef.current.add(index);

          // If this is the initial frame, draw immediately
          if (index === 0 && renderedFrameRef.current === -1) {
            drawFrame(0);
          }
          resolve(img);
        };
        img.onerror = (e) => {
          // If public path fails, try fallback
          const fallback = `/PicturesBG/frame_${String(index).padStart(6, "0")}.jpeg`;
          img.src = fallback;
          img.onload = () => {
            imagesRef.current[index] = img;
            loadedSetRef.current.add(index);
            if (index === 0 && renderedFrameRef.current === -1) {
              drawFrame(0);
            }
            resolve(img);
          };
          img.onerror = () => reject(e);
        };
      });
    },
    [drawFrame],
  );

  // Progressive image preloader
  useEffect(() => {
    let isCancelled = false;

    async function preloadSequence() {
      // Step 1: Eagerly load initial keyframes (0 through 25)
      const priorityBatch: Promise<HTMLImageElement>[] = [];
      for (let i = 0; i < Math.min(25, totalFrames); i++) {
        priorityBatch.push(loadSingleImage(i));
      }
      await Promise.allSettled(priorityBatch);
      if (isCancelled) return;

      // Draw initial frame as soon as priority batch completes
      drawFrame(0);

      // Step 2: Progressively load remaining frames in small batches
      const BATCH_SIZE = 12;
      for (let i = 25; i < totalFrames; i += BATCH_SIZE) {
        if (isCancelled) break;
        const batch: Promise<HTMLImageElement>[] = [];
        for (let j = i; j < Math.min(i + BATCH_SIZE, totalFrames); j++) {
          batch.push(loadSingleImage(j));
        }
        await Promise.allSettled(batch);
        // Small yield to keep main thread completely free for 60fps scrolling
        await new Promise((r) => setTimeout(r, 20));
      }
    }

    preloadSequence();

    return () => {
      isCancelled = true;
    };
  }, [totalFrames, loadSingleImage, drawFrame]);

  // Handle scroll events and map page progress to target frame
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
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleResize);
    handleResize();
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleResize);
    };
  }, [totalFrames, handleResize]);

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

      // Lerp factor: 0.14 provides buttery, responsive cinematic glide
      currentFrameFloatRef.current += diff * 0.14;

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

      {/* Balanced cinematic film tone - dims harsh sun glare so unboxed text remains crisp & prominent */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/45 to-black/60 pointer-events-none"
      />

      {/* Perimeter vignette for cinematic focus */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(4,9,15,0.4)_80%,rgba(4,9,15,0.7)_100%)] pointer-events-none"
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
