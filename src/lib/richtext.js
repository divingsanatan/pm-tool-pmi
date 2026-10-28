/* Small, safe rich text for descriptions: bold, italic, underline, links, bullet / numbered lists and paragraphs.
   The editor stores the cleaned HTML next to a plain-text copy (the plain text is what lists, change requests and the activity log show).
   Everything that comes in (typing, paste, saved data) goes through cleanHtml, which keeps only the tags above, only http(s) / mailto links,
   and no attributes except href, so pasted or stored content can never run script or carry styles with it. */

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// A usable link target, or null. "example.com/page" becomes https://example.com/page; javascript:, data: etc. are refused.
export function safeHref(raw) {
  const h = (raw || '').trim();
  if (!h || /\s/.test(h)) return null;
  if (/^(https?:\/\/|mailto:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null;
  if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(h)) return 'mailto:' + h;
  if (/^[^\s@/]+\.[a-z]{2,}([/?#:].*)?$/i.test(h)) return 'https://' + h;
  return null;
}

const URL_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+)/gi;
// bare web addresses in typed text become links (trailing punctuation stays outside the link)
function linkText(text) {
  let out = '', last = 0, m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    let url = m[0], tail = '';
    const t = url.match(/[.,;:!?)\]'"]+$/);
    if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
    const href = safeHref(url);
    out += esc(text.slice(last, m.index));
    out += href ? '<a href="' + esc(href) + '">' + esc(url) + '</a>' + esc(tail) : esc(m[0]);
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK']); // never kept, text inside included
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'TR', 'TABLE', 'TBODY', 'THEAD']);

// inline content of a node: text, bold / italic / underline, links, line breaks
function inline(node, inA) {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { out += inA ? esc(c.nodeValue) : linkText(c.nodeValue); return; }
    if (c.nodeType !== 1) return;
    const tag = c.tagName;
    if (SKIP.has(tag)) return;
    if (tag === 'BR') { out += '<br>'; return; }
    let inner = inline(c, inA || tag === 'A');
    if (tag === 'A') {
      const href = safeHref(c.getAttribute('href'));
      out += href && inner ? '<a href="' + esc(href) + '">' + inner + '</a>' : inner;
      return;
    }
    if (!inner) return;
    const st = (c.getAttribute('style') || '').toLowerCase(); // Google Docs / Word paste formatting through spans
    if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(st)) inner = '<b>' + inner + '</b>';
    if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(st)) inner = '<i>' + inner + '</i>';
    if (tag === 'U' || /text-decoration[^;]*underline/.test(st)) inner = '<u>' + inner + '</u>';
    out += (BLOCK.has(tag) || tag === 'LI') && out ? '<br>' + inner : inner;
  });
  return out;
}

function collect(node, out) {
  let run = '';
  const flush = () => { if (run.trim() !== '') out.push('<p>' + run + '</p>'); run = ''; };
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) { run += linkText(c.nodeValue); return; }
    if (c.nodeType !== 1) return;
    const tag = c.tagName;
    if (SKIP.has(tag)) return;
    if (tag === 'UL' || tag === 'OL') {
      flush();
      const items = Array.from(c.children).filter((x) => x.tagName === 'LI').map((li) => inline(li, false)).filter((x) => x.trim() !== '');
      if (items.length) out.push('<' + tag.toLowerCase() + '>' + items.map((x) => '<li>' + x + '</li>').join('') + '</' + tag.toLowerCase() + '>');
    } else if (BLOCK.has(tag)) {
      flush();
      const sub = [];
      collect(c, sub);
      if (sub.length) out.push(...sub);
      else if (c.querySelector('br')) out.push('<p><br></p>'); // a blank line the user typed
    } else {
      run += inline({ childNodes: [c] }, false);
    }
  });
  flush();
}

export function cleanHtml(html) {
  if (!html || typeof DOMParser === 'undefined') return '';
  const body = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body;
  const out = [];
  collect(body, out);
  while (out.length && out[0] === '<p><br></p>') out.shift();
  while (out.length && out[out.length - 1] === '<p><br></p>') out.pop();
  return out.join('').replace(/<a href=/g, '<a target="_blank" rel="noopener noreferrer" href=');
}

// plain text (typed before rich text existed, or from the old field) as paragraphs
export const textToHtml = (t) => (t || '').split(/\r?\n/).map((l) => (l.trim() ? '<p>' + linkText(l) + '</p>' : '<p><br></p>')).join('');

// plain text copy of cleaned html: one line per paragraph, bullets as "• "
export function htmlToText(html) {
  if (!html || typeof DOMParser === 'undefined') return '';
  const body = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html').body;
  const lines = [];
  const text = (n) => (n.nodeType === 3 ? n.nodeValue : n.tagName === 'BR' ? '\n' : Array.from(n.childNodes).map(text).join(''));
  body.childNodes.forEach((b) => {
    if (b.nodeType !== 1) return;
    if (b.tagName === 'UL' || b.tagName === 'OL') Array.from(b.children).forEach((li, k) => lines.push((b.tagName === 'OL' ? k + 1 + '. ' : '• ') + text(li)));
    else lines.push(text(b));
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
