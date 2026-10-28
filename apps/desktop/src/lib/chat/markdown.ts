import { Marked } from "marked";

const markedInstance = new Marked({
  gfm: true,
  breaks: true,
  async: false,
});

// Escape raw HTML so arbitrary script/iframe tags are disarmed
markedInstance.use({
  renderer: {
    html({ text }) {
      return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
  },
});

export function renderMarkdown(content: string): string {
  if (!content) return "";
  try {
    return markedInstance.parse(content) as string;
  } catch {
    // Fallback: escaped plain text
    return content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
