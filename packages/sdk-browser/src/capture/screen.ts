// capture-design.md §3 method B (C2): one frame of the current tab through getDisplayMedia, then the
// stream is stopped. Desktop Chrome and Edge only, never in privacy mode. Masked parts are painted over.
import { makeCanvas } from "./render.js";

/** Offered on desktop Chrome and Edge, with a fine pointer, when the site's privacy mode is off. */
export function screenCaptureOffered(win: Window, privacyMode: boolean): boolean {
  if (privacyMode) return false;
  const nav = win.navigator as Navigator & { userAgentData?: { mobile?: boolean; brands?: Array<{ brand: string }> } };
  if (typeof nav.mediaDevices?.getDisplayMedia !== "function") return false;
  const ua = nav.userAgent || "";
  if (/Android|iPhone|iPad|Mobile/i.test(ua) || nav.userAgentData?.mobile) return false;
  const chromium = nav.userAgentData?.brands?.some((b) => /Chrom|Edge/i.test(b.brand)) ?? /Chrome\/|Edg\//.test(ua);
  if (!chromium) return false;
  return win.matchMedia?.("(pointer: fine)").matches ?? true;
}

/**
 * Takes one frame of this tab. `hide` is called once sharing has started (so the widget is not in the
 * picture) and `show` once the frame is taken. Returns the frame and the CSS-px to frame-px scale.
 */
export async function grabTabFrame(win: Window, hide: () => void, show: () => void): Promise<{ canvas: HTMLCanvasElement; scale: number }> {
  const options = {
    video: { displaySurface: "browser", frameRate: { ideal: 5, max: 10 } },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  } as unknown as DisplayMediaStreamOptions;
  const stream = await win.navigator.mediaDevices.getDisplayMedia(options);
  const video = win.document.createElement("video");
  try {
    hide();
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Let the hidden widget leave the frame before the picture is taken.
    await new Promise((r) => setTimeout(r, 300));
    await new Promise((r) => win.requestAnimationFrame(() => r(null)));
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error("no frame");
    const canvas = makeCanvas(w, h);
    canvas.getContext("2d")!.drawImage(video, 0, 0, w, h);
    return { canvas, scale: w / win.innerWidth };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    show();
  }
}
