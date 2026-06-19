/**
 * 框架级文档解析器
 * 统一处理各种文件格式，提取文本内容供模型使用
 */
import type { FileAttachment } from "../types";

// ── 文本文件（.txt, .md, 代码等） ──────────────
async function parseText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// ── .docx 解析（使用 mammoth） ──────────────────
async function parseDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}

// ── .pdf 解析（使用 pdfjs-dist） ────────────────
async function parsePdf(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist");
  // 动态设置 worker（使用 CDN 兜底以确保稳定加载）
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    const version = (pdfjsLib as any).version || "4.0.379";
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${version}/pdf.worker.min.mjs`;
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.filter((item) => "str" in item).map((item) => (item as { str: string }).str).join(" ");
    pages.push(text);
  }
  return pages.join("\n\n").trim();
}

// ── 文件扩展名 → 解析器路由 ─────────────────────
const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".json", ".xml", ".yaml", ".yml", ".csv", ".tsv",
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".mts", ".cts",
  ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".hpp",
  ".css", ".scss", ".less", ".html", ".htm", ".php", ".sh", ".bash",
  ".zsh", ".bat", ".cmd", ".ps1", ".sql", ".r", ".swift", ".kt",
  ".scala", ".vue", ".svelte", ".astro",
  ".toml", ".ini", ".cfg", ".conf", ".env",
  ".gitignore", ".dockerfile", ".editorconfig",
  ".log", ".diff", ".patch", ".tex", ".latex",
  ".pl", ".pm", ".lua", ".dart", ".groovy", ".gradle",
  ".makefile", ".cmake", ".yml", ".yaml",
]);

// .doc（旧版 Word 二进制格式）暂无纯前端方案，跳过

/** 根据文件名/扩展名判断解析方式并提取文本 */
export async function parseFileContent(file: File): Promise<string> {
  const name = file.name.toLowerCase();

  // 获取扩展名（含点号）
  const dotIdx = name.lastIndexOf(".");
  const ext = dotIdx >= 0 ? name.slice(dotIdx) : "";

  if (TEXT_EXTENSIONS.has(ext)) {
    return parseText(file);
  }

  if (ext === ".docx") {
    return parseDocx(file);
  }

  if (ext === ".pdf") {
    return parsePdf(file);
  }

  // 如果 MIME 类型是 text/* 也尝试按文本读取
  if (file.type.startsWith("text/")) {
    return parseText(file);
  }

  // 未知格式：尝试按文本读取作为兜底
  try {
    return await parseText(file);
  } catch {
    throw new Error(`不支持的文件格式: ${ext || name}`);
  }
}

/** 将 File 对象转换为 FileAttachment（包含解析后的文本内容） */
export async function fileToAttachment(file: File): Promise<FileAttachment> {
  const isImage = file.type.startsWith("image/");
  let data: string;

  if (isImage) {
    data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  } else {
    data = await parseFileContent(file);
  }

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    data,
    isImage,
  };
}
