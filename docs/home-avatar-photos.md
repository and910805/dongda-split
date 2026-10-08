# Authorized homepage avatar photos

The user explicitly confirmed permission to use the member photos in the public homepage demo on 2026-10-08. Four small, real-photo crops were extracted from the user-supplied ledger screenshot. No faces were generated, no external stock photos were substituted, and the full private-ledger screenshot was not added to the repository.

Only the four visible demo-member photos are used: one in the account position, the same one in the member filter, and the original 2 / 4 / 4 participant stacks. These produce 12 visible photo instances. The +10 and +6 count badges are deliberately excluded from the photo layer. Demo names, amounts, participant counts, and all authenticated account data remain unchanged.

## Rendering and maintenance

`HeroPreviewAvatars` uses an inert SVG layer registered to the existing 780x1512 expense-page image. Both layers use a centered contain fit. Coordinates were checked against the real ProductApp with initial and photo avatars; their layout rectangles are identical. The image fingerprint is checked in tests so a future regenerated capture cannot silently move the avatars.

The four 38x38 crops contain no EXIF or XMP metadata. Their verified WebP bytes are bundled once in `src/hero-ledger-avatar-photos.json` and reused; there are no third-party requests, account IDs, real names, or additional font files. They are suitable for these small avatar positions, not for enlarged portrait displays.

The original base capture and its synthetic fixture remain unchanged. References to synthetic data in `home-ledger-preview.md` describe that base; the composed public preview now has the authorized photo layer and alternative text explicitly distinguishes real photos from illustrative names and accounts.

If the base capture is regenerated, remeasure its avatar and count-badge bounds, update the source fingerprint in the component and unit test, and inspect the seven homepage widths and both image-failure cases. Do not publish a complete private account capture to refresh these thumbnails.
