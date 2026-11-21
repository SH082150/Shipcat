/**
 * 头像裁剪弹窗：正方形视口内拖动平移、滑杆缩放，确认后输出 512×512 PNG。
 *
 * `computeCropRect` 是纯函数，负责把缩放/位移换算成源图裁剪矩形；
 * DOM 部分只负责交互与样式，调用方把返回的遮罩挂到 body。
 */

import { trapFocus } from "../components/focus-trap.ts";

export interface CropRect {
  /** 源图裁剪起点 x。 */
  readonly sx: number;
  /** 源图裁剪起点 y。 */
  readonly sy: number;
  /** 源图裁剪宽（与高相等）。 */
  readonly sw: number;
  /** 源图裁剪高。 */
  readonly sh: number;
}

export interface AvatarCropOptions {
  readonly src: string;
  readonly language?: "zh" | "en";
  readonly onConfirm: (dataUrl: string) => void;
  readonly onClose: () => void;
}

const VIEWPORT = 300;
const OUTPUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

const COPY = {
  zh: {
    title: "裁剪头像",
    hint: "拖动图片调整位置，滑动下方滑杆缩放。",
    zoom: "缩放",
    cancel: "取消",
    confirm: "使用",
  },
  en: {
    title: "Crop avatar",
    hint: "Drag the image to reposition it, then use the slider to zoom.",
    zoom: "Zoom",
    cancel: "Cancel",
    confirm: "Use",
  },
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 计算 cover 显示下的源图裁剪矩形。
 *
 * 以视口中心为基准应用 offset（视口像素），并夹紧到图像边界内，
 * 保证裁剪矩形永远落在源图内。无效尺寸返回全 0。
 */
export function computeCropRect(
  imageWidth: number,
  imageHeight: number,
  zoom: number,
  offsetX: number,
  offsetY: number,
  viewport: number,
): CropRect {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    !Number.isFinite(viewport) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    viewport <= 0
  ) {
    return { sx: 0, sy: 0, sw: 0, sh: 0 };
  }

  const safeZoom = clamp(Number.isFinite(zoom) ? zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);
  const baseScale = Math.max(viewport / imageWidth, viewport / imageHeight);
  const scale = baseScale * safeZoom;
  const displayedWidth = imageWidth * scale;
  const displayedHeight = imageHeight * scale;

  const dx = (viewport - displayedWidth) / 2 + (Number.isFinite(offsetX) ? offsetX : 0);
  const dy = (viewport - displayedHeight) / 2 + (Number.isFinite(offsetY) ? offsetY : 0);

  const size = viewport / scale;
  const sx = clamp(-dx / scale, 0, Math.max(0, imageWidth - size));
  const sy = clamp(-dy / scale, 0, Math.max(0, imageHeight - size));
  return { sx, sy, sw: size, sh: size };
}

