# GPU-Aware Alternatives to Inkscape CLI

## Context
- Current pipeline: PowerShell drives Inkscape 1.x CLI to crop SVGs into map tiles. Rendering is CPU-bound and saturates cores at higher zoom ranges.
- Goal: identify Windows-friendly replacements that can move rasterization work onto the GPU while still being automatable.

## Evaluation Criteria
- **True GPU involvement**: renderer must be able to rasterize using Direct3D/OpenGL/Vulkan (not just blit to GPU after CPU paint).
- **Automation surface**: needs a scriptable CLI or API suitable for batch tiling.
- **SVG feature coverage**: support for filters, masks, blur, and large coordinate spaces.
- **Operational fit**: realistic install footprint, licensing, and effort to slot into the existing PowerShell/Inkscape workflow.

## Option Summary
| Approach | GPU Acceleration | Automation Path | Strengths | Gaps / Risks |
| --- | --- | --- | --- | --- |
| Microsoft Edge / Chromium (headless) | ANGLE → Direct3D or hardware GL. GPU compositing and raster when enabled. | Node.js/PowerShell automation via Playwright or Puppeteer; feed SVG/HTML, capture viewport snapshots. | Modern SVG & CSS support, easy install (Edge/Chrome already present), robust tiling via scripts, parallel-friendly. | Headless GPU must be explicitly enabled (`--headless=new --enable-gpu-rasterization --use-gl=angle`). Filters still fall back to CPU for some cases; startup cost per tile unless process is reused. |
| SkiaSharp + Direct3D backend | Skia GPU backend (GrDirectContext) targets Direct3D 11 on Windows. | .NET 8 console app calling SkiaSharp; expose CLI for tile coords. | Full control, fast raster via GPU, runs entirely in-process, easy to integrate with PowerShell. | Requires custom coding + maintenance; Skia’s SVG coverage (via SkiaSharp.Extended.Svg) is good but not 100%; complex filters/masks may differ from Inkscape. |
| WPF + SharpVectors + RenderTargetBitmap | WPF composition uses Direct3D (hardware tier ≥1). | .NET / PowerShell host an invisible WPF window, load SVG with SharpVectors, render to bitmap. | Pure .NET stack, no external runtime; reasonable SVG coverage; integrates with existing scripts. | WPF falls back to software for many SVG filters; batch rendering needs STA threading & message pump management; slower than Skia for huge batches. |
| Qt 6 Quick (QtQuick SVG Image) | Qt Quick scene graph renders via Direct3D 11 (ANGLE) on Windows. | QML or C++ app using `Image { source: "file.svg" }` + `QQuickRenderControl` to render off-screen; expose CLI. | Mature GPU pipeline, good filtering, cross-platform, can batch multiple tiles per process. | Requires Qt install/build, C++ glue; licensing (GPL/LGPL/commercial) considerations; SVG Tiny focus—some filters need QtSvg module.

## Detailed Notes

### 1. Microsoft Edge / Chromium Headless Capture
- **Rendering path**: Chromium’s compositor can raster SVG into GPU surfaces via ANGLE (Direct3D 11) or native OpenGL when the GPU process is allowed. Chrome 109+ supports `--headless=new`, which keeps the GPU process alive even in headless.
- **Workflow sketch**: Pre-render an HTML shell that inlines the SVG. Use Playwright/Puppeteer to launch `msedge.exe` or `chrome.exe` with flags:
  ```powershell
  $flags = @(
    '--headless=new',
    '--enable-gpu-rasterization',
    '--enable-zero-copy', # faster uploads
    '--use-gl=angle',     # Direct3D 11 via ANGLE
    '--disable-features=UseSkiaRenderer' # optional: stick with GPU compositor
  )
  ```
  Script crops by setting the viewport and using `page.screenshot()` or `captureScreenshot` DevTools call per tile.
- **Throughput**: Keep the browser instance warm and dispatch tile jobs via CDP to avoid per-launch overhead. Parallelize with multiple browser contexts.
- **SVG fidelity**: Very high—Chromium supports most filters, masks, and CSS effects used in modern SVG maps. Verify GPU usage via `chrome://gpu` or `about:gpu` in a non-headless session.
- **Integration**: PowerShell can orchestrate Node scripts. Consider writing the tile loop in TypeScript, exposing CLI args (`--svg`, `--zoom`, `--x`, `--y`).

