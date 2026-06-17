import { writeFileSync, mkdirSync } from "fs";
import { resolve } from "path";
import { deflateRawSync } from "zlib";

const iconsDir = resolve("src-tauri", "icons");
mkdirSync(iconsDir, { recursive: true });

function createPNG(width, height, r, g, b) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width, height, bit_depth=8, color_type=2(RGB), compression=0, filter=0, interlace=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = makeChunk("IHDR", ihdrData);

  // Raw pixel data: each scanline = 1 filter byte + 3*width bytes
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3);
    rawData[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 3;
      rawData[px] = r;
      rawData[px + 1] = g;
      rawData[px + 2] = b;
    }
  }

  const idat = makeChunk("IDAT", deflateRawSync(rawData));
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeBytes = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBytes, data]);
  const crc = crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc);
  return Buffer.concat([length, typeBytes, data, crcBuf]);
}

// CRC32 implementation (built-in, no external deps)
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Generate icons: blue-purple gradient approximation
const sizes = [32, 128, 256];
for (const size of sizes) {
  const png = createPNG(size, size, 0x25, 0x63, 0xeb);
  writeFileSync(resolve(iconsDir, `${size}x${size}.png`), png);
}

// For @2x (we use same 256px image)
writeFileSync(resolve(iconsDir, `128x128@2x.png`), createPNG(256, 256, 0x25, 0x63, 0xeb));

// ICNS placeholder (macOS) - not needed for Windows dev, create empty
writeFileSync(resolve(iconsDir, "icon.icns"), createPNG(256, 256, 0x25, 0x63, 0xeb));

// ICO: Windows icon
function createICO(size) {
  const pngData = createPNG(size, size, 0x25, 0x63, 0xeb);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(1, 4); // count = 1

  const entry = Buffer.alloc(16);
  entry[0] = size === 256 ? 0 : size; // width
  entry[1] = size === 256 ? 0 : size; // height
  entry[2] = 0; // colors
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngData.length, 8); // size of image data
  entry.writeUInt32LE(22, 12); // offset (6 + 16 = 22)

  return Buffer.concat([header, entry, pngData]);
}

writeFileSync(resolve(iconsDir, "icon.ico"), createICO(256));

console.log("Icons generated in:", iconsDir);
