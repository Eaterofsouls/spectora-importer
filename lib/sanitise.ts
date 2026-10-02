/**
 * lib/sanitise.ts
 *
 * Server-safe HTML sanitiser for comment_text.
 * Uses sanitize-html (CJS, works in Node + browser via webpack/turbopack).
 *
 * Policy: allow everything Spectora's Froala editor produces;
 * strip everything that can run code or break layout.
 *
 * Gap fix: previously we used dangerouslySetInnerHTML with zero sanitisation.
 * A malicious .xls with <script>alert(1)</script> would execute in the browser.
 * Now every render path calls sanitiseHtml() before touching the DOM.
 */

import sanitizeHtml from "sanitize-html";

// Allowlist of tags Froala can produce
const ALLOWED_TAGS = [
  // Text formatting
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "span",
  // Headings
  "h1", "h2", "h3", "h4",
  // Lists
  "ul", "ol", "li",
  // Links and images
  "a", "img",
  // Tables (Froala produces merged cells, coloured headers, etc.)
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  // Block
  "div", "blockquote", "pre", "code",
  // Media embeds (YouTube / Vimeo)
  "iframe",
];

const ALLOWED_SCHEMES = ["https", "http", "mailto"];

const SANITISE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    "*": ["class", "style"],
    "a": ["href", "target", "rel", "title"],
    "img": ["src", "alt", "width", "height"],
    "table": ["cellpadding", "cellspacing", "border"],
    "td": ["colspan", "rowspan"],
    "th": ["colspan", "rowspan"],
    "iframe": ["src", "width", "height", "allowfullscreen", "frameborder"],
  },
  allowedSchemes: ALLOWED_SCHEMES,
  // Force all links to open safely
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        rel: "noopener noreferrer",
        target: attribs.target ?? "_blank",
      },
    }),
    // Restrict iframe src to YouTube/Vimeo only
    iframe: (tagName, attribs) => {
      const src = attribs.src ?? "";
      if (
        src.startsWith("https://www.youtube.com/") ||
        src.startsWith("https://player.vimeo.com/")
      ) {
        return { tagName, attribs };
      }
      // Strip disallowed iframe
      return { tagName: "p", attribs: {}, text: "" };
    },
  },
};

/**
 * Sanitise HTML comment text before display.
 * Returns empty string for null/undefined.
 */
export function sanitiseHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return sanitizeHtml(raw, SANITISE_OPTIONS);
}

/**
 * Check if sanitised output differs from raw (i.e. something was stripped).
 * Used in import report to flag markup that will be held back at display time.
 */
export function hasStrippedMarkup(raw: string | null): boolean {
  if (!raw) return false;
  const sanitised = sanitiseHtml(raw);
  return sanitised !== raw;
}