### 2. SkiaSharp + Direct3D Backend
- **Rendering path**: Skia’s GPU backend (`SkiaSharp.GRContext.Create`) can target Direct3D 11 using ANGLE. Rasterization jobs execute on the GPU, falling back when unsupported features appear.
- **Implementation sketch**:
  ```csharp
  using SkiaSharp;
  using SkiaSharp.Extended.Svg;

  using var ctx = GRContext.Create(GRBackend.Direct3D, new GRContextOptions());
  using var surface = SKSurface.Create(ctx, true, new SKImageInfo(tileSize, tileSize));
  var svg = new SKSvg();
  svg.Load(inputSvg);
  surface.Canvas.DrawPicture(svg.Picture, ref viewportMatrix);
  surface.Snapshot().Encode(SKEncodedImageFormat.Png, 90)
         .SaveTo(File.OpenWrite(outputPath));
  ```
  Control the viewport by applying a scaling matrix. Wrap in a CLI app that accepts tile coordinates and reuses the context across tiles for performance.
- **Pros**: Single exe, no browser dependency, deterministic results. Skia is extremely fast on GPU and well-suited for tiling.
- **Cons**: Must build/ship Direct3D ANGLE binaries (SkiaSharp ships them). Some SVG filters (e.g., complex blend modes) are not implemented; need visual QA.

### 3. WPF + SharpVectors + RenderTargetBitmap
- **Rendering path**: WPF renders vector content through its retained-mode visual tree. On capable GPUs (Tier ≥ 1), composition and many primitives are hardware accelerated via Direct3D.
- **Implementation sketch**: Use SharpVectors to load SVG into a `DrawingGroup`, display in a hidden `Canvas`, and call `RenderTargetBitmap.Render()` scoped to the tile rectangle.
- **Pros**: All .NET managed code, integrates seamlessly with PowerShell (can host WPF directly). Minimal extra dependencies.
- **Cons**: WPF frequently falls back to software for filters like `feGaussianBlur` or large masks, so GPU gains may be inconsistent. Needs an STA thread with Dispatcher pumping—batch execution is more involved than a simple CLI.

### 4. Qt Quick Off-screen Renderer
- **Rendering path**: Qt Quick 6 on Windows uses the scene graph to render via Direct3D 11 (through ANGLE). SVG can be rendered by either the `QtSvg` module into textures or by embedding the SVG inside QML (`SvgImage`).
- **Implementation sketch**: A tiny C++ app uses `QQuickRenderControl` to render an `Item` tree off-screen, adjusting a `ShaderEffectSource` or `QQuickItem` geometry per tile. Capture results with `QImage::fromData()`.
- **Pros**: High-quality GPU pipeline, robust for animations and filters, cross-platform if you need Linux builds later.
- **Cons**: Heavy dependency (Qt SDK), C++ toolchain requirement, licensing considerations for closed-source projects. SVG Tiny subsets need extra testing for complex filters.

## Recommendations & Next Steps
1. **Prototype Chromium headless**: quickest path—Edge already installed, Playwright tooling is mature, and GPU acceleration is straightforward once flags are set. Validate on a small tile set and confirm GPU utilization via Windows Task Manager (GPU Engine column).
2. **Evaluate SkiaSharp if Chromium fidelity diverges**: build a .NET proof-of-concept and compare render outputs with Inkscape for edge cases (blur, mask, clipping paths). Measure throughput against CPU-bound Inkscape.
3. **Treat WPF/Qt as fallback options**: they are viable but require more plumbing for batch automation and may still rely on CPU for complex SVG effects.
4. **Benchmark carefully**: even GPU pipelines can become CPU-bound if each tile launch forces scene re-parsing. Cache parsed SVGs or maintain warm render contexts.

## Additional Considerations
- GPU workloads may reveal driver bugs—keep latest GPU drivers and test on target hardware.
- Headless browsers and Skia can run multiple tiles per frame; consider batching to reduce setup overhead.
- Update the PowerShell harness to detect which renderer is installed and provide a `-Renderer` switch so workflows can switch between Inkscape and a GPU alternative for regression comparisons.
