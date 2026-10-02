# Decoration sources

- `critters.ts` and `styles.ts` adapt the bubbles and plankton from [SuperSgdk/DSH-Liquid-Glass-Theme](https://github.com/SuperSgdk/DSH-Liquid-Glass-Theme/tree/98d2873334ce42e5cb26b5031165207d040645b1), inherited from John Wu (WYH66666666), copyright 2026. Their code is AGPL-3.0-only. The surrounding fish artwork and swim rules are removed.
- `particle-mark.ts` is the blue-white shark renderer created for the owner's confirmed visualization on 2026-10-02, then adapted to the existing main-column anchor and decoration API. It bundles 5,745 colored points, supports assembly, gentle drift, pointer displacement and return, and releases its observers, listeners and animation frames. It does not fetch an image or an SVG at runtime.
- `shark-particle-data.json` contains only `width`, `height` and `[x,y,r,g,b,edge]` points sampled on a 164×160 grid. The original supplied PNG is not included. The dark background was excluded; blue and white colors, teeth and outline are preserved.
- SuperSgdk supplied the image, approved its particle use and publication for this project on 2026-10-02, and confirmed on 2026-10-03 that it is their own image. The artwork is credited to SuperSgdk and included with the owner's permission. The project's AGPL license applies to the code; a separate general artwork license has not been specified. Ask the owner before reusing the artwork in another distribution.
- The previous OpenAI / ChatGPT knot assets have been removed from public source. No application installation assets are needed by this renderer.

`mountDecorations(container, mainAnchor, options)` owns its nodes and resources. The legacy `whale` settings key remains compatible and now controls the shark; its visible label is “鲨鱼粒子”.
