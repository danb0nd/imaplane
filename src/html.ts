import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  ...sanitizeHtml.defaults.allowedTags,
  "img",
  "h1",
  "h2",
  "picture",
  "figure",
  "figcaption",
];

export function sanitizeMessageHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  const cleaned = sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "width", "height"],
      a: ["href", "name", "target", "rel"],
      td: ["colspan", "rowspan", "align"],
      th: ["colspan", "rowspan", "align"],
      table: ["role"],
    },
    allowedSchemes: ["http", "https", "mailto", "cid"],
    allowProtocolRelative: false,
  }).trim();
  return cleaned.length ? cleaned : null;
}

export function htmlToPlain(html: string | null | undefined): string | null {
  if (!html) return null;
  const text = sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} })
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length ? text : null;
}
