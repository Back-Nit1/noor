# Sample scans for the imaging reveal

Drop a study here as `<studyId>.png` — the demo study is `demo-pelvic-mri-1.png`.
`app/intake/ScanViewer.tsx` picks it up automatically and draws the flagged regions
over it. With no file present it falls back to a clearly-labelled schematic, so the
demo never breaks on a missing asset.

## Do not commit research-licensed imaging

**GLENDA** — what the classifier in `radiomics/` was trained on — is licensed for
**scientific research only**. It must not be committed here or shown in a public
demo, and neither may UT-EndoMRI (non-commercial research).

Use a licence-clear source instead. Per `docs/DATASET_CATALOG.md`, the
**Uterine Myoma MRI Dataset (UMD)** is **CC BY 4.0** and is the recommended choice
for anything public-facing. Attribute it wherever the image is displayed.

Note that UMD is fibroid data, not endometriosis data — it is a licence-clear
*canvas* for the viewer, not evidence of an endometriosis finding. Keep the
on-screen framing as "regions flagged for radiologist review."

Downloaded datasets live in `.datasets/` (gitignored) via `scripts/fetch-datasets.mjs`.
