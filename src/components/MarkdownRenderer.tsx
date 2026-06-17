import { useMemo } from "react";
import { marked, type Tokens } from "marked";

interface Props {
  content: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── LaTeX inline math extension ($...$) ──
const inlineMathExtension: any = {
  name: "mathInline",
  level: "inline",
  start(src: string) {
    const idx = src.indexOf("$");
    return idx >= 0 && src[idx + 1] !== "$" ? idx : -1;
  },
  tokenizer(this: any, src: string) {
    const match = src.match(/^\$([^\n$]+?)\$/);
    if (match) {
      return {
        type: "mathInline",
        raw: match[0],
        text: match[1].trim(),
      };
    }
  },
  renderer({ text }: any): string {
    return `<span style="font-style:italic;color:#a78bfa;font-family:'Cambria Math','Times New Roman',serif;padding:0 2px">${escapeHtml(text)}</span>`;
  },
};

// ── LaTeX block math extension ($$...$$) ──
const blockMathExtension: any = {
  name: "mathBlock",
  level: "inline",
  start(src: string) {
    return src.indexOf("$$");
  },
  tokenizer(this: any, src: string) {
    const match = src.match(/^\$\$([\s\S]*?)\$\$/);
    if (match) {
      return {
        type: "mathBlock",
        raw: match[0],
        text: match[1].trim(),
      };
    }
  },
  renderer({ text }: any): string {
    return `<div style="background:#151518;border:1px solid #3a3a3e;border-radius:8px;padding:12px 16px;margin:8px 0;overflow-x:auto;text-align:center;font-style:italic;color:#a78bfa;font-family:'Cambria Math','Times New Roman',serif;font-size:15px;line-height:1.6">${escapeHtml(text)}</div>`;
  },
};

// Override renderer to produce React-compatible HTML
marked.use({
  extensions: [inlineMathExtension, blockMathExtension],
  renderer: {
    code(this: any, { text, lang }: Tokens.Code): string {
      const langAttr = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
      return `<pre style="background:#161618;border:1px solid #2a2a2e;border-radius:8px;padding:14px 16px;overflow-x:auto;margin:8px 0"><code${langAttr} style="font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;font-size:13px;line-height:1.6;color:#d4d4d8">${escapeHtml(text)}</code></pre>`;
    },
    codespan({ text }: Tokens.Codespan): string {
      return `<code style="background:#1a1a1e;border:1px solid #2a2a2e;border-radius:4px;padding:1px 5px;font-size:13px;font-family:'Cascadia Code','Fira Code','JetBrains Mono',monospace;color:#22c55e">${escapeHtml(text)}</code>`;
    },
    link(this: any, { href, tokens }: Tokens.Link): string {
      const inner = this.parser.parseInline(tokens);
      return `<a href="${escapeHtml(href || "")}" target="_blank" rel="noopener noreferrer" style="color:#60a5fa;text-decoration:none;border-bottom:1px solid rgba(96,165,250,0.3)">${inner}</a>`;
    },
    image({ href, text }: Tokens.Image): string {
      return `<img src="${escapeHtml(href || "")}" alt="${escapeHtml(text)}" style="max-width:100%;border-radius:8px;margin:8px 0" />`;
    },
    blockquote(this: any, { tokens }: Tokens.Blockquote): string {
      const inner = this.parser.parse(tokens);
      return `<blockquote style="border-left:3px solid #3a3a3e;margin:8px 0;padding:4px 16px;color:#8a8a8e">${inner}</blockquote>`;
    },
    hr(): string {
      return `<hr style="border:none;border-top:1px solid #2a2a2e;margin:16px 0" />`;
    },
    table(this: any, { header, rows }: Tokens.Table): string {
      const headers = header.map((cell: any) =>
        `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #3a3a3e;font-weight:600;color:#a0a0a0;white-space:nowrap">${this.parser.parseInline(cell.tokens)}</th>`,
      ).join("");
      const bodies = rows.map((row: any) =>
        `<tr>${row.map((cell: any) => `<td style="padding:8px 12px;border-bottom:1px solid #2a2a2e;color:#d4d4d8">${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`,
      ).join("");
      return `<div style="overflow-x:auto;margin:8px 0"><table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>${headers}</tr></thead><tbody>${bodies}</tbody></table></div>`;
    },
    heading(this: any, { tokens, depth }: Tokens.Heading): string {
      const inner = this.parser.parseInline(tokens);
      const sizes: Record<number, string> = {
        1: "22px",
        2: "18px",
        3: "16px",
        4: "15px",
        5: "14px",
        6: "13px",
      };
      const size = sizes[depth] || "14px";
      const m = depth <= 2 ? "16px 0 8px" : "12px 0 6px";
      return `<h${depth} style="font-size:${size};font-weight:700;color:#e0e0e0;margin:${m};line-height:1.5">${inner}</h${depth}>`;
    },
    listitem(this: any, { tokens, task, checked }: Tokens.ListItem): string {
      const inner = this.parser.parse(tokens);
      if (task) {
        const cb = checked ? "☑" : "☐";
        return `<li style="margin:4px 0;color:#d4d4d8;list-style:none">${cb} ${inner}</li>`;
      }
      return `<li style="margin:4px 0;color:#d4d4d8">${inner}</li>`;
    },
    paragraph(this: any, { tokens }: Tokens.Paragraph): string {
      const inner = this.parser.parseInline(tokens);
      return `<p style="margin:8px 0;color:#d4d4d8;line-height:1.7">${inner}</p>`;
    },
    strong(this: any, { tokens }: Tokens.Strong): string {
      const inner = this.parser.parseInline(tokens);
      return `<strong style="font-weight:700;color:#e0e0e0">${inner}</strong>`;
    },
    em(this: any, { tokens }: Tokens.Em): string {
      const inner = this.parser.parseInline(tokens);
      return `<em style="font-style:italic;color:#d4d4d8">${inner}</em>`;
    },
    del(this: any, { tokens }: Tokens.Del): string {
      const inner = this.parser.parseInline(tokens);
      return `<del style="color:#6a6a6e">${inner}</del>`;
    },
  } as any,
});

export default function MarkdownRenderer({ content }: Props) {
  const html = useMemo(() => {
    try {
      const result = marked.parse(content, { breaks: true, async: false });
      return typeof result === "string" ? result : "";
    } catch {
      // Fallback: escape and display raw
      return escapeHtml(content);
    }
  }, [content]);

  return (
    <div
      className="markdown-body"
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        fontSize: "14px",
        lineHeight: 1.7,
        color: "#d4d4d8",
        wordBreak: "break-word",
      }}
    />
  );
}
