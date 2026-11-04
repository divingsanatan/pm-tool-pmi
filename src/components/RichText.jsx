import { useEffect, useRef, useState } from 'react';
import { cleanHtml, htmlToText, safeHref, textToHtml } from '../lib/richtext';
import './richtext.css';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* A small rich text box: bold, italic, underline, links and bullet lists.
   - Keyboard: Ctrl/Cmd + B, I, U for formatting, Ctrl/Cmd + K for a link. Ctrl/Cmd + click opens a link (on a Mac, Ctrl + click too).
     Clicking into a link also shows a small bar with Open / Edit / Remove, so a link can be opened with a plain click as well.
   - disabled: the text is read-only (no toolbar) and its links open with a normal click.
   - Smart paste: pasted web addresses become links (or link the selected text), text from Google Docs / Word keeps its bold, italic and links
     but nothing else, and bare addresses you typed are turned into links when you leave the box.
   - Saves when you leave the box. onCommit({ html, text }) gets the cleaned html and a plain-text copy. */
export default function RichText({ html, text, onCommit, placeholder, label, autoFocus, rows = 5, disabled = false }) {
  const wrap = useRef(null);
  const ed = useRef(null);
  const shown = useRef(''); // the cleaned html the box currently holds
  const saved = useRef(null); // last selection inside the box, for the link bar
  const [act, setAct] = useState({});
  const [empty, setEmpty] = useState(true);
  const [link, setLink] = useState(null); // { url, anchor, bad }
  const [mod, setMod] = useState(false); // Ctrl / Cmd held: links show the pointer, because a click now opens them

  const source = () => cleanHtml(html || textToHtml(text || ''));

  // show what is stored; never touch the box while the user is typing in it
  useEffect(() => {
    const el = ed.current;
    if (!el) return;
    const h = source();
    if (h !== shown.current && (document.activeElement !== el || disabled)) {
      el.innerHTML = h;
      shown.current = h;
    }
    setEmpty(htmlToText(h).trim() === '');
  }, [html, text, disabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (autoFocus && ed.current) ed.current.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // keep the toolbar buttons in step with the text under the cursor, and remember the selection
  useEffect(() => {
    const on = () => {
      const s = window.getSelection();
      if (!s || !s.rangeCount || !ed.current || !ed.current.contains(s.anchorNode)) return;
      saved.current = s.getRangeAt(0).cloneRange();
      const q = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };
      const an = anchorAt();
      setAct({ b: q('bold'), i: q('italic'), u: q('underline'), ul: q('insertUnorderedList'), a: !!an, href: an ? an.getAttribute('href') || '' : '' });
    };
    document.addEventListener('selectionchange', on);
    return () => document.removeEventListener('selectionchange', on);
  }, []);

  useEffect(() => {
    const k = (e) => setMod(e.ctrlKey || e.metaKey);
    const off = () => setMod(false);
    window.addEventListener('keydown', k);
    window.addEventListener('keyup', k);
    window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', k); window.removeEventListener('blur', off); };
  }, []);

  const anchorAt = () => {
    const s = window.getSelection();
    let n = s && s.anchorNode;
    while (n && n !== ed.current) {
      if (n.nodeType === 1 && n.tagName === 'A') return n;
      n = n.parentNode;
    }
    return null;
  };

  const exec = (cmd, arg) => {
    ed.current.focus();
    document.execCommand(cmd, false, arg);
    onInput();
  };
  const onInput = () => setEmpty(htmlToText(cleanHtml(ed.current.innerHTML)).trim() === '');

  const commit = () => {
    const el = ed.current;
    if (!el) return;
    const h = cleanHtml(el.innerHTML);
    const t = htmlToText(h);
    const out = t.trim() === '' ? '' : h;
    if (el.innerHTML !== out) el.innerHTML = out;
    setEmpty(out === '');
    if (out !== shown.current) {
      shown.current = out;
      onCommit({ html: out, text: out ? t : '' });
    }
  };
  // save only when focus leaves the whole box (the link bar is part of it)
  const onBlur = (e) => {
    if (wrap.current && wrap.current.contains(e.relatedTarget)) return;
    setLink(null);
    setAct((a) => (a.a ? { ...a, a: false, href: '' } : a));
    commit();
  };

  const openLink = () => {
    const a = anchorAt();
    setLink({ url: a ? a.getAttribute('href') || '' : '', anchor: a, bad: false });
  };
  const applyLink = () => {
    const href = safeHref(link.url);
    if (!href) return setLink({ ...link, bad: true });
    const el = ed.current;
    el.focus();
    const s = window.getSelection();
    if (saved.current) {
      s.removeAllRanges();
      s.addRange(saved.current);
    }
    if (link.anchor && el.contains(link.anchor)) link.anchor.setAttribute('href', href);
    else if (s.isCollapsed) document.execCommand('insertHTML', false, '<a href="' + esc(href) + '">' + esc(link.url.trim()) + '</a>');
    else document.execCommand('createLink', false, href);
    setLink(null);
    onInput();
  };
  const removeLink = () => {
    ed.current.focus();
    if (saved.current) {
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(saved.current);
    }
    document.execCommand('unlink');
    setLink(null);
    onInput();
  };

  const onPaste = (e) => {
    e.preventDefault();
    const plain = e.clipboardData.getData('text/plain') || '';
    const rich = e.clipboardData.getData('text/html');
    const one = plain.trim();
    if (/^(https?:\/\/\S+|www\.\S+)$/i.test(one) && safeHref(one)) {
      const href = safeHref(one);
      if (!window.getSelection().isCollapsed) document.execCommand('createLink', false, href); // pasting an address over selected text links it
      else document.execCommand('insertHTML', false, '<a href="' + esc(href) + '">' + esc(one) + '</a>');
    } else if (rich && cleanHtml(rich)) document.execCommand('insertHTML', false, cleanHtml(rich));
    else document.execCommand('insertText', false, plain);
    onInput();
  };
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLink();
    }
  };
  const openHref = (href) => {
    const h = safeHref(href);
    if (h) window.open(h, '_blank', 'noopener,noreferrer');
  };
  const linkOf = (e) => (e.target && e.target.closest ? e.target.closest('a') : null);
  const onClick = (e) => {
    const a = linkOf(e);
    if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openHref(a.getAttribute('href')); }
  };
  // on a Mac, Ctrl + click arrives as a right click (no click event), so it is handled here
  const onContextMenu = (e) => {
    const a = linkOf(e);
    if (a && e.ctrlKey && /Mac|iPhone|iPad/i.test(navigator.platform || '')) { e.preventDefault(); openHref(a.getAttribute('href')); }
  };

  const Btn = ({ on, title, pressed, children, cls = '' }) => (
    <button type="button" className={'rt-b ' + cls} title={title} aria-label={title} aria-pressed={pressed} onMouseDown={(e) => e.preventDefault()} onClick={on}>{children}</button>
  );

  return (
    <div className={'rt' + (mod ? ' rt-mod' : '') + (disabled ? ' rt-off' : '')} ref={wrap} onBlur={onBlur} style={{ '--rt-rows': rows }}>
      {!disabled && <div className="rt-bar" role="toolbar" aria-label={(label || 'Text') + ' formatting'}>
        <Btn on={() => exec('bold')} title="Bold (Ctrl+B)" pressed={!!act.b}><b>B</b></Btn>
        <Btn on={() => exec('italic')} title="Italic (Ctrl+I)" pressed={!!act.i}><i>I</i></Btn>
        <Btn on={() => exec('underline')} title="Underline (Ctrl+U)" pressed={!!act.u}><u>U</u></Btn>
        <span className="rt-sep" aria-hidden="true" />
        <Btn on={openLink} title="Add or edit a link (Ctrl+K)" pressed={!!act.a} cls="wide">Link</Btn>
        <Btn on={() => exec('insertUnorderedList')} title="Bulleted list" pressed={!!act.ul} cls="wide">• List</Btn>
        <span className="rt-sep" aria-hidden="true" />
        <Btn on={() => exec('removeFormat')} title="Clear formatting" cls="wide">Clear</Btn>
      </div>}
      {!disabled && !link && act.a && act.href && (
        <div className="rt-link rt-open">
          <span className="rt-url" title={act.href}>{act.href}</span>
          <button type="button" className="btn primary" onMouseDown={(e) => e.preventDefault()} onClick={() => openHref(act.href)}>Open link</button>
          <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={openLink}>Edit</button>
          <button type="button" className="btn" onMouseDown={(e) => e.preventDefault()} onClick={removeLink}>Remove link</button>
        </div>
      )}
      {link && (
        <div className="rt-link">
          <input
            className={'c' + (link.bad ? ' bad' : '')}
            autoFocus
            placeholder="Paste or type a web address, e.g. example.com"
            aria-label="Link address"
            value={link.url}
            onChange={(e) => setLink({ ...link, url: e.target.value, bad: false })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') { e.stopPropagation(); setLink(null); ed.current.focus(); }
            }}
          />
          <button type="button" className="btn primary" onClick={applyLink}>{link.anchor ? 'Update' : 'Add link'}</button>
          {link.anchor && <button type="button" className="btn" onClick={removeLink}>Remove link</button>}
          <button type="button" className="btn" onClick={() => { setLink(null); ed.current.focus(); }}>Cancel</button>
          {link.bad && <span className="msg rt-err">That does not look like a web address.</span>}
        </div>
      )}
      <div className="rt-area">
        {empty && placeholder && <div className="rt-ph" aria-hidden="true">{placeholder}</div>}
        <div
          ref={ed}
          className="rt-ed"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-disabled={disabled || undefined}
          aria-label={label}
          spellCheck
          onFocus={() => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* not supported */ } }}
          onInput={onInput}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          onClick={onClick}
          onContextMenu={onContextMenu}
        />
      </div>
      {!disabled && <div className="rt-hint">Ctrl+B bold · Ctrl+I italic · Ctrl+U underline · Ctrl+K link · Ctrl/Cmd+click opens a link</div>}
    </div>
  );
}
