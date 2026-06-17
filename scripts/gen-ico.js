import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const iconsDir = resolve("src-tauri", "icons");

// Read existing 32x32 PNG
const pngData = readFileSync(resolve(iconsDir, "32x32.png"));

// ICO header (6 bytes)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);   // reserved
header.writeUInt16LE(1, 2);   // type: ICO (1=cur, 2=ico)
header.writeUInt16LE(1, 4);   // count: 1 image

// ICO directory entry (16 bytes)
const entry = Buffer.alloc(16);
entry[0] = 32;                // width
entry[1] = 32;                // height
entry[2] = 0;                 // colors
entry[3] = 0;                 // reserved
entry.writeUInt16LE(1, 4);    // color planes
entry.writeUInt16LE(32, 6);   // bits per pixel
entry.writeUInt32LE(pngData.length, 8);  // image size
entry.writeUInt32LE(22, 12);  // image offset (6 + 16 = 22)

const ico = Buffer.concat([header, entry, pngData]);
writeFileSync(resolve(iconsDir, "icon.ico"), ico);

console.log("icon.ico generated successfully!");
