// 평평한(key: value 한 단계) 프론트매터만 다룬다. 위키 형식이 그렇게 정해져 있다.

export type Frontmatter = Record<string, string>;

const FM = /^---\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

export function parseFrontmatter(text: string): { data: Frontmatter; body: string } | null {
  const src = text.replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  const m = FM.exec(src);
  if (!m) return null;
  const data: Frontmatter = {};
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf(":");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let value = t.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    data[key] = value;
  }
  return { data, body: src.slice(m[0].length) };
}

export function stringifyFrontmatter(data: Record<string, string | number | undefined>, body = ""): string {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}` : ""}`;
}
