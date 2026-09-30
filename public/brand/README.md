# ORION Clinic — Orbit identity

Selected by the owner on 2026-09-24; updated for Saturn-like depth and occlusion.

## Files

- `orion-mark.svg` / `orion-mark-mint.svg`: static scalable symbol for light/dark surfaces.
- `orion-wordmark.svg` / `orion-wordmark-light.svg`: separate outlined ORION Clinic typography.
- `orion-orbit-animated.svg`: decorative mark, 14-second orbit.
- `orion-loader.svg` / `orion-loader-mint.svg`: 3.6-second indeterminate loading mark.
- `orion-mark-depth.png`: selected symbol with the depth correction, transparent raster.
- `orion-wordmark.png`: separate transparent raster name.
- `orion-mark.png`: retained first standalone raster iteration.
- `index.html`: interactive preview with pause control and download links.
- `Golos-Text-LICENSE.txt`: license for the outlined Golos Text letterforms.

Preview while the local application is running: http://127.0.0.1:3200/brand/index.html

## Implementation

The application uses `app/brand/orion-brand.tsx` and its CSS module, not a bitmap.
The far orbit and satellite pass behind the entire O silhouette; the near arc and
satellite pass in front. Three synchronized satellite instances supply the
foreground, background and negative-space mask. Unique SVG IDs prevent interference
between multiple marks on one page.

The application wordmark remains accessible live text. Exported SVG typography
uses outlines from the project's installed static Golos Text fonts, with no font
network request. The PNG images are ImageGen concepts; the clean SVG reconstruction
is deliberately not a pixel-identical trace.

Brand motion is decorative and slower than real loading feedback. Waiting/error/
success states do not masquerade as active loading. CSS reduced-motion and unsupported
motion-path fallbacks retain a visible static symbol. No JavaScript animation loop.

## Verification, 2026-09-24

- 107 focused tests in 11 files passed, including 11 brand tests.
- Scoped ESLint, full application typecheck and git diff whitespace check passed.
- Browser: light/dark preview, synchronized motion, pause fallback, app-header mark,
  desktop wordmark and narrow-width symbol-only layout checked.
- OS reduced-motion CSS is covered in tests; OS setting was not changed for acceptance.
- Main web/STT services and clinical data untouched; no deployment or cloud mutation.
- No trademark clearance or clinical/production-readiness claim.

Raster generation used the built-in ImageGen tool with reference images.
See `PROMPTS.md` for prompts. SVG geometry and motion are repo-native implementation.
