// SPDX-License-Identifier: AGPL-3.0-only

export type GlassSurfaceKind = 'sidebar' | 'composer';
export interface GlassSurfaceTarget { element: HTMLElement; kind: GlassSurfaceKind; }
export interface GlassPointerOptions {
  /** Viewport coordinates, matching PointerEvent.clientX/clientY. */
  x: number;
  y: number;
  press: boolean;
  spotlight: boolean;
}

interface SurfaceRecord {
  element: HTMLElement;
  kind: GlassSurfaceKind;
  surface: HTMLDivElement;
  rect: DOMRect | null;
}

const FRAME_INTERVAL = 1000 / 30;
const POINTER_PROPERTIES = ['--cg-glow-x', '--cg-glow-y', '--cg-press-shadow'];

/**
 * Draw glass in an independent fixed host, without changing native elements.
 * The host should cover the viewport. Native DOM is read only: its rectangles
 * and existing corner radii tell these absolute, noninteractive layers where
 * to paint. In particular, native controls never receive a filter, transform,
 * border, position, sizing rule, or additional child from this module.
 */
export function mountGlassSurfaces(host: HTMLElement) {
  const records = new Map<HTMLElement, SurfaceRecord>();
  let pointer: { record: SurfaceRecord; options: GlassPointerOptions } | null = null;
  let disposed = false;
  let raf = 0;
  let lastPaint = -Infinity;

  function ownStyle(record: SurfaceRecord, property: string, value: string) {
    if (record.surface.style.getPropertyValue(property) !== value) {
      record.surface.style.setProperty(property, value);
    }
  }

  function removeOwnStyle(record: SurfaceRecord, property: string) {
    if (record.surface.style.getPropertyValue(property)) record.surface.style.removeProperty(property);
  }

  function clearPointer() {
    if (pointer) for (const property of POINTER_PROPERTIES) removeOwnStyle(pointer.record, property);
    pointer = null;
  }

  function removeRecord(record: SurfaceRecord) {
    if (pointer?.record === record) clearPointer();
    record.surface.remove();
    records.delete(record.element);
    record.rect = null;
  }

  function paintPointer(record: SurfaceRecord) {
    if (pointer?.record !== record || record.surface.hidden || !record.rect) return;
    const { x, y, press, spotlight } = pointer.options;
    if (spotlight) {
      ownStyle(record, '--cg-glow-x', `${x - record.rect.left}px`);
      ownStyle(record, '--cg-glow-y', `${y - record.rect.top}px`);
    } else {
      removeOwnStyle(record, '--cg-glow-x');
      removeOwnStyle(record, '--cg-glow-y');
    }
    // The optional press effect changes only the painted shadow, never geometry.
    if (press) ownStyle(record, '--cg-press-shadow', 'inset 0 3px 18px var(--cg-shadow)');
    else removeOwnStyle(record, '--cg-press-shadow');
  }

  function paint() {
    const hostRect = host.getBoundingClientRect();
    const originX = hostRect.left + host.clientLeft - host.scrollLeft;
    const originY = hostRect.top + host.clientTop - host.scrollTop;
    for (const record of records.values()) {
      const { element, surface } = record;
      if (!element.isConnected) { removeRecord(record); continue; }
      const rect = element.getBoundingClientRect();
      const computed = getComputedStyle(element);
      const visible = element.getClientRects().length > 0 && rect.width > 0 && rect.height > 0 &&
        computed.display !== 'none' && computed.visibility !== 'hidden' && computed.visibility !== 'collapse' &&
        Number(computed.opacity) !== 0 &&
        (typeof element.checkVisibility !== 'function' || element.checkVisibility({
          opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true,
        }));
      if (surface.hidden === visible) surface.hidden = !visible;
      record.rect = visible ? rect : null;
      if (!visible) continue;
      ownStyle(record, 'left', `${rect.left - originX}px`);
      ownStyle(record, 'top', `${rect.top - originY}px`);
      ownStyle(record, 'width', `${rect.width}px`);
      ownStyle(record, 'height', `${rect.height}px`);
      ownStyle(record, 'opacity', computed.opacity);
      for (const property of ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius']) {
        ownStyle(record, property, computed.getPropertyValue(property));
      }
      paintPointer(record);
    }
  }

  function frame(time: number) {
    raf = 0;
    if (disposed) return;
    if (time - lastPaint >= FRAME_INTERVAL) { lastPaint = time; paint(); }
    if (records.size) raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!disposed && records.size && !raf) raf = requestAnimationFrame(frame);
  }

  return {
    sync(targets: GlassSurfaceTarget[]) {
      if (disposed) return;
      const desired = new Map<HTMLElement, GlassSurfaceKind>();
      for (const { element, kind } of targets) {
        if (element.isConnected && !desired.has(element)) desired.set(element, kind);
      }
      for (const record of records.values()) if (!desired.has(record.element)) removeRecord(record);
      for (const [element, kind] of desired) {
        let record = records.get(element);
        if (!record) {
          const surface = document.createElement('div');
          surface.className = 'cg-material-surface';
          surface.setAttribute('aria-hidden', 'true');
          surface.dataset.cgMaterialFor = kind;
          surface.hidden = true;
          surface.style.position = 'absolute';
          surface.style.pointerEvents = 'none';
          record = { element, kind, surface, rect: null };
          records.set(element, record);
          host.appendChild(surface);
        } else if (record.kind !== kind) {
          record.kind = kind;
          record.surface.dataset.cgMaterialFor = kind;
        }
      }
      if (!records.size && raf) { cancelAnimationFrame(raf); raf = 0; }
      paint();
      start();
    },
    updatePointer(element: HTMLElement, options: GlassPointerOptions) {
      if (disposed) return;
      const record = records.get(element);
      if (!record || !Number.isFinite(options.x) || !Number.isFinite(options.y)) { clearPointer(); return; }
      if (pointer?.record !== record) clearPointer();
      pointer = { record, options: { ...options } };
      paintPointer(record);
      start();
    },
    clearPointer,
    getStatus() {
      return {
        active: !disposed,
        count: records.size,
        visible: [...records.values()].filter(record => !record.surface.hidden).length,
        kinds: [...records.values()].map(record => record.kind),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearPointer();
      for (const record of records.values()) removeRecord(record);
      records.clear();
    },
  };
}