/** 打开头像裁剪弹窗；返回遮罩元素，由调用方挂到 body。 */
export function createAvatarCropModal(options: AvatarCropOptions): HTMLElement {
  const doc = document;
  const language = options.language === "zh" ? "zh" : "en";
  const copy = COPY[language];

  const overlay = doc.createElement("div");
  overlay.className = "ch-settings-overlay ch-avatar-overlay";
  const theme = (doc.documentElement as HTMLElement | undefined)?.dataset?.theme ?? "light";
  overlay.setAttribute("data-theme", theme);
  overlay.setAttribute("data-role", "avatar-crop-overlay");

  const dialog = doc.createElement("div");
  dialog.className = "ch-avatar-crop";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", copy.title);
  dialog.tabIndex = -1;
  overlay.appendChild(dialog);

  const title = doc.createElement("h2");
  title.className = "ch-avatar-title";
  title.textContent = copy.title;
  const hint = doc.createElement("p");
  hint.className = "ch-avatar-hint";
  hint.textContent = copy.hint;
  dialog.append(title, hint);

  const viewport = doc.createElement("div");
  viewport.className = "ch-avatar-viewport";
  viewport.setAttribute("data-role", "avatar-crop-viewport");
  const image = doc.createElement("img");
  image.className = "ch-avatar-image";
  image.alt = "";
  image.draggable = false;
  viewport.appendChild(image);
  dialog.appendChild(viewport);

  const zoomRow = doc.createElement("label");
  zoomRow.className = "ch-avatar-zoom";
  const zoomLabel = doc.createElement("span");
  zoomLabel.textContent = copy.zoom;
  const slider = doc.createElement("input");
  slider.type = "range";
  slider.min = String(MIN_ZOOM);
  slider.max = String(MAX_ZOOM);
  slider.step = "0.01";
  slider.value = String(MIN_ZOOM);
  slider.setAttribute("aria-label", copy.zoom);
  zoomRow.append(zoomLabel, slider);
  dialog.appendChild(zoomRow);

  const footer = doc.createElement("div");
  footer.className = "ch-avatar-actions";
  const cancelButton = doc.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "ch-settings-action";
  cancelButton.setAttribute("data-role", "avatar-crop-cancel");
  cancelButton.textContent = copy.cancel;
  const confirmButton = doc.createElement("button");
  confirmButton.type = "button";
  confirmButton.className = "ch-settings-action ch-avatar-confirm";
  confirmButton.setAttribute("data-role", "avatar-crop-confirm");
  confirmButton.textContent = copy.confirm;
  confirmButton.disabled = true;
  footer.append(cancelButton, confirmButton);
  dialog.appendChild(footer);

  let imageWidth = 0;
  let imageHeight = 0;
  let zoom = MIN_ZOOM;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let closed = false;

  const scaleFor = (value: number): number =>
    Math.max(VIEWPORT / imageWidth, VIEWPORT / imageHeight) * value;

  const clampOffsets = (x: number, y: number): { x: number; y: number } => {
    if (imageWidth <= 0 || imageHeight <= 0) return { x: 0, y: 0 };
    const scale = scaleFor(zoom);
    const maxX = Math.max(0, (imageWidth * scale - VIEWPORT) / 2);
    const maxY = Math.max(0, (imageHeight * scale - VIEWPORT) / 2);
    return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
  };

  const render = (): void => {
    if (imageWidth <= 0 || imageHeight <= 0) return;
    const rect = computeCropRect(imageWidth, imageHeight, zoom, offsetX, offsetY, VIEWPORT);
    const scale = VIEWPORT / rect.sw;
    image.style.width = `${imageWidth * scale}px`;
    image.style.height = `${imageHeight * scale}px`;
    image.style.left = `${-rect.sx * scale}px`;
    image.style.top = `${-rect.sy * scale}px`;
  };

  image.addEventListener("load", () => {
    imageWidth = image.naturalWidth;
    imageHeight = image.naturalHeight;
    if (imageWidth <= 0 || imageHeight <= 0) return;
    confirmButton.disabled = false;
    render();
  });
  image.addEventListener("error", () => {
    confirmButton.disabled = true;
  });
  image.src = options.src;

  viewport.addEventListener("pointerdown", (event) => {
    if (imageWidth <= 0) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    dragOffsetX = offsetX;
    dragOffsetY = offsetY;
    viewport.setPointerCapture?.(event.pointerId);
  });
  viewport.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const next = clampOffsets(
      dragOffsetX + event.clientX - dragStartX,
      dragOffsetY + event.clientY - dragStartY,
    );
    offsetX = next.x;
    offsetY = next.y;
    render();
  });
  const endDrag = (event: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    viewport.releasePointerCapture?.(event.pointerId);
  };
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  slider.addEventListener("input", () => {
    if (imageWidth <= 0 || imageHeight <= 0) return;
    zoom = clamp(Number(slider.value), MIN_ZOOM, MAX_ZOOM);
    const next = clampOffsets(offsetX, offsetY);
    offsetX = next.x;
    offsetY = next.y;
    render();
  });

  const disposeTrap = trapFocus(overlay, { initialFocus: '[data-role="avatar-crop-cancel"]' });

  const close = (): void => {
    if (closed) return;
    closed = true;
    disposeTrap();
    overlay.remove();
    options.onClose();
  };

  const confirm = (): void => {
    if (imageWidth <= 0 || imageHeight <= 0) return;
    const rect = computeCropRect(imageWidth, imageHeight, zoom, offsetX, offsetY, VIEWPORT);
    const canvas = doc.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const dataUrl = canvas.toDataURL("image/png");
    options.onConfirm(dataUrl);
    close();
  };

  cancelButton.addEventListener("click", close);
  confirmButton.addEventListener("click", confirm);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  overlay.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });

  return overlay;
}
