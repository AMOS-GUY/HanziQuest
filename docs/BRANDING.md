# Branding

The approved HanziQuest logo artwork lives in `icon design/logo_variation/`. Those files are the
source of truth and are **never edited, redrawn, recoloured or deleted**. The app uses unmodified
copies, made by `npm run brand:icons` (`scripts/generate-icons.ts`).

## What the logo files are

Every variation is a **full-bleed square tile** (40.02 × 40.09 mm, Inkscape SVG, pure vector, no
embedded images): a sky background, a mountain with a flag, a winding path and a 字 tile.

| Suffix    | Meaning                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| `_wBG`    | Complete artwork: snow cap, 字 tile and path are filled white/ivory. **Use these.**                                      |
| no suffix | Same artwork with the white areas left **transparent** (cut-outs). Only usable on a white backdrop; not used in the app. |

Twelve colour themes exist: Emerald (Default), Classic Blue, Sunset, Royal Purple, Forest, Ocean,
Rose, Night, Minimal Light, Minimal Dark, Gradient Modern, Duotone. `icon design/Weixin Image_…png`
is a reference sheet of all twelve, not a UI mockup.

Known file-naming problems in the originals (left as they are; please fix at source if wanted):

- `Rose.png` is an SVG document with a `.png` extension.
- `Roya_Purple.svg` is a typo for `Royal_Purple.svg`.

## Usage in the app

| Purpose                                      | Source file                             | Public copy                                    |
| -------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| **Primary logo** (welcome, auth, nav, admin) | `Emerald(Default)_wBG.svg`              | `public/branding/hanziquest-emerald.svg`       |
| Alternative for light surfaces               | `Minimal_Light_wBG.svg`                 | `public/branding/hanziquest-minimal-light.svg` |
| Alternative for dark surfaces                | `Minimal_Dark_wBG.svg`                  | `public/branding/hanziquest-minimal-dark.svg`  |
| Night / dark theme accent                    | `Night_wBG.svg`                         | `public/branding/hanziquest-night.svg`         |
| Browser favicon                              | `Emerald(Default)_wBG.svg`              | `src/app/icon.svg`                             |
| PWA icons 192/512, Apple touch 180           | `Emerald(Default)_wBG.svg` (rasterised) | `public/icons/*.png`                           |

The Emerald tile has its own mint sky, so it reads well on both the ivory light theme and the
dark-green dark theme; the app currently uses it everywhere.

PNG exports exist only because the PWA manifest and iOS require bitmap icons. Normal web usage
renders the SVG.

No maskable PWA icon is shipped yet: the flag sits at the top edge, outside the maskable safe
zone, so a correct maskable icon needs a padded version approved by the brand owner.

## Rules

- Render through `<Logo />` (`src/components/brand/logo.tsx`), which keeps a 1:1 aspect ratio.
- Corners are rounded to 22 % of the size, matching the app-icon look on the official sheet. No
  other cropping, stretching, filters or recolouring.
- **Minimum size:** 24 px (use 32 px or more where possible; the 字 detail fades below that).
- **Clear space:** at least 25 % of the logo's size on every side, and never on a busy background.
- The word mark ("Hanzi**Quest**", `<Wordmark />`) is text in Nunito Black with "Quest" in the
  primary colour. It is not part of the SVG artwork.

## Colour palette

| Token           | Hex       | Use                                                                   |
| --------------- | --------- | --------------------------------------------------------------------- |
| Primary emerald | `#087F70` | Primary actions, links, active states (light theme)                   |
| Secondary mint  | `#55CDB5` | Focus ring, primary in dark theme, highlights                         |
| Deep forest     | `#075B4D` | Hover / pressed primary, button depth shadow                          |
| Warm ivory      | `#FFF8E9` | App background (light theme)                                          |
| Coral           | `#F04438` | Brand accent (the flag). Errors use the darker `#C4281D` for contrast |
| Charcoal        | `#18332F` | Body text (light theme)                                               |

Contrast checks: emerald on white is about 4.9:1 and on ivory about 4.6:1 (AA for normal text);
charcoal on ivory is above 12:1.

Tokens are defined once in `src/app/globals.css`. Components use semantic tokens
(`bg-primary`, `text-muted-foreground`, …) so dark mode switches automatically.

## Typography

- UI: **Nunito** (Google Fonts, self-hosted by `next/font`).
- Chinese: **Noto Sans SC**, falling back to PingFang SC, Hiragino Sans GB, Microsoft YaHei and
  Noto Sans CJK SC. Mark Chinese text with `lang="zh"` or the `.hanzi` class.
