# Attribution

This repository contains original code plus work derived from or inspired by third-party projects and assets.

## Engine / UI provenance

### pixel-agents

`agent-office` used `pixel-agents` as a real upstream source during development, not just as loose inspiration.

Upstream:
- <https://github.com/pablodelucca/pixel-agents>

What that means in practice:
- the project began with a validation spike against `pixel-agents`
- later planning explicitly called for extracting/copying/adapting office-engine modules from that upstream codebase
- parts of `ui/src/office/` were then adapted from extracted modules, file structure, and rendering logic originating in `pixel-agents`

This repository should not imply that the office engine was created independently from scratch. The honest description is:

- **office engine adapted in part from `pixel-agents`**

That statement is the one that should be used in public attribution.

## Art / asset provenance

The repo ships pixel-art assets under:

- `ui/public/assets/characters`
- `ui/public/assets/floors`
- `ui/public/assets/walls`
- `ui/public/assets/furniture`

The original planning and design docs explicitly referenced:

- LimeZu "Modern tiles_Free"

Those same planning docs also called out non-commercial licensing constraints around the free pack.

Current state:
- this repo includes third-party visual assets used for the office demo experience
- provenance is partially documented in planning docs, but not yet normalized asset-by-asset inside the repo
- for hobby/demo usage, this is acceptable for now
- for commercial use, redistribution at scale, or legal certainty, you should audit and replace these assets with fully verified alternatives

To make that state explicit in the shipped tree, the repo now includes:

- `ui/public/assets/PROVENANCE.md`
- `ui/public/assets/provenance.json`

Those files distinguish:
- bundled third-party art
- generated metadata such as `default-layout.json` and `furniture-manifest.json`

## Code vs asset licensing

The repository code is MIT-licensed via the root `LICENSE` file.

That MIT license does **not** automatically apply to third-party art assets or upstream-derived engine code where separate terms may apply.

When in doubt:
- review upstream licenses
- preserve attribution
- replace assets that are not clearly safe for your intended distribution model

## What still needs hardening

This file is an honest interim attribution record, not the final word.

Future hardening should include:
- asset-by-asset provenance notes
- explicit copies or links to third-party license texts where required
- clearer separation between repo-owned code and third-party bundled assets
