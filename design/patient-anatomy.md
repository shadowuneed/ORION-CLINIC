# Patient anatomy illustration

Generated on 2026-09-28 using the imagegen skill for the owner's anatomical
patient-card reference. Output: `public/patient-body/anatomy-v1.png`.
1024 × 1536 PNG with transparency. No patient image or medical record was used.

The bitmap supplies visual anatomy only. Interactive labels, values and provenance
are separate accessible UI elements populated from authorized saved observations.
It is not an individual scan, diagnosis, organ-risk map or sex-specific medical model.

## Female visual variant — 2026-09-28

The owner's follow-up requested a female illustration selected from the stored
`sexAtBirth` field. Added `public/patient-body/anatomy-female-v1.png` using the
built-in image generation tool, editing the existing generic illustration.
1024 × 1536 PNG; transparent corner alpha verified as 0. The original remains.
`female` selects the new image; `male` retains the original; `unknown` and
`not_recorded` retain the generic original with an explicitly generic accessible
description. No name-based inference, measurement mutation or risk score.
These are visual illustrations, not sex-specific diagnostic/anatomical models.

Final edit prompt:

> Edit this generic anatomical illustration into its clearly female adult counterpart for a medical patient dashboard. Preserve the same full-body frontal stance, complete head hands feet, centered 2:3 portrait composition, arms slightly separated, pale pearl blue translucent glasslike 3D surface, visible skeleton rib cage spine heart and delicate nerve lines. Change body proportions and facial structure to a natural adult female anatomical model: narrower shoulders, wider female pelvis, natural waist and modest smooth female chest contour. Educational nonsexual anatomy, smooth shell, no explicit genitals or nipples, no hair needed. No text, numbers, labels, risk colors, disease marks, UI or watermark. Fully transparent background, no opaque black background and no exterior glow haze. Do not change the pose or scale. A generic illustrative female model, not a patient scan. Deliver one full-resolution PNG with alpha.

## Generation prompt

Use case: stylized-concept. Asset type: transparent anatomical body illustration
for ORION Clinic patient dashboard, with real data overlays added later in code.
Create a single full-length adult human anatomical silhouette in a calm premium
clinical 3D visualization style. Front view, centered, complete head hands and feet,
arms slightly separated from torso, balanced realistic human proportions,
nonsexual neutral smooth body shell. Translucent pale pearl-gray glasslike surface
with subtle cool teal tint, anatomically plausible skeleton/rib cage/spine and
softly visible lungs/heart, delicate thin neural lines, no cutaway gore. Show
volume, soft realistic shaded contours and dimensional highlights; not a flat icon
or line drawing. Fits a slender tall portrait composition with modest transparent
margin. High clarity at about 300px tall on a web app, muted enough that separate
overlay labels remain readable. No labels, numbers, text, medical risk marks,
glowing disease spots, UI, background, floor shadow, watermark. Actual transparent
alpha. Generic illustration not individual scan.
