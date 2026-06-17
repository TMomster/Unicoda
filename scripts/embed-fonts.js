/**
 * Script: embed-fonts.js
 * 
 * Downloads font files from CDN, base64-encodes them,
 * and generates src/fonts.css with inline data URIs.
 * 
 * This ensures font data is compiled into the frontend bundle
 * and ultimately embedded inside unison.exe by Tauri.
 */

import https from "https";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Google Fonts CSS URLs – we fetch them to extract actual woff2 file URLs */
const GOOGLE_FONTS_CSS = [
  "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap",

];

/** Direct font URLs (non-Google) */
const DIRECT_FONTS = [
  {
    family: "Smiley Sans",
    weight: "normal",
    style: "normal",
    url: "https://cdn.jsdelivr.net/npm/smiley-sans@latest/dist/webfont/SmileySans-Oblique.otf.woff2",
  },
  {
    family: "Maple Mono",
    weight: "normal",
    style: "normal",
    url: "https://cdn.jsdelivr.net/npm/maple-font@latest/dist/MapleMono-Regular.woff2",
  },
  {
    family: "Maple Mono",
    weight: "bold",
    style: "normal",
    url: "https://cdn.jsdelivr.net/npm/maple-font@latest/dist/MapleMono-Bold.woff2",
  },
  {
    family: "Maple Mono",
    weight: "normal",
    style: "italic",
    url: "https://cdn.jsdelivr.net/npm/maple-font@latest/dist/MapleMono-Italic.woff2",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const opts = {
      headers: {
        // Request woff2 format from Google Fonts
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    };
    mod
      .get(url, opts, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location, url).href;
          fetchUrl(redirectUrl).then(resolve).catch(reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      })
      .on("error", reject);
  });
}

/**
 * Parse a Google Fonts CSS response into an array of font-face descriptors.
 * Each descriptor: { family, url, weight, style }
 */
function parseGoogleFontsCSS(cssText, baseUrl) {
  const faces = [];
  // Match each @font-face block
  const blockRe = /@font-face\s*\{([^}]+)\}/gi;
  let match;
  while ((match = blockRe.exec(cssText)) !== null) {
    const block = match[1];
    const family = extractCSSValue(block, "font-family");
    const weight = extractCSSValue(block, "font-weight") || "normal";
    const style = extractCSSValue(block, "font-style") || "normal";
    const srcMatch = block.match(/src:\s*url\(([^)]+)\)/i);
    if (!family || !srcMatch) continue;
    const url = srcMatch[1].replace(/['"]/g, "");
    // Resolve relative URLs
    const resolved = url.startsWith("http") ? url : new URL(url, baseUrl).href;
    faces.push({ family: family.replace(/['"]/g, ""), url: resolved, weight, style });
  }
  return faces;
}

function extractCSSValue(block, prop) {
  const re = new RegExp(`${prop}\\s*:\\s*['"]?([^;'"]+)['"]?\\s*;`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function toBase64(buffer) {
  return buffer.toString("base64");
}

const FORMAT_HINTS = {
  ".woff2": "woff2",
  ".woff": "woff",
  ".ttf": "truetype",
  ".otf": "opentype",
};

function detectFormat(url) {
  const key = Object.keys(FORMAT_HINTS).find((ext) => url.includes(ext));
  return key ? FORMAT_HINTS[key] : "woff2";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Fetching Google Fonts CSS to discover font file URLs…");
  const allFaces = [];

  // 1. Fetch Google Fonts CSS and parse
  for (const cssUrl of GOOGLE_FONTS_CSS) {
    try {
      const cssBuf = await fetchUrl(cssUrl);
      const cssText = cssBuf.toString("utf-8");
      const faces = parseGoogleFontsCSS(cssText, cssUrl);
      allFaces.push(...faces);
      console.log(`  ✓ ${cssUrl.split("?")[0]} → ${faces.length} @font-face(s)`);
    } catch (err) {
      console.error(`  ✗ Failed to fetch ${cssUrl}: ${err.message}`);
    }
  }

  // 2. Add direct fonts
  for (const df of DIRECT_FONTS) {
    allFaces.push({
      family: df.family,
      url: df.url,
      weight: df.weight,
      style: df.style,
    });
    console.log(`  + Direct: ${df.family} (${df.weight} ${df.style})`);
  }

  if (allFaces.length === 0) {
    console.error("❌ No font faces discovered. Aborting.");
    process.exit(1);
  }

  // 3. Download each font file and base64 encode
  console.log("\n📦 Downloading font files & generating embedded CSS…");
  let cssOutput = `/* Auto-generated by scripts/embed-fonts.js — do not edit manually */\n`;
  cssOutput += `/* All font data is base64-embedded for offline use */\n\n`;

  let successCount = 0;
  for (const face of allFaces) {
    try {
      const buf = await fetchUrl(face.url);
      const b64 = toBase64(buf);
      const fmt = detectFormat(face.url);
      const dataUri = `data:font/${fmt};base64,${b64}`;

      cssOutput += `@font-face {\n`;
      cssOutput += `  font-family: '${face.family}';\n`;
      cssOutput += `  src: url('${dataUri}') format('${fmt}');\n`;
      cssOutput += `  font-weight: ${face.weight};\n`;
      cssOutput += `  font-style: ${face.style};\n`;
      cssOutput += `  font-display: swap;\n`;
      cssOutput += `}\n\n`;

      successCount++;
      const sizeKb = (buf.length / 1024).toFixed(1);
      console.log(`  ✓ ${face.family} (${face.weight} ${face.style}) — ${sizeKb} KB`);
    } catch (err) {
      console.error(`  ✗ Failed to download ${face.url}: ${err.message}`);
    }
  }

  // 4. Write output file
  const outPath = path.join(PROJECT_ROOT, "src", "fonts.css");
  fs.writeFileSync(outPath, cssOutput, "utf-8");
  console.log(`\n✅ Done! Wrote ${successCount}/${allFaces.length} fonts to ${outPath}`);
  console.log(`   Total CSS size: ${(Buffer.byteLength(cssOutput, "utf-8") / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
  process.exit(1);
});
