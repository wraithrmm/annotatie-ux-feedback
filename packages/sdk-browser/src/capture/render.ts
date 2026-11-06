// capture-design.md §1, §3, §7: drawing the screenshot and fitting each file to its limit.
//   method A: the page copy drawn through an SVG foreignObject onto a canvas;
//   files: WebP, at most 2× density and 2,560 px on the long edge; quality is lowered first, then density.
import type { Rect } from "@annotatie/core";

export const LIMITS = {
  page: 1_500_000,
  pageMarked: 1_500_000,
  closeup: 300_000,
  html: 2_000_000,
} as const;

export const MAX_DENSITY = 2;
export const MAX_EDGE = 2560;
export const QUALITIES = [0.85, 0.72, 0.6, 0.48, 0.36] as const;
export const DENSITY_STEPS = [1, 0.75, 0.5, 0.35, 0.25] as const;
export const CLOSEUP_MARGIN = 48;
export const MARK_COLOUR = "#ba0e17";

/** The scale a screenshot is drawn at: the device's density, at most 2×, and at most 2,560 px long. */
export function baseScale(viewport: { width: number; height: number }, dpr: number): number {
  const d = Math.min(Math.max(dpr || 1, 1), MAX_DENSITY);
  const long = Math.max(viewport.width, viewport.height) * d;
  return long > MAX_EDGE ? MAX_EDGE / Math.max(viewport.width, viewport.height) : d;
}

export interface Fitted<T> {
  blob: T;
  density: number;
  quality: number;
}

/**
 * Tries each quality at full density, then each lower density, and returns the first encoding within
 * the limit, or null when even the smallest is too big (the file is then left out).
 */
export async function fitToLimit<T extends { size: number }>(
  encode: (density: number, quality: number) => Promise<T | null>,
  limit: number,
  densities: readonly number[] = DENSITY_STEPS,
  qualities: readonly number[] = QUALITIES,
): Promise<Fitted<T> | null> {
  for (const density of densities) {
    for (const quality of qualities) {
      const blob = await encode(density, quality);
      if (!blob) return null;
      if (blob.size <= limit) return { blob, density, quality };
    }
  }
  return null;
}

/** The part's box grown by the margin and kept inside the viewport; null when none of it is visible. */
export function closeupRect(part: Rect, viewport: { width: number; height: number }, margin = CLOSEUP_MARGIN): Rect | null {
  const x0 = Math.max(0, part.x - margin);
  const y0 = Math.max(0, part.y - margin);
  const x1 = Math.min(viewport.width, part.x + part.width + margin);
  const y1 = Math.min(viewport.height, part.y + part.height + margin);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => reject(new Error("timed out")), timeoutMs);
    img.onload = () => {
      clearTimeout(t);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error("could not draw the page"));
    };
    img.decoding = "async";
    img.src = src;
  });
}

/** Method A: the SVG drawn at `scale` onto a new canvas. */
export async function drawSvg(svg: string, viewport: { width: number; height: number }, scale: number, timeoutMs = 15_000): Promise<HTMLCanvasElement> {
  const img = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, timeoutMs);
  const canvas = makeCanvas(viewport.width * scale, viewport.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Reading a pixel proves the canvas is not tainted before any work is spent encoding it.
  ctx.getImageData(0, 0, 1, 1);
  return canvas;
}

export function scaled(src: HTMLCanvasElement, factor: number): HTMLCanvasElement {
  if (factor === 1) return src;
  const c = makeCanvas(src.width * factor, src.height * factor);
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export function crop(src: HTMLCanvasElement, r: Rect, scale: number): HTMLCanvasElement {
  const c = makeCanvas(r.width * scale, r.height * scale);
  c.getContext("2d")!.drawImage(src, r.x * scale, r.y * scale, r.width * scale, r.height * scale, 0, 0, c.width, c.height);
  return c;
}

/** A copy with the part outlined (3 px, 2 px outside the part, like the page copy's own mark). */
export function marked(src: HTMLCanvasElement, part: Rect, scale: number): HTMLCanvasElement {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  ctx.strokeStyle = MARK_COLOUR;
  ctx.lineWidth = 3 * scale;
  const off = 3.5 * scale;
  ctx.strokeRect(part.x * scale - off, part.y * scale - off, part.width * scale + off * 2, part.height * scale + off * 2);
  return c;
}

/** Paints solid boxes over masked parts (method B cannot mask in the DOM). */
export function paintMasks(canvas: HTMLCanvasElement, boxes: Rect[], scale: number): void {
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#c7cdd6";
  for (const b of boxes) ctx.fillRect(b.x * scale, b.y * scale, b.width * scale, b.height * scale);
}

export function encodeWebp(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b && b.type === "image/webp" ? b : null), "image/webp", quality);
    } catch {
      resolve(null);
    }
  });
}

/** Encodes a canvas as WebP within `limit`: quality first, then density. */
export async function fitCanvas(canvas: HTMLCanvasElement, limit: number): Promise<Fitted<Blob> | null> {
  const cache = new Map<number, HTMLCanvasElement>();
  return fitToLimit(async (density, quality) => {
    let c = cache.get(density);
    if (!c) {
      c = scaled(canvas, density);
      cache.set(density, c);
    }
    return encodeWebp(c, quality);
  }, limit);
}

export async function gzip(text: string): Promise<Blob | null> {
  const CS = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!CS) return null;
  const stream = new Blob([text], { type: "text/html" }).stream().pipeThrough(new CS("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Blob([buf], { type: "text/html" });
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
