// SPDX-License-Identifier: AGPL-3.0-only

export type GlassSurfaceKind = 'sidebar' | 'composer' | 'panel';
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
  releaseTimer: number;
}

// The same signed press recipe as DSH's src/client/spotlight.ts: the edge
// under the cursor goes into the screen, and the opposite edge lifts.
const TILT_MAX = .0175;
const TILT_PERSPECTIVE = 800;
const SETTLE_MS = 240;
const POINTER_PROPERTIES = ['--cg-glow-x', '--cg-glow-y', '--cg-press-shadow'];
const CORNER_PROPERTIES = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'];

/**
 * Paint noninteractive glass behind the native controls. Only these separate
 * surfaces rotate, so input hitboxes, sidebar menus and fixed dialogs keep
 * their native geometry. Layout is measured after actual changes, never by
 * an idle animation loop; pointer bursts share one frame and cached bounds.
 */
export function mountGlassSurfaces(host: HTMLElement) {
  const records = new Map<HTMLElement, SurfaceRecord>();
  let pointer: { record: SurfaceRecord; options: GlassPointerOptions } | null = null;
  let disposed = false;
  let raf = 0;
  let geometryDirty = true;

  function ownStyle(record: SurfaceRecord, property: string, value: string) {
    if (record.surface.style.getPropertyValue(property) !== value) record.surface.style.setProperty(property, value);
  }

  function removeOwnStyle(record: SurfaceRecord, property: string) {
    if (record.surface.style.getPropertyValue(property)) record.surface.style.removeProperty(property);
  }

  function cancelRelease(record: SurfaceRecord) {
    if (record.releaseTimer) window.clearTimeout(record.releaseTimer);
    record.releaseTimer = 0;
  }

  function releasePress(record: SurfaceRecord, immediate = false) {
    cancelRelease(record);
    if (!record.surface.style.getPropertyValue('transform')) return;
    if (immediate) { removeOwnStyle(record, 'transform'); return; }
    ownStyle(record, 'transform', `perspective(${TILT_PERSPECTIVE}px) rotateX(0rad) rotateY(0rad) scale(1)`);
    record.releaseTimer = window.setTimeout(() => {
      record.releaseTimer = 0;
      removeOwnStyle(record, 'transform');
    }, SETTLE_MS);
  }

  function clearPointer() {
    if (pointer) {
      for (const property of POINTER_PROPERTIES) removeOwnStyle(pointer.record, property);
      releasePress(pointer.record);
    }
    pointer = null;
  }

  function removeRecord(record: SurfaceRecord) {
    if (pointer?.record === record) clearPointer();
    cancelRelease(record);
    resizeObserver?.unobserve(record.element);
    visibilityObserver?.unobserve(record.element);
    record.surface.remove();
    records.delete(record.element);
    record.rect = null;
  }

  function paintPointer() {
    if (!pointer) return;
    const { record, options: { x, y, press, spotlight } } = pointer;
    const rect = record.rect;
    if (record.surface.hidden || !rect || x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      clearPointer(); return;
    }
    if (spotlight) {
      ownStyle(record, '--cg-glow-x', `${x - rect.left}px`);
      ownStyle(record, '--cg-glow-y', `${y - rect.top}px`);
    } else {
      removeOwnStyle(record, '--cg-glow-x');
      removeOwnStyle(record, '--cg-glow-y');
    }
    if (press) {
      cancelRelease(record);
      const dx = Math.min(.5, Math.max(-.5, (x - rect.left) / rect.width - .5));
      const dy = Math.min(.5, Math.max(-.5, (y - rect.top) / rect.height - .5));
      ownStyle(record, 'transform', `perspective(${TILT_PERSPECTIVE}px) rotateX(${-2 * TILT_MAX * dy}rad) rotateY(${2 * TILT_MAX * dx}rad) scale(1.01)`);
      ownStyle(record, '--cg-press-shadow', `inset ${-dx * 8}px ${-dy * 8}px 18px var(--cg-shadow)`);
    } else {
      removeOwnStyle(record, '--cg-press-shadow');
      if (!record.releaseTimer) releasePress(record);
    }
  }

  function measure() {
    geometryDirty = false;
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
      if (!visible) {
        if (pointer?.record === record) clearPointer();
        releasePress(record, true);
        continue;
      }
      ownStyle(record, 'left', `${rect.left - originX}px`);
      ownStyle(record, 'top', `${rect.top - originY}px`);
      ownStyle(record, 'width', `${rect.width}px`);
      ownStyle(record, 'height', `${rect.height}px`);
      ownStyle(record, 'opacity', computed.opacity);
      // Native composer variants can be square. The skin owns their painted
      // corners and gives chat inputs the same rounding as its sidebar.
      for (const property of CORNER_PROPERTIES) ownStyle(record, property, record.kind === 'panel' ? computed.getPropertyValue(property) : '26px');
    }
  }

  function frame() {
    raf = 0;
    if (disposed || document.hidden) return;
    if (geometryDirty) measure();
    paintPointer();
  }

  function start() {
    if (!disposed && !document.hidden && records.size && !raf) raf = requestAnimationFrame(frame);
  }

  function invalidate() { geometryDirty = true; start(); }
  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(invalidate) : null;
  const visibilityObserver = typeof IntersectionObserver === 'function' ? new IntersectionObserver(invalidate) : null;
  resizeObserver?.observe(host);
  // Runtime sync covers node/class changes. Inline visibility changes and
  // native layout animations can occur without replacing a chat's nodes.
  const mutationObserver = typeof MutationObserver === 'function' ? new MutationObserver(changes => {
    if (changes.some(change => {
      const target = change.target;
      if (!(target instanceof Element) || target.closest('.cg-materials,.cg-backdrop,.cg-decorations,.cg-settings-panel')) return false;
      // Child content resizing is already covered by ResizeObserver. Only
      // the surface's own visibility/position or its ancestors can change
      // our rectangle without a size notification; unrelated animation
      // styles must not wake the layout reader.
      for (const element of records.keys()) if (target === element || target.contains(element)) return true;
      return false;
    })) invalidate();
  }) : null;
  if (document.body) mutationObserver?.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'open'] });
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      clearPointer();
    } else invalidate();
  };
  window.addEventListener('resize', invalidate, { passive: true });
  document.addEventListener('scroll', invalidate, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);

  return {
    sync(targets: GlassSurfaceTarget[]) {
      if (disposed) return;
      const desired = new Map<HTMLElement, GlassSurfaceKind>();
      for (const { element, kind } of targets) if (element.isConnected && !desired.has(element)) desired.set(element, kind);
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
          record = { element, kind, surface, rect: null, releaseTimer: 0 };
          records.set(element, record);
          host.appendChild(surface);
          resizeObserver?.observe(element);
          visibilityObserver?.observe(element);
        } else if (record.kind !== kind) {
          record.kind = kind;
          record.surface.dataset.cgMaterialFor = kind;
        }
      }
      if (!records.size && raf) { cancelAnimationFrame(raf); raf = 0; }
      // CDP can hot-load the skin while the native window is in the
      // background and RAF is suspended. Its first static material must
      // still be complete, before any foreground visibility event arrives.
      if (document.hidden) measure(); else invalidate();
    },
    updatePointer(element: HTMLElement, options: GlassPointerOptions) {
      if (disposed) return;
      const record = records.get(element);
      if (!record || !Number.isFinite(options.x) || !Number.isFinite(options.y)) { clearPointer(); return; }
      if (pointer?.record !== record) clearPointer();
      pointer = { record, options: { ...options } };
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
      resizeObserver?.disconnect(); visibilityObserver?.disconnect(); mutationObserver?.disconnect();
      window.removeEventListener('resize', invalidate);
      document.removeEventListener('scroll', invalidate, true);
      document.removeEventListener('visibilitychange', onVisibility);
      for (const record of records.values()) removeRecord(record);
      records.clear();
    },
  };
}
