# WebGL Warnings & How We Mitigated Them

This document explains the runtime warnings we previously saw in the browser console during avatar customization and variant preview rendering, and the steps implemented (or still recommended) to mitigate them.

## 1. "Too many active WebGL contexts" / Context Limit Reached
**Meaning:** Browsers (Chrome ~16, Firefox ~8, some mobile devices lower) cap the number of simultaneously alive WebGLRenderingContext instances to preserve GPU memory and prevent resource exhaustion.

**Why it happened here:** Each variant preview card originally mounted its own <Canvas> (react-three-fiber). Scrolling a long list meant many canvases instantiated before earlier ones were GC'd, pushing us past the browser's soft limit.

**Mitigation Implemented:**
- Introduced virtualization so only a small window of variant preview canvases exist at once.
- Unmounted / disposed canvases outside the viewport, lowering concurrent contexts.

**Extra (Optional) Hardening:**
- Reuse a single shared preview Canvas, swapping the model (more complex refactor, not yet required).
- Offer a "thumbnail raster cache" (bake once to a <img> via toDataURL) for static poses.

## 2. WebGL Context Lost / Restored Events
**Meaning:** The GPU driver or browser forcibly resets a context (memory pressure, tab in background, TDR reset, or hitting the context limit). When lost, rendering pauses; when restored, assets must be re-uploaded.

**Previous Surface Symptom:** Intermittent black previews or frozen rotation until a re-render.

**Mitigation Implemented:** Reducing simultaneous contexts dramatically reduces forced losses related to limit pressure.

**Recommended Follow Up:** Register context lost / restored handlers on the main canvas to gracefully pause animations and re-trigger asset onRestore if needed (three.js usually auto-handles buffers/textures, but custom render targets may need manual reset).

```
renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); /* flag paused */ });
renderer.domElement.addEventListener('webglcontextrestored', () => { /* refit / resume */ });
```

## 3. INVALID_OPERATION: deleteBuffer: object does not belong to context
**Meaning:** Attempt to delete a WebGLBuffer (or texture) with a context different from the one that created it, or after its context is lost.

**Cause in React/three setups:** Rapid mount/unmount cycles plus asynchronous disposal (React Fiber reconciliation) can schedule disposal after a canvas already unmounted or context lost. three.js tries to delete GPU resources, but the underlying handle no longer matches the active context.

**Impact:** Harmless warning; resource is already effectively gone. No functional leak because the context itself is destroyed.

**Mitigation Implemented:** Lower churn by virtualizing previews (fewer rapid mount/unmount cycles). This inherently reduces timing windows that trigger these warnings.

**Optional Further Steps:**
- Debounce unmount disposal for preview canvases (keep them alive for ~250ms grace) to avoid thrash.
- Ensure no manual renderer.dispose() calls race with React unmount (currently none present).

## 4. Memory & GPU Resource Pressure
**Symptoms:** Increasing frame times, occasional stutters, context loss under heavy tab multitasking.

**Current Safeguards:**
- Only essential lights & environment in each canvas.
- Automatic framing limits unnecessary large bounding-box scaling (keeps geometry within moderate size, lowering required precision changes).

**Potential Enhancements:**
- Mipmapping & texture compression (KTX2/Basis) for large textures.
- DRACO-compress GLB meshes to reduce network + GPU vertex buffer size.
- Merge static meshes per avatar part category at load to reduce draw calls (careful with part swapping).

## 5. Best Practices Summary
| Issue | What We Did | Future Option |
|-------|-------------|--------------|
| Context limit | Virtualize preview canvases | Single shared canvas / raster thumbnails |
| Context lost | Reduced pressure | Add explicit event handlers |
| INVALID_OPERATION deletes | Reduced churn | Debounce disposal |
| GPU memory footprint | Simplified per-canvas scene | Texture compression, mesh merge |

## 6. Actionable Checklist (Current Status)
- [x] Virtualized variant preview list
- [x] Reduced simultaneous Canvas instances
- [x] Auto-framing to keep geometry sized reasonably
- [ ] Add context lost/restored listeners (optional)
- [ ] Investigate texture compression (optional)
- [ ] Consider shared preview canvas refactor (optional)

## 7. TL;DR
We previously created more WebGL canvases than the browser liked. Virtualization cut the active count, removing pressure that triggered context loss and disposal race warnings. Remaining warnings (if any) are cosmetic; further stability can come from optional listeners and potential single-canvas or cached-thumbnail approaches.

---
_Last updated: 2025-09-14_

## 8. Update (2025-09-14 Cleanup)
Earlier we experimented with:
- A zustand webgl store + floating `WebGLContextBanner`.
- A `SharedVariantPreviewProvider` single overlay canvas.

Current State (Cleanup Applied):
- Removed banner + store + shared overlay provider to simplify code.
- Reverted to on-demand per-card preview canvases (still conditional mount: eager first few, hover/active others).
- Retained auto-framing + minimal scene lighting.

Why Removed:
- Prototype UI noise: banner distracted from core gameplay panels.
- Simplicity: fewer abstraction layers while iterating quickly.
- Current card count & conditional mounting keep active contexts low enough (< ~8) so limits aren't hit.

If Re‑introducing Later:
- Re-add a lightweight telemetry hook instead of a global store (e.g. event emitter feeding dev console panel).
- Prefer a single shared canvas only if horizontal lists exceed ~40 simultaneously visible preview slots.

Optional Future Task List:
- [ ] Add a feature flag (env var) to enable shared preview mode for QA
- [ ] Integrate context loss metrics into a hidden debug menu (Ctrl+Shift+D)
- [ ] Add thumbnail raster cache fallback for low-power devices

---
_Status: Banner & shared preview removed in current build._
