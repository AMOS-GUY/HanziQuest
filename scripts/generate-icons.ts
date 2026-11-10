/**
 * Copies the approved logo SVGs into public/branding (originals in "icon design/" are never modified)
 * and generates the PNG exports that platforms require (PWA manifest icons, Apple touch icon).
 * Run with: npm run brand:icons
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE_DIR = path.resolve("icon design/logo_variation");
const BRAND_DIR = path.resolve("public/branding");
const ICON_DIR = path.resolve("public/icons");

/** public file name → original asset. See docs/BRANDING.md. */
const COPIES: Record<string, string> = {
  "hanziquest-emerald.svg": "Emerald(Default)_wBG.svg",
  "hanziquest-minimal-light.svg": "Minimal_Light_wBG.svg",
  "hanziquest-minimal-dark.svg": "Minimal_Dark_wBG.svg",
  "hanziquest-night.svg": "Night_wBG.svg",
};

const PRIMARY = "Emerald(Default)_wBG.svg";
const PNG_SIZES: Record<string, number> = {
  "icon-192.png": 192,
  "icon-512.png": 512,
  "apple-touch-icon.png": 180,
};

async function main() {
  fs.mkdirSync(BRAND_DIR, { recursive: true });
  fs.mkdirSync(ICON_DIR, { recursive: true });

  for (const [target, source] of Object.entries(COPIES)) {
    fs.copyFileSync(path.join(SOURCE_DIR, source), path.join(BRAND_DIR, target));
    console.log(`copied ${source} -> public/branding/${target}`);
  }

  // Favicon via the App Router file convention.
  fs.copyFileSync(path.join(SOURCE_DIR, PRIMARY), path.resolve("src/app/icon.svg"));
  console.log(`copied ${PRIMARY} -> src/app/icon.svg`);

  for (const [file, size] of Object.entries(PNG_SIZES)) {
    // The artwork is square (40.02 x 40.09 mm); "contain" preserves its proportions exactly.
    await sharp(path.join(SOURCE_DIR, PRIMARY), { density: Math.ceil((size / 151) * 96 * 1.5) })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(ICON_DIR, file));
    console.log(`rendered public/icons/${file} (${size}px)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
