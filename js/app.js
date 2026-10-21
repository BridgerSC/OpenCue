/* OpenCue — application controller: script library, editor, playback,
 * settings, remote control and keyboard shortcuts. */
(function () {
  'use strict';

  const { parse } = window.OpenCueParser;
  const Voice = window.OpenCueVoice;
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  // Never run inside another site's frame (clickjacking). GitHub Pages can't send
  // frame-blocking headers, so the page refuses here.
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    throw new Error('OpenCue cannot run inside a frame');
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  // ---------------------------------------------------------------- storage

  const store = {
    load(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch (_) { return fallback; }
    },
    save(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (_) {
        // Storage full or blocked: say so (at most every 30 s) instead of silently losing edits.
        if (Date.now() - (store.warned || 0) > 30000) {
          store.warned = Date.now();
          toast('Couldn’t save. This browser’s storage is full or blocked. Use Backup to keep a copy of your scripts.', 8000, 'error');
        }
      }
    },
  };

  // ---------------------------------------------------------------- dom helpers

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  }

  // ---------------------------------------------------------------- icons

  const ICONS = {
    play: '<path d="M7.5 5.2v13.6a1 1 0 0 0 1.53.85l10.9-6.8a1 1 0 0 0 0-1.7L9.03 4.35A1 1 0 0 0 7.5 5.2z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4.25" height="15" rx="1.25" fill="currentColor" stroke="none"/><rect x="13.75" y="4.5" width="4.25" height="15" rx="1.25" fill="currentColor" stroke="none"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    gauge: '<path d="M12 14l3.5-3.5"/><path d="M3.5 18.5a9.5 9.5 0 1 1 17 0"/><circle cx="12" cy="14" r="1.2" fill="currentColor"/>',
    hand: '<rect x="6.5" y="3" width="11" height="18" rx="5.5"/><path d="M12 7v3.5"/>',
    'chevron-down': '<path d="M6 9l6 6 6-6"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
    layout: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M8.5 4v16M15.5 4v16"/>',
    mirror: '<path d="M12 3v18" stroke-dasharray="2 2.6"/><path d="M8.5 7.5L4 12l4.5 4.5z"/><path d="M15.5 7.5L20 12l-4.5 4.5z"/>',
    fullscreen: '<path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>',
    'fullscreen-exit': '<path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M9 20v-4a1 1 0 0 0-1-1H4M15 20v-4a1 1 0 0 1 1-1h4"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    remote: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><circle cx="12" cy="8" r="2"/><path d="M10 14h4M10 17h4"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
    upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M9 7V4.5h6V7M6 7l1 12.5a1.5 1.5 0 0 0 1.5 1.5h7a1.5 1.5 0 0 0 1.5-1.5L18 7"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    edit: '<path d="M4 20h4L18.5 9.5a2.12 2.12 0 0 0-3-3L5 17v3z"/><path d="M13.5 8.5l3 3"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    text: '<path d="M4 6h16M4 10h11M4 14h16M4 18h9"/>',
    type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
    toggle: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="2.5"/>',
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  }
  function setIcon(el, name) {
    const old = el.querySelector(':scope > svg');
    if (old) old.outerHTML = icon(name);
    else el.insertAdjacentHTML('afterbegin', icon(name));
  }
  $$('[data-icon]').forEach((el) => el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon)));

  // ---------------------------------------------------------------- tooltips

  const tipEl = $('#tooltip');
  let tipTimer = 0, tipFor = null;
  const kbdText = (k) => (IS_MAC ? k.replace(/^Ctrl$/, '⌘') : k);
  function showTip(el) {
    clearTimeout(tipTimer);
    if (!el.isConnected || el.getAttribute('aria-expanded') === 'true' || !el.dataset.tip) return;
    tipFor = el;
    const keys = (el.dataset.kbd || '').split(/[\s+]+/).filter(Boolean);
    tipEl.replaceChildren(h('span', { text: el.dataset.tip }), keys.length ? h('span', { class: 'tip-keys' }, keys.map((k) => h('kbd', { text: kbdText(k) }))) : null);
    tipEl.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8;
    const left = clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8);
    tipEl.style.top = Math.round(top) + 'px';
    tipEl.style.left = Math.round(left) + 'px';
  }
  function hideTip() {
    clearTimeout(tipTimer);
    tipFor = null;
    tipEl.hidden = true;
  }
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const t = e.target instanceof Element && e.target.closest('[data-tip]');
    if (!t || t === tipFor) return;
    hideTip();
    tipTimer = setTimeout(() => showTip(t), 450);
  });
  document.addEventListener('pointerout', (e) => {
    const t = e.target instanceof Element && e.target.closest('[data-tip]');
    if (t && !(e.relatedTarget instanceof Node && t.contains(e.relatedTarget))) hideTip();
  });
  document.addEventListener('focusin', (e) => {
    const t = e.target instanceof Element && e.target.closest('[data-tip]');
    if (t && t.matches(':focus-visible')) showTip(t);
  });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('pointerdown', hideTip, true);
  window.addEventListener('blur', hideTip);

  // ---------------------------------------------------------------- settings

  const VOICE_OK = Voice.supported;
  const LANGS = [
    ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['en-AU', 'English (Australia)'], ['en-CA', 'English (Canada)'],
    ['en-IN', 'English (India)'], ['es-ES', 'Español (España)'], ['es-MX', 'Español (México)'], ['fr-FR', 'Français'],
    ['de-DE', 'Deutsch'], ['it-IT', 'Italiano'], ['pt-BR', 'Português (Brasil)'], ['pt-PT', 'Português (Portugal)'],
    ['nl-NL', 'Nederlands'], ['sv-SE', 'Svenska'], ['da-DK', 'Dansk'], ['nb-NO', 'Norsk'], ['fi-FI', 'Suomi'],
    ['pl-PL', 'Polski'], ['cs-CZ', 'Čeština'], ['ru-RU', 'Русский'], ['uk-UA', 'Українська'], ['tr-TR', 'Türkçe'],
    ['hi-IN', 'हिन्दी'], ['id-ID', 'Bahasa Indonesia'],
  ];
  const navLang = navigator.language || 'en-US';
  if (!LANGS.some(([v]) => v === navLang)) LANGS.unshift([navLang, navLang]);

  const FONTS = {
    sans: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    serif: 'Georgia, Cambria, "Times New Roman", serif',
    wide: 'Verdana, Tahoma, "DejaVu Sans", sans-serif',
    rounded: 'ui-rounded, "SF Pro Rounded", Nunito, "Segoe UI", system-ui, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace',
  };
  const FONT_OPTIONS = [['sans', 'Inter'], ['serif', 'Serif'], ['wide', 'Wide'], ['rounded', 'Round'], ['mono', 'Mono']];
  const LINE_HEIGHTS = [1, 1.15, 1.25, 1.5, 2];
  const MODES = [['voice', 'Voice'], ['auto', 'Auto'], ['manual', 'Manual']];
  const MODE_ICONS = { voice: 'mic', auto: 'gauge', manual: 'hand' };
  const LIMITS = { fontSize: [20, 160], speed: [1, 30], width: [30, 100] };

  const DEFAULTS = {
    v: 2,
    mode: 'auto', // Voice mode sends audio to the browser's speech service, so people opt in (see voiceConsent)
    speed: 5,
    fontSize: 52,
    lineHeight: 1.25,
    width: 60,
    position: 50,
    font: 'sans',
    align: 'left',
    uppercase: false,
    eyeline: 35,
    showEyeline: true,
    eyelineColor: '#818cf8',
    dimRead: true,
    mirrorX: false,
    mirrorY: false,
    fg: '#ffffff',
    bg: '#000000',
    cue: '#ffd166',
    hl: '#7aa2ff',
    countdown: 3,
    lang: navLang,
    showHeard: true,
    voiceScroll: 'lines',  // Voice mode: 'lines' glides line by line, 'continuous' scrolls at your reading pace
    voiceSmooth: 'normal', // how fast the text glides to your line in Voice mode
    voiceLead: 0,          // lines your current line sits above the eyeline in Voice mode
    autoHide: true,
  };
  const VOICE_FOLLOW = { gentle: 4, normal: 8, snappy: 16 }; // easing rate, 1/s; 8 is the tested default

  const storedSettings = store.load('opencue.settings', {}) || {};
  if (!storedSettings.v) {
    // Settings saved before v2 stored the old defaults wholesale; let those pick up the new defaults.
    const OLD = { fontSize: 56, lineHeight: 1.45, width: 80, eyeline: 33 };
    for (const k in OLD) if (storedSettings[k] === OLD[k]) delete storedSettings[k];
  }
  let settings = Object.assign({}, DEFAULTS, storedSettings, { v: DEFAULTS.v });
  if (!VOICE_OK && settings.mode === 'voice') settings.mode = 'auto';
  const saveSettings = () => store.save('opencue.settings', settings);

  const ui = Object.assign({ collapsed: ['shortcuts'] }, store.load('opencue.ui', {}));
  const saveUI = () => store.save('opencue.ui', ui);

  // ---------------------------------------------------------------- scripts

  const WELCOME = `# Welcome
Welcome to OpenCue, a free and open-source teleprompter. [smile]

Press Start at the bottom to try it out. To use your own script, open Scripts at the top left and choose New script, or Edit on any script.

# Voice tracking
In Voice mode, OpenCue listens while you read and scrolls to keep your place. Pause whenever you like and it waits for you. Skip a line and it catches up.

# Auto and manual
Prefer a steady pace? Switch to Auto and use the up and down arrow keys to change the speed. Manual mode lets you, or an operator, scroll with the mouse wheel or the arrow keys.

# Formatting
Blank lines start new paragraphs. [Text in square brackets is a stage direction you see but don't read.] A line that starts with a hash mark becomes a section heading. Wrap words in asterisks for *extra emphasis*.

Good luck with your recording!`;

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const makeScript = (title = '', body = '') => ({ id: uid(), title, body, updated: Date.now() });

  let scripts = store.load('opencue.scripts', null);
  if (!Array.isArray(scripts) || !scripts.length) scripts = [makeScript('Welcome to OpenCue', WELCOME)];
  let currentId = store.load('opencue.current', scripts[0].id);
  if (!scripts.some((s) => s.id === currentId)) currentId = scripts[0].id;
  const current = () => scripts.find((s) => s.id === currentId);

  let saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 300);
  }
  function persistNow() {
    clearTimeout(saveTimer);
    store.save('opencue.scripts', scripts);
    store.save('opencue.current', currentId);
  }
  window.addEventListener('beforeunload', persistNow);

  // ---------------------------------------------------------------- confirm dialog

  const dlg = $('#confirm');
  let confirmResolve = null;
  function settleConfirm(value) {
    const resolve = confirmResolve;
    confirmResolve = null;
    if (resolve) resolve(value);
  }
  // Resolve straight from the buttons (the close event can be delayed), and only ever keep one answer pending.
  $('#confirm-ok').addEventListener('click', () => settleConfirm(true));
  $('#confirm-cancel').addEventListener('click', () => settleConfirm(false));
  dlg.addEventListener('close', () => settleConfirm(dlg.returnValue === 'ok'));
  function confirmDialog({ title, message, confirm = 'Delete', cancel = 'Cancel', danger = true }) {
    settleConfirm(false);
    if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    $('#confirm-title').textContent = title;
    $('#confirm-msg').textContent = message;
    const ok = $('#confirm-ok');
    ok.textContent = confirm;
    ok.className = 'btn ' + (danger ? 'danger' : 'primary');
    $('#confirm-cancel').textContent = cancel;
    dlg.returnValue = '';
    hideTip();
    if (!dlg.open) dlg.showModal();
    $('#confirm-cancel').focus();
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  // ---------------------------------------------------------------- editor

  // The prompter is the home screen. currentId is the script on it; the pop-up
  // editor works on editingId, which can be any script.
  const editorPanel = $('#editor-panel');
  let editingId = null;
  let prompterStale = false; // the on-screen script was edited; reload it when the editor closes
  const editing = () => scripts.find((s) => s.id === editingId);
  const titleInput = $('#script-title');
  const bodyInput = $('#script-body');
  const listEl = $('#script-list');
  const searchInput = $('#script-search');
  const pageEl = $('.page');

  const WPM = 150;
  function fmtDuration(sec) {
    sec = Math.round(sec);
    const m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
  }
  function fmtClock(ms) {
    const sec = Math.floor(ms / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  }
  function relTime(ts) {
    const d = (Date.now() - ts) / 1000;
    if (d < 60) return 'Just now';
    if (d < 3600) return `${Math.floor(d / 60)} min ago`;
    if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
    if (d < 86400 * 7) return `${Math.floor(d / 86400)} d ago`;
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const wcCache = new Map();
  function wordCount(body) {
    if (wcCache.has(body)) return wcCache.get(body);
    const n = parse(body).words.length;
    if (wcCache.size > 200) wcCache.clear();
    wcCache.set(body, n);
    return n;
  }
  const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
  function snippet(body) {
    const line = body.split('\n').map((l) => l.trim()).find((l) => l && !/^#{1,6}\s/.test(l) && l.replace(/\[[^\]]*\]/g, '').trim());
    return line ? line.replace(/\[[^\]]*\]/g, '').replace(/\*/g, '').replace(/\s+/g, ' ').trim() : 'Empty script';
  }

  function renderList() {
    const q = searchInput.value.trim().toLowerCase();
    const sorted = scripts.slice().sort((a, b) => b.updated - a.updated);
    const shown = q ? sorted.filter((s) => (s.title + '\n' + s.body).toLowerCase().includes(q)) : sorted;
    $('#script-count').textContent = q ? `${shown.length} of ${scripts.length}` : scripts.length;
    listEl.replaceChildren(...shown.map((s) => {
      const n = wordCount(s.body);
      const active = s.id === currentId;
      const title = s.title.trim() || 'Untitled script';
      return h('li', null, h('div', { class: 'script-item' + (active ? ' active' : ''), 'aria-current': active ? 'true' : null, dataset: { id: s.id } },
        h('span', { class: 'si-top' },
          h('span', { class: 'si-title' + (s.title.trim() ? '' : ' untitled'), text: title }),
          active ? h('span', { class: 'si-badge', text: 'On screen' }) : null),
        h('span', { class: 'si-snippet', text: snippet(s.body) }),
        h('span', { class: 'si-meta' }, h('span', { text: `${plural(n, 'word')} · ${fmtDuration((n / WPM) * 60)}` }), h('span', { text: relTime(s.updated) })),
        h('span', { class: 'si-actions' },
          h('button', { type: 'button', class: 'btn small', 'aria-label': `Edit ${title}`, dataset: { act: 'edit' }, html: icon('edit') + '<span class="label">Edit</span>' }),
          h('button', { type: 'button', class: 'btn small primary', 'aria-label': `Present ${title}`, dataset: { act: 'present' }, html: icon('play') + '<span class="label">Present</span>' }))));
    }));
    $('#list-empty').hidden = shown.length > 0;
    $('#list-empty-q').textContent = `“${searchInput.value.trim()}”`;
  }

  function updateStats() {
    const n = wordCount(bodyInput.value);
    $('#stat-words').textContent = plural(n, 'word');
    $('#stat-time').textContent = `${fmtDuration((n / WPM) * 60)} read`;
    $('#stat-time').parentElement.dataset.tip = `Estimated at ${WPM} words per minute`;
    const empty = !bodyInput.value.trim();
    pageEl.classList.toggle('is-empty', empty);
    $('#editor-empty').hidden = !empty;
  }

  const isEditorOpen = () => !editorPanel.hidden;

  // Open the pop-up editor on any script.
  function editScript(id, { focusTitle = false } = {}) {
    if (!scripts.some((s) => s.id === id)) return;
    pause();
    editingId = id;
    const s = editing();
    titleInput.value = s.title;
    bodyInput.value = s.body;
    updateStats();
    setSidebar(false);
    hideTip();
    editorPanel.hidden = false;
    document.body.classList.add('editor-open');
    $('#editor-wrap').scrollTop = 0;
    (focusTitle ? titleInput : bodyInput).focus({ preventScroll: true });
    if (!focusTitle) bodyInput.setSelectionRange(0, 0);
    broadcastState();
  }

  function closeEditor() {
    if (!isEditorOpen()) return;
    persistNow();
    editorPanel.hidden = true;
    document.body.classList.remove('editor-open');
    hideTip();
    editingId = null;
    if (prompterStale) loadIntoPrompter({ keepPlace: true });
    renderList();
    broadcastState();
  }

  // Put a script on the prompter (and close anything covering it).
  function presentScript(id) {
    if (!scripts.some((s) => s.id === id)) return;
    currentId = id;
    persistNow();
    if (isEditorOpen()) { prompterStale = false; closeEditor(); }
    setSidebar(false);
    loadIntoPrompter();
    renderList();
  }

  let listTimer = 0;
  function touch() {
    editing().updated = Date.now();
    if (editingId === currentId) prompterStale = true;
    persist();
    clearTimeout(listTimer);
    listTimer = setTimeout(renderList, 250);
  }

  titleInput.addEventListener('input', () => { editing().title = titleInput.value; touch(); });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); bodyInput.focus(); }
  });
  bodyInput.addEventListener('input', () => { editing().body = bodyInput.value; updateStats(); touch(); });
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const card = e.target.closest('.script-item');
    if (!b || !card) return;
    if (b.dataset.act === 'edit') editScript(card.dataset.id);
    else presentScript(card.dataset.id);
  });
  $('#editor-done').addEventListener('click', closeEditor);
  $('#start-btn').addEventListener('click', () => presentScript(editingId));
  searchInput.addEventListener('input', renderList);
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchInput.value) { e.stopPropagation(); } });
  $('#clear-search').addEventListener('click', () => { searchInput.value = ''; renderList(); searchInput.focus(); });

  $('#new-script').addEventListener('click', () => {
    const s = makeScript('', '');
    scripts.push(s);
    searchInput.value = '';
    renderList();
    editScript(s.id, { focusTitle: true });
  });

  $('#delete-btn').addEventListener('click', async () => {
    const s = editing();
    const ok = await confirmDialog({
      title: 'Delete this script?',
      message: `“${s.title.trim() || 'Untitled script'}” will be removed from this browser. This can’t be undone.`,
      confirm: 'Delete script',
    });
    if (!ok) return;
    scripts = scripts.filter((x) => x.id !== s.id);
    if (!scripts.length) scripts.push(makeScript('Welcome to OpenCue', WELCOME));
    const wasOnScreen = s.id === currentId;
    // Point the prompter at a script that still exists before anything reads it.
    if (wasOnScreen) currentId = scripts.slice().sort((a, b) => b.updated - a.updated)[0].id;
    prompterStale = false;
    closeEditor();
    if (wasOnScreen) loadIntoPrompter();
    persistNow();
    renderList();
    toast('Script deleted');
  });

  // ---- the Scripts panel (slides in from the left over the prompter)
  const isSidebarOpen = () => document.body.classList.contains('sidebar-open');
  function setSidebar(open) {
    document.body.classList.toggle('sidebar-open', open);
    $('#tb-library').setAttribute('aria-expanded', String(open));
    if (open) {
      renderList();
      hideTip();
      showControls();
    }
  }
  $('#tb-library').addEventListener('click', () => setSidebar(!isSidebarOpen()));
  $('#sidebar-close').addEventListener('click', () => setSidebar(false));
  $('#scrim').addEventListener('click', () => setSidebar(false));

  // ---- formatting toolbar

  function replaceSelection(text) {
    bodyInput.focus();
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
    if (!ok) {
      bodyInput.setRangeText(text, bodyInput.selectionStart, bodyInput.selectionEnd, 'end');
      bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function wrapSelection(before, after) {
    const ta = bodyInput;
    ta.focus();
    let s = ta.selectionStart, e = ta.selectionEnd;
    const v = ta.value;
    while (s < e && /\s/.test(v[s])) s++;
    while (e > s && /\s/.test(v[e - 1])) e--;
    const sel = v.slice(s, e);
    if (sel && v.slice(s - before.length, s) === before && v.slice(e, e + after.length) === after) {
      ta.setSelectionRange(s - before.length, e + after.length);
      replaceSelection(sel);
      ta.setSelectionRange(s - before.length, e - before.length);
      return;
    }
    if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
      ta.setSelectionRange(s, e);
      const inner = sel.slice(before.length, sel.length - after.length);
      replaceSelection(inner);
      ta.setSelectionRange(s, s + inner.length);
      return;
    }
    ta.setSelectionRange(s, e);
    replaceSelection(before + sel + after);
    ta.setSelectionRange(s + before.length, s + before.length + sel.length);
  }

  function toggleHeading() {
    const ta = bodyInput;
    ta.focus();
    const v = ta.value;
    const s = ta.selectionStart, e = ta.selectionEnd;
    const start = v.lastIndexOf('\n', s - 1) + 1;
    let end = v.indexOf('\n', Math.max(s, e - (e > s && v[e - 1] === '\n' ? 1 : 0)));
    if (end < 0) end = v.length;
    const lines = v.slice(start, end).split('\n');
    if (lines.every((l) => !l.trim())) {
      replaceSelection('# ');
      return;
    }
    const allHeadings = lines.every((l) => !l.trim() || /^#{1,6}\s/.test(l.trim()));
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      return allHeadings ? l.replace(/^(\s*)#{1,6}\s+/, '$1') : '# ' + l.replace(/^\s*#{1,6}\s+/, '');
    }).join('\n');
    ta.setSelectionRange(start, end);
    replaceSelection(out);
    if (s === e) ta.setSelectionRange(start + out.length, start + out.length);
    else ta.setSelectionRange(start, start + out.length);
  }

  const FORMATS = {
    cue: () => wrapSelection('[', ']'),
    heading: toggleHeading,
    emphasis: () => wrapSelection('*', '*'),
  };
  $$('[data-fmt]').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the textarea selection
    b.addEventListener('click', () => FORMATS[b.dataset.fmt]());
  });
  bodyInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      FORMATS.emphasis();
    }
  });

  // ---- import / export

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const slug = (s) => (s || 'script').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'script';
  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

  $('#export-btn').addEventListener('click', () => {
    const s = editing();
    download(new Blob([s.body], { type: 'text/plain;charset=utf-8' }), `${slug(s.title)}.txt`);
  });

  $('#backup-btn').addEventListener('click', () => {
    persistNow();
    const data = { app: 'opencue', version: 1, exported: new Date().toISOString(), scripts };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `opencue-backup-${stamp()}.json`);
    toast(`Backed up ${plural(scripts.length, 'script')}`);
  });

  const importFile = $('#import-file');
  $('#import-btn').addEventListener('click', () => importFile.click());
  $('#empty-import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    let added = 0, lastId = null;
    for (const file of importFile.files) {
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        try {
          const data = JSON.parse(text);
          for (const s of Array.isArray(data && data.scripts) ? data.scripts : []) {
            if (!s || typeof s.body !== 'string') continue;
            // Copy only known fields with the right types, so a damaged or hand-edited backup can't break the library.
            const clean = {
              id: typeof s.id === 'string' && /^[\w-]{1,64}$/.test(s.id) ? s.id : uid(),
              title: typeof s.title === 'string' ? s.title.slice(0, 300) : '',
              body: s.body,
              updated: Number.isFinite(s.updated) ? s.updated : Date.now(),
            };
            const existing = scripts.find((x) => x.id === clean.id);
            if (existing) Object.assign(existing, clean);
            else scripts.push(clean);
            lastId = clean.id;
            added++;
          }
        } catch (_) { toast(`Could not read ${file.name}`, 4000, 'error'); }
      } else {
        const s = makeScript(file.name.replace(/\.[^.]+$/, ''), text);
        scripts.push(s);
        lastId = s.id;
        added++;
      }
    }
    importFile.value = '';
    if (added) {
      searchInput.value = '';
      persistNow();
      if (isEditorOpen()) closeEditor();
      setSidebar(true);
      toast(`Imported ${plural(added, 'script')}. Use Present or Edit on it below.`, 4000);
    }
  });

  // ---------------------------------------------------------------- prompter

  const prompterView = $('#prompter-view');
  const stage = $('#stage');
  const playBtn = $('#tb-play');
  const voicePill = $('#voice-pill');
  const heardEl = $('#heard');
  const timerEl = $('#timer');
  const countdownEl = $('#countdown');

  const prompter = new window.OpenCuePrompter({
    stage,
    text: $('#text'),
    eyeline: $('#eyeline'),
    fade: $('#fade'),
    progress: $('#progress-bar'),
  });
  prompter.onEnd = () => pause();

  let playing = false;
  let needsCountdown = true;
  let countdownTimer = 0;
  let elapsed = 0, elapsedFrom = 0;

  const voice = new Voice({
    onWords: (words) => { if (playing && settings.mode === 'voice') prompter.voiceUpdate(words); },
    onHeard: (text) => { heardEl.textContent = text.split(/\s+/).slice(-6).join(' '); },
    onState: (state) => { voicePill.classList.toggle('live', state === 'listening'); },
    onError: (err) => {
      const msg = {
        'not-allowed': 'Microphone access was blocked. Allow it in the browser to use voice tracking.',
        'service-not-allowed': 'This browser does not allow speech recognition here.',
        'audio-capture': 'No microphone was found.',
        'network': 'Speech recognition needs an internet connection in this browser.',
        'language-not-supported': 'That voice language is not supported by this browser.',
      }[err] || `Voice tracking stopped (${err}).`;
      toast(msg, 6000, 'error');
      pause();
    },
  });

  // Show the current script on the prompter. keepPlace: it's the same script,
  // just edited, so stay at the same word instead of going back to the top.
  function loadIntoPrompter({ keepPlace = false } = {}) {
    prompterStale = false;
    pause();
    const anchor = keepPlace ? prompter.wordAtEyeline() : -1;
    prompter.load(parse(current().body));
    prompter.setMode(settings.mode);
    if (anchor > 0) {
      prompter.jumpTo(Math.min(anchor, prompter.wordEls.length - 1));
      prompter.offset = prompter.target; // jump there, don't scroll from the top
    }
    const title = current().title.trim() || 'Untitled script';
    $('#prompter-title').textContent = title;
    $('#tb-library').setAttribute('aria-label', `Scripts. On screen: ${title}`);
    if (!keepPlace) {
      needsCountdown = true;
      elapsed = 0;
    }
    updateTimer();
    updatePlayUI();
    showControls();
    broadcastState();
  }

  // Voice mode streams microphone audio to the browser vendor's speech service
  // (Google in Chrome, Microsoft in Edge). Say so once, before it's first used.
  let askingVoice = false;
  async function voiceConsent() {
    if (ui.voiceConsent) return true;
    askingVoice = true;
    const ok = await confirmDialog({
      title: 'Before you use Voice mode',
      message: 'To follow along, your browser sends what the microphone hears to its speech service (Google in Chrome, Microsoft in Edge) to turn it into text. Your script itself is never sent, but anything you read aloud is. For confidential scripts, use Auto or Manual mode, which never leave this computer.',
      confirm: 'Use Voice mode',
      cancel: 'Use Auto instead',
      danger: false,
    });
    askingVoice = false;
    if (ok) { ui.voiceConsent = true; saveUI(); }
    return ok;
  }

  async function play() {
    if (playing || countdownTimer || askingVoice) return;
    if (settings.mode === 'voice' && !(await voiceConsent())) setMode('auto');
    if (needsCountdown && settings.countdown > 0) runCountdown(settings.countdown, start);
    else start();
  }

  function start() {
    needsCountdown = false;
    playing = true;
    elapsedFrom = performance.now();
    if (settings.mode === 'voice') {
      heardEl.textContent = '';
      prompter.setListening(true);
      voice.start(settings.lang);
    } else if (settings.mode === 'auto') {
      prompter.playing = true;
    }
    updatePlayUI();
    showControls();
    broadcastState();
  }

  function pause() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = 0;
      countdownEl.hidden = true;
    }
    if (!playing) { updatePlayUI(); return; }
    playing = false;
    elapsed += performance.now() - elapsedFrom;
    voice.stop();
    prompter.setListening(false);
    prompter.playing = false;
    updatePlayUI();
    showControls();
    broadcastState();
  }

  const togglePlay = () => (playing || countdownTimer ? pause() : play());

  function showCount(n) {
    $('#countdown-num').textContent = n;
    countdownEl.classList.remove('tick');
    void countdownEl.offsetWidth; // restart the animations
    countdownEl.classList.add('tick');
  }
  function runCountdown(n, done) {
    countdownEl.hidden = false;
    showCount(n);
    countdownTimer = setInterval(() => {
      n--;
      if (n <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = 0;
        countdownEl.hidden = true;
        done();
      } else {
        showCount(n);
      }
    }, 1000);
    updatePlayUI();
  }

  function resetToTop() {
    prompter.reset();
    needsCountdown = true;
    elapsed = 0;
    if (playing) elapsedFrom = performance.now();
    updateTimer();
  }

  function setMode(mode) {
    if (mode === 'voice' && !VOICE_OK) {
      toast('Voice tracking needs Chrome, Edge or Safari. Using Auto instead.', 5000, 'warn');
      mode = 'auto';
    }
    const wasPlaying = playing;
    pause();
    settings.mode = mode;
    saveSettings();
    prompter.setMode(mode);
    syncSettingsUI();
    updatePlayUI();
    if (wasPlaying && mode === 'auto') start();
    else if (wasPlaying && mode === 'voice') play(); // goes through the one-time Voice notice
    broadcastState();
  }

  function changeSpeed(d) {
    settings.speed = clamp(Math.round((settings.speed + d) * 2) / 2, ...LIMITS.speed);
    applySettings();
  }

  function changeFont(d) {
    settings.fontSize = clamp(settings.fontSize + d * 4, ...LIMITS.fontSize);
    applySettings();
  }

  function changeWidth(d) {
    settings.width = clamp(settings.width + d, ...LIMITS.width);
    applySettings();
  }

  const fmtSpeed = (v) => String(Math.round(v * 10) / 10);

  // The speed readout in the bar is a text box: type a number, then Enter or click away.
  const speedInput = $('#speed-val');
  function showSpeed() {
    if (document.activeElement !== speedInput) speedInput.value = fmtSpeed(settings.speed);
  }
  function commitSpeed() {
    const typed = parseFloat(speedInput.value.replace(',', '.'));
    if (Number.isFinite(typed)) {
      const [lo, hi] = LIMITS.speed;
      const v = clamp(Math.round(typed * 2) / 2, lo, hi);
      if (typed < lo || typed > hi) toast(`Speed goes from ${lo} to ${hi}, so it's set to ${fmtSpeed(v)}`, 3500);
      settings.speed = v;
      applySettings();
    }
    speedInput.value = fmtSpeed(settings.speed);
  }
  speedInput.addEventListener('focus', () => speedInput.select());
  speedInput.addEventListener('blur', commitSpeed);
  speedInput.addEventListener('keydown', (e) => {
    // Keep typing here from reaching the prompter's shortcuts (Esc would close the prompter).
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); speedInput.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); speedInput.value = fmtSpeed(settings.speed); speedInput.blur(); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      changeSpeed(e.key === 'ArrowUp' ? 0.5 : -0.5);
      speedInput.value = fmtSpeed(settings.speed);
      speedInput.select();
    }
  });

  function updatePlayUI() {
    const running = playing || !!countdownTimer;
    const manual = settings.mode === 'manual';
    setIcon(playBtn, running ? 'pause' : 'play');
    playBtn.querySelector('.label').textContent = running ? 'Pause' : 'Start';
    playBtn.dataset.tip = manual && !running ? 'Manual mode: scroll with the wheel, touch or arrow keys' : running ? 'Pause' : 'Start';
    playBtn.setAttribute('aria-disabled', String(manual && !running));
    const modeBtn = $('#mode-btn');
    $('#mode-label').textContent = MODES.find(([v]) => v === settings.mode)[1];
    $('#mode-icon').innerHTML = icon(MODE_ICONS[settings.mode]);
    modeBtn.setAttribute('aria-label', `Scroll mode: ${$('#mode-label').textContent}`);
    $$('#mode-menu [data-mode]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode)));
    $('#speed-group').hidden = settings.mode !== 'auto';
    showSpeed();
    $('#tb-slower').disabled = settings.speed <= LIMITS.speed[0];
    $('#tb-faster').disabled = settings.speed >= LIMITS.speed[1];
    voicePill.hidden = !(settings.mode === 'voice' && playing);
    prompterView.classList.toggle('running', playing);
    stage.classList.toggle('running-stage', playing);
  }

  function updateTimer() {
    const ms = elapsed + (playing ? performance.now() - elapsedFrom : 0);
    timerEl.textContent = fmtClock(ms);
  }
  setInterval(() => { if (!prompterView.hidden) updateTimer(); }, 250);

  // ---- apply settings to the display

  function applySettings() {
    const st = prompterView.style;
    st.setProperty('--p-font-size', settings.fontSize + 'px');
    st.setProperty('--p-line-height', settings.lineHeight);
    st.setProperty('--p-width', settings.width + '%');
    st.setProperty('--p-pos', clamp(settings.position, 0, 100) / 100);
    st.setProperty('--p-font', FONTS[settings.font] || FONTS.sans);
    st.setProperty('--p-align', settings.align);
    st.setProperty('--p-fg', settings.fg);
    st.setProperty('--p-bg', settings.bg);
    st.setProperty('--p-cue', settings.cue);
    st.setProperty('--p-hl', settings.hl);
    st.setProperty('--p-eye', settings.eyelineColor);
    stage.classList.toggle('uppercase', settings.uppercase);
    stage.classList.toggle('no-eyeline', !settings.showEyeline);
    stage.classList.toggle('dim-read', settings.dimRead);
    stage.classList.toggle('show-heard', settings.showHeard);
    $('#mirror').style.transform = `scale(${settings.mirrorX ? -1 : 1}, ${settings.mirrorY ? -1 : 1})`;
    const mirrored = settings.mirrorX || settings.mirrorY;
    $('#tb-mirror').classList.toggle('on', mirrored);
    $('#tb-mirror').setAttribute('aria-pressed', String(mirrored));
    showSpeed();
    $('#tb-slower').disabled = settings.speed <= LIMITS.speed[0];
    $('#tb-faster').disabled = settings.speed >= LIMITS.speed[1];
    prompter.configure({
      eyelinePct: settings.eyeline,
      lineHeightPx: settings.fontSize * settings.lineHeight,
      speed: settings.speed,
      voiceFollow: VOICE_FOLLOW[settings.voiceSmooth] || VOICE_FOLLOW.normal,
      voiceLead: clamp(Number(settings.voiceLead) || 0, 0, 2),
      voiceStyle: settings.voiceScroll === 'continuous' ? 'continuous' : 'lines',
    });
    syncSettingsUI();
    saveSettings();
    broadcastState();
  }

  // ---------------------------------------------------------------- settings controls

  const binds = [];
  const bindUI = (key, fn) => binds.push([key, fn]);
  function syncSettingsUI() {
    for (const [key, fn] of binds) fn(key ? settings[key] : settings);
  }
  function setSetting(key, value) {
    settings[key] = value;
    if (key === 'lang' && playing && settings.mode === 'voice') { voice.stop(); voice.start(settings.lang); }
    applySettings();
  }

  let uidN = 0;
  const nextId = (p) => `${p}-${++uidN}`;
  const same = (a, b) => String(a) === String(b);

  // Arrow-key navigation inside a radiogroup (roving tabindex).
  function radioKeys(group) {
    group.addEventListener('keydown', (e) => {
      const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      if (!(e.key in keys)) return;
      e.preventDefault();
      e.stopPropagation();
      const items = Array.from(group.querySelectorAll('[role="radio"]'));
      const i = items.indexOf(document.activeElement);
      const next = items[(i + keys[e.key] + items.length) % items.length];
      next.focus();
      next.click();
    });
  }
  function syncRadios(items, isOn) {
    let any = false;
    items.forEach((b) => {
      const on = isOn(b);
      any = any || on;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    if (!any && items[0]) items[0].tabIndex = 0;
  }

  function rowEl(label, control, { inline = false, keywords = '', out = null, hint = null } = {}) {
    const labelEl = h('span', { id: nextId('lbl'), text: label });
    return h('div', { class: 'set-row' + (inline ? ' inline' : ''), dataset: { search: `${label} ${keywords}`.toLowerCase() } },
      h('div', { class: 'set-label' }, labelEl, out),
      control,
      hint ? h('p', { class: 'set-hint', text: hint }) : null);
  }

  function segmented(key, label, options, { accent = false, onPick = null, keywords } = {}) {
    const group = h('div', { class: 'seg' + (accent ? ' accent' : ''), role: 'radiogroup', 'aria-label': label });
    const items = options.map(([v, l]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': 'false', dataset: { v },
      class: key === 'mode' && v === 'voice' && !VOICE_OK ? 'unsupported' : null,
      onclick: () => (onPick ? onPick(v) : setSetting(key, v)),
    }, l));
    group.append(...items);
    radioKeys(group);
    bindUI(key, (val) => syncRadios(items, (b) => same(b.dataset.v, val)));
    return rowEl(label, group, { keywords });
  }

  function chipGroup(key, label, options, { cls = '', fill = false, styleFor = null, parse: conv = (v) => v } = {}) {
    const group = h('div', { class: 'chip-row' + (fill ? ' fill' : ''), role: 'radiogroup', 'aria-label': label });
    const items = options.map(([v, l]) => h('button', {
      type: 'button', role: 'radio', class: 'opt-chip ' + cls, 'aria-checked': 'false', dataset: { v },
      style: styleFor ? styleFor(v) : null,
      onclick: () => setSetting(key, conv(v)),
    }, l));
    group.append(...items);
    radioKeys(group);
    bindUI(key, (val) => syncRadios(items, (b) => same(b.dataset.v, val)));
    return group;
  }

  function slider(key, label, { min, max, step, fmt = (v) => String(v), keywords } = {}) {
    const out = h('output');
    const input = h('input', { type: 'range', class: 'slider', min, max, step, 'aria-label': label });
    input.addEventListener('input', () => setSetting(key, Number(input.value)));
    bindUI(key, (v) => {
      if (Number(input.value) !== v) input.value = v;
      input.style.setProperty('--fill', ((clamp(v, min, max) - min) / (max - min)) * 100 + '%');
      out.textContent = fmt(v);
      input.setAttribute('aria-valuetext', fmt(v));
    });
    return rowEl(label, input, { out, keywords });
  }

  function toggle(key, label, { keywords, hint } = {}) {
    const sw = h('button', { type: 'button', class: 'switch', role: 'switch', 'aria-checked': 'false', onclick: () => setSetting(key, !settings[key]) });
    const row = rowEl(label, sw, { inline: true, keywords, hint });
    const lbl = row.querySelector('.set-label span');
    sw.setAttribute('aria-labelledby', lbl.id);
    lbl.addEventListener('click', () => sw.click());
    lbl.style.cursor = 'pointer';
    bindUI(key, (v) => sw.setAttribute('aria-checked', String(!!v)));
    return row;
  }

  function selectEl(key, label, options) {
    const sel = h('select', { class: 'select', 'aria-label': label });
    for (const [v, l] of options) sel.add(new Option(l, v));
    sel.addEventListener('change', () => setSetting(key, sel.value));
    bindUI(key, (v) => { if (sel.value !== v) sel.value = v; });
    return sel;
  }

  function sizeStepper() {
    const dec = h('button', { type: 'button', class: 'a-sm', 'aria-label': 'Smaller text', 'data-tip': 'Smaller text', 'data-kbd': '−', onclick: () => changeFont(-1) }, 'A');
    const inc = h('button', { type: 'button', class: 'a-lg', 'aria-label': 'Larger text', 'data-tip': 'Larger text', 'data-kbd': '+', onclick: () => changeFont(1) }, 'A');
    const out = h('output', { 'aria-live': 'polite' });
    bindUI('fontSize', (v) => {
      out.innerHTML = `${Number(v) || 0}<small>px</small>`;
      dec.disabled = v <= LIMITS.fontSize[0];
      inc.disabled = v >= LIMITS.fontSize[1];
    });
    return rowEl('Text size', h('div', { class: 'size-stepper', role: 'group', 'aria-label': 'Text size' }, dec, out, inc), { keywords: 'font size bigger smaller larger zoom' });
  }

  function swatch(key, name) {
    const input = h('input', { type: 'color', 'aria-label': `${name} color` });
    const dot = h('span', { class: 'swatch-dot' });
    const hex = h('span', { class: 'swatch-hex' });
    input.addEventListener('input', () => setSetting(key, input.value));
    bindUI(key, (v) => {
      if (input.value !== v) input.value = v;
      dot.style.setProperty('--c', v);
      hex.textContent = v;
    });
    return h('label', { class: 'swatch' }, dot, h('span', { class: 'swatch-text' }, h('span', { class: 'swatch-name', text: name }), hex), input);
  }

  const fmtPos = (v) => (v === 50 ? 'Center' : v < 50 ? `${50 - v}% left` : `${v - 50}% right`);
  const lineHeightChips = () => rowEl('Line height', chipGroup('lineHeight', 'Line height', LINE_HEIGHTS.map((v) => [v, String(v)]), { fill: true, parse: Number }), { keywords: 'spacing leading line spacing' });
  const widthSlider = () => slider('width', 'Script width', { min: 30, max: 100, step: 1, fmt: (v) => `${v}%`, keywords: 'column margins narrow wide' });
  const positionSlider = () => slider('position', 'Horizontal position', { min: 0, max: 100, step: 1, fmt: fmtPos, keywords: 'offset left right center align column' });

  const PRESETS = {
    classic: { name: 'Classic', fg: '#ffffff', bg: '#000000', cue: '#ffd166', hl: '#7aa2ff' },
    amber: { name: 'Amber', fg: '#ffd166', bg: '#000000', cue: '#ff8fa3', hl: '#ffffff' },
    green: { name: 'Green', fg: '#7dff9a', bg: '#000000', cue: '#ffd166', hl: '#ffffff' },
    paper: { name: 'Paper', fg: '#141414', bg: '#f6f3ea', cue: '#b45309', hl: '#1d4ed8' },
  };
  function themeChips() {
    const group = h('div', { class: 'chip-row fill', role: 'radiogroup', 'aria-label': 'Color theme' });
    const items = Object.entries(PRESETS).map(([id, p]) => h('button', {
      type: 'button', role: 'radio', class: 'opt-chip theme-chip', 'aria-checked': 'false', dataset: { preset: id },
      style: `--a:${p.fg};--b:${p.bg}`,
      onclick: () => { const { name, ...colors } = p; Object.assign(settings, colors); applySettings(); },
    }, p.name));
    group.append(...items);
    radioKeys(group);
    bindUI(null, (s) => syncRadios(items, (b) => {
      const p = PRESETS[b.dataset.preset];
      return ['fg', 'bg', 'cue', 'hl'].every((k) => s[k].toLowerCase() === p[k]);
    }));
    return rowEl('Theme', group, { keywords: 'preset colors colour classic amber green paper light dark' });
  }

  const SHORTCUTS = [
    ['Start / pause', ['Space']],
    ['Restart from the top', ['Home']],
    ['Speed (Auto) or one line', ['↑', '↓']],
    ['Scroll one line', ['←', '→']],
    ['Jump back / ahead', ['PgUp', 'PgDn']],
    ['Text size', ['+', '−']],
    ['Script width', ['[', ']']],
    ['Mirror', ['M']],
    ['Fullscreen', ['F']],
    ['Settings', ['S']],
    ['Close a menu, Settings, Scripts or the editor', ['Esc']],
  ];

  const SECTIONS = [
    {
      id: 'scrolling', title: 'Scrolling', icon: 'gauge', keywords: 'speed velocity pace fast slow scroll mode countdown timer start',
      build: () => [
        segmented('mode', 'Mode', MODES, { accent: true, onPick: setMode, keywords: 'voice auto manual flow' }),
        slider('speed', 'Auto-scroll speed', { min: 1, max: 30, step: 0.5, fmt: fmtSpeed, keywords: 'velocity pace fast slow rate' }),
        slider('countdown', 'Countdown before start', { min: 0, max: 10, step: 1, fmt: (v) => (v ? `${v} s` : 'Off'), keywords: 'timer delay get ready' }),
      ],
    },
    {
      id: 'typography', title: 'Typography', icon: 'type', keywords: 'font text typeface letters',
      build: () => [
        sizeStepper(),
        rowEl('Font', chipGroup('font', 'Font', FONT_OPTIONS, { cls: 'font-chip', fill: true, styleFor: (v) => `font-family:${FONTS[v].replace(/"/g, "'")}` }), { keywords: 'typeface family serif sans mono' }),
        lineHeightChips(),
        segmented('align', 'Alignment', [['left', 'Left'], ['center', 'Center']], { keywords: 'justify align' }),
        toggle('uppercase', 'All caps', { keywords: 'uppercase capitals' }),
      ],
    },
    {
      id: 'layout', title: 'Layout', icon: 'layout', keywords: 'position margins column mirror flip reverse beam splitter rig glass fullscreen full screen',
      build: () => [
        widthSlider(),
        positionSlider(),
        toggle('mirrorX', 'Mirror horizontally', { keywords: 'flip reverse beam splitter rig' }),
        toggle('mirrorY', 'Flip vertically', { keywords: 'mirror upside down reverse' }),
        // The bar's Fullscreen button is hidden on tablets and phones, so offer it here too.
        h('div', { class: 'btn-row', dataset: { search: 'fullscreen full screen maximize' } },
          h('button', { type: 'button', class: 'btn small', html: icon('fullscreen') + '<span class="label">Fullscreen</span>', onclick: () => toggleFullscreen() })),
      ],
    },
    {
      id: 'display', title: 'Display', icon: 'eye', keywords: 'color colour theme appearance contrast eyeline read line reading guide marker',
      build: () => [
        themeChips(),
        rowEl('Colors', h('div', { class: 'swatches' }, swatch('fg', 'Text'), swatch('bg', 'Background'), swatch('cue', 'Cues & headings'), swatch('hl', 'Highlight')), { keywords: 'colour text background cue heading highlight' }),
        h('div', { class: 'set-divider' }),
        toggle('showEyeline', 'Show eyeline', { keywords: 'read line reading guide marker' }),
        slider('eyeline', 'Eyeline position', { min: 10, max: 70, step: 1, fmt: (v) => `${v}% from top`, keywords: 'read line reading guide marker height' }),
        rowEl('Eyeline color', h('div', { class: 'swatches' }, swatch('eyelineColor', 'Eyeline')), { keywords: 'read line marker colour' }),
        toggle('dimRead', 'Dim words already read', { keywords: 'fade highlight past' }),
      ],
    },
    {
      id: 'voice', title: 'Voice', icon: 'mic', keywords: 'speech recognition language dictation listen transcript heard locale accent smooth smoothness follow look ahead lead lines',
      build: () => [
        rowEl('Recognition language', selectEl('lang', 'Recognition language', LANGS), { keywords: 'locale accent dialect' }),
        segmented('voiceScroll', 'Voice scrolling', [['lines', 'By line'], ['continuous', 'Continuous']], {
          keywords: 'scroll style linear continuous steady line by line pace',
        }),
        h('p', { class: 'set-hint', dataset: { search: 'scroll style linear continuous steady line pace' }, text: 'By line glides up each time you reach a new line. Continuous scrolls steadily at your reading pace and eases to a stop when you pause.' }),
        segmented('voiceSmooth', 'Scroll smoothness', [['gentle', 'Gentle'], ['normal', 'Normal'], ['snappy', 'Snappy']], {
          keywords: 'smooth smoothness follow speed glide catch up snappy gentle',
        }),
        segmented('voiceLead', 'Lines of look-ahead', [[0, 'None'], [1, '1 line'], [2, '2 lines']], {
          keywords: 'look ahead lead lines upcoming next eyeline position',
        }),
        h('p', { class: 'set-hint', dataset: { search: 'look ahead lead lines upcoming next eyeline smooth' }, text: 'Look-ahead keeps the line you’re reading that many lines above the eyeline, so more of what’s coming shows below it.' }),
        toggle('showHeard', 'Show what the mic hears', { keywords: 'transcript caption heard words' }),
        h('p', {
          class: 'set-hint',
          text: VOICE_OK
            ? 'Voice tracking uses your system’s default microphone. In Chrome and Edge, audio is sent to the browser vendor’s speech service.'
            : 'Voice tracking isn’t supported in this browser. Try Chrome, Edge or Safari.',
        }),
      ],
    },
    {
      id: 'behavior', title: 'Behavior', icon: 'toggle', keywords: 'controls toolbar remote operator second screen window phone tablet qr room code pair',
      build: () => [
        toggle('autoHide', 'Hide controls while running', { keywords: 'auto hide toolbar chrome idle' }),
        rowEl('Phone or tablet remote', h('button', { type: 'button', class: 'btn small', html: icon('remote') + '<span class="label">Pair a remote</span>', onclick: () => openPhoneRemote() }), {
          keywords: 'remote phone tablet ipad iphone android qr code room pair operator',
          hint: 'Control the prompter from a phone or tablet with a room code or QR code.',
        }),
        rowEl('Remote on this computer', h('button', { type: 'button', class: 'btn small', html: icon('remote') + '<span class="label">Open remote window</span>', onclick: openRemote }), {
          keywords: 'remote operator second monitor screen window',
          hint: 'Control the prompter from another window of this browser, for example on a second monitor.',
        }),
      ],
    },
    {
      id: 'shortcuts', title: 'Keyboard shortcuts', icon: 'keyboard', keywords: 'keys hotkeys keyboard shortcut keybindings',
      build: () => [
        h('dl', { class: 'keys', dataset: { search: 'keys hotkeys shortcuts ' + SHORTCUTS.map(([d]) => d).join(' ').toLowerCase() } },
          SHORTCUTS.map(([desc, keys]) => [h('dt', { text: desc }), h('dd', null, keys.map((k) => h('kbd', { text: k })))])),
        h('p', { class: 'set-hint', text: 'Click any word in the script to jump there.' }),
      ],
    },
  ];

  const settingsPanel = $('#settings-panel');
  const settingsBody = $('#settings-body');
  const settingsSearch = $('#settings-search');
  const sectionEls = [];

  function buildSettings() {
    for (const sec of SECTIONS) {
      const bodyId = `sec-${sec.id}`;
      const toggleBtn = h('button', { type: 'button', class: 'set-toggle', 'aria-expanded': 'true', 'aria-controls': bodyId },
        h('span', { class: 'sec-icon', html: icon(sec.icon) }), sec.title, h('span', { class: 'chev', html: icon('chevron-down') }));
      const body = h('div', { class: 'set-card-body', id: bodyId }, sec.build());
      const card = h('section', { class: 'set-card', 'aria-label': sec.title }, h('div', { class: 'set-card-head' }, toggleBtn, sec.action || null), body);
      const setCollapsed = (c) => {
        card.classList.toggle('collapsed', c);
        toggleBtn.setAttribute('aria-expanded', String(!c));
      };
      setCollapsed(ui.collapsed.includes(sec.id));
      toggleBtn.addEventListener('click', () => {
        const c = !card.classList.contains('collapsed');
        setCollapsed(c);
        if (!settingsSearch.value.trim()) {
          ui.collapsed = ui.collapsed.filter((x) => x !== sec.id);
          if (c) ui.collapsed.push(sec.id);
          saveUI();
        }
      });
      sectionEls.push({ sec, card, body, setCollapsed });
      settingsBody.appendChild(card);
    }
    settingsBody.appendChild(h('div', { id: 'settings-empty', class: 'set-empty', hidden: true }));

    // Layout popover in the control bar reuses the same controls.
    $('#layout-pop').append(h('p', { class: 'pop-title', text: 'Layout' }), sizeStepper(), widthSlider(), positionSlider(), lineHeightChips());
  }

  function filterSettings() {
    const q = settingsSearch.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let any = false;
    for (const { sec, card, body, setCollapsed } of sectionEls) {
      const kids = Array.from(body.children);
      if (!terms.length) {
        card.hidden = false;
        kids.forEach((k) => { k.hidden = false; });
        setCollapsed(ui.collapsed.includes(sec.id));
        any = true;
        continue;
      }
      const secText = `${sec.title} ${sec.keywords}`.toLowerCase();
      const secMatch = terms.every((t) => secText.includes(t));
      let rowMatch = false;
      for (const k of kids) {
        const text = k.dataset.search;
        const m = secMatch || (text != null && terms.every((t) => text.includes(t)));
        k.hidden = !m;
        rowMatch = rowMatch || m;
      }
      card.hidden = !rowMatch;
      if (rowMatch) setCollapsed(false);
      any = any || rowMatch;
    }
    const empty = $('#settings-empty');
    empty.hidden = any;
    empty.replaceChildren('No settings match ', h('b', { text: `“${settingsSearch.value.trim()}”` }), '. Try “speed”, “font” or “mirror”.');
  }
  settingsSearch.addEventListener('input', filterSettings);

  $('#reset-settings').addEventListener('click', () => {
    const keep = { mode: settings.mode, lang: settings.lang };
    settings = Object.assign({}, DEFAULTS, keep);
    applySettings();
    updatePlayUI();
    toast('Settings reset to defaults');
  });

  const isSettingsOpen = () => settingsPanel.classList.contains('open');
  function openSettings({ focusSearch = false } = {}) {
    closePops();
    settingsPanel.classList.add('open');
    settingsPanel.inert = false;
    $('#tb-settings').classList.add('on');
    $('#tb-settings').setAttribute('aria-expanded', 'true');
    showControls();
    if (focusSearch) setTimeout(() => settingsSearch.focus(), 50);
  }
  function closeSettings() {
    if (!isSettingsOpen()) return;
    const hadFocus = settingsPanel.contains(document.activeElement);
    settingsPanel.classList.remove('open');
    settingsPanel.inert = true;
    $('#tb-settings').classList.remove('on');
    $('#tb-settings').setAttribute('aria-expanded', 'false');
    if (hadFocus && !prompterView.hidden) $('#tb-settings').focus({ preventScroll: true });
    showControls();
  }
  const toggleSettings = (opts) => (isSettingsOpen() ? closeSettings() : openSettings(opts));

  // ---- popovers (mode menu, layout)

  let openPop = null;
  function openPopover(btn, pop) {
    closePops();
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    openPop = { btn, pop };
    hideTip();
    showControls();
  }
  function closePops({ focus = false } = {}) {
    if (!openPop) return;
    const { btn, pop } = openPop;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    openPop = null;
    if (focus) btn.focus({ preventScroll: true });
    showControls();
  }
  document.addEventListener('pointerdown', (e) => {
    if (openPop && !openPop.pop.contains(e.target) && !openPop.btn.contains(e.target)) closePops();
  });

  const modeBtn = $('#mode-btn');
  const modeMenu = $('#mode-menu');
  modeBtn.addEventListener('click', () => {
    if (openPop && openPop.pop === modeMenu) return closePops();
    openPopover(modeBtn, modeMenu);
    const cur = modeMenu.querySelector('[aria-checked="true"]') || modeMenu.querySelector('button');
    cur.focus({ preventScroll: true });
  });
  modeMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    closePops({ focus: true });
    setMode(b.dataset.mode);
  });
  modeMenu.addEventListener('keydown', (e) => {
    const items = Array.from(modeMenu.querySelectorAll('button'));
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    } else if (e.key === 'Tab') {
      closePops();
    }
  });
  if (!VOICE_OK) {
    const vb = $('#mode-menu [data-mode="voice"]');
    vb.classList.add('unsupported');
    vb.querySelector('.mi-desc').textContent = 'Not supported in this browser';
  }

  const layoutBtn = $('#tb-layout');
  const layoutPop = $('#layout-pop');
  layoutBtn.addEventListener('click', () => {
    if (openPop && openPop.pop === layoutPop) return closePops();
    openPopover(layoutBtn, layoutPop);
  });

  // ---- auto-hiding controls

  let hideTimer = 0;
  let pointerInChrome = false;
  function setIdle(idle) {
    prompterView.classList.toggle('idle', idle);
    document.body.classList.toggle('chrome-hidden', idle);
  }
  function showControls() {
    setIdle(false);
    clearTimeout(hideTimer);
    if (settings.autoHide && playing && !isSettingsOpen() && !openPop) {
      hideTimer = setTimeout(() => { if (!pointerInChrome && playing && !openPop && !isSettingsOpen()) setIdle(true); }, 3000);
    }
  }
  prompterView.addEventListener('pointermove', showControls);
  prompterView.addEventListener('pointerdown', showControls);
  $$('.chrome').forEach((el) => {
    el.addEventListener('pointerenter', () => { pointerInChrome = true; });
    el.addEventListener('pointerleave', () => { pointerInChrome = false; showControls(); });
  });
  prompterView.addEventListener('focusin', showControls);

  // ---- direct manipulation of the text

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    prompter.nudge(settings.mirrorY ? -dy : dy);
  }, { passive: false });

  let touchY = null;
  stage.addEventListener('touchstart', (e) => { touchY = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (touchY === null) return;
    const y = e.touches[0].clientY;
    const dy = touchY - y;
    touchY = y;
    prompter.nudge(settings.mirrorY ? -dy : dy);
    e.preventDefault();
  }, { passive: false });
  stage.addEventListener('touchend', () => { touchY = null; });

  $('#text').addEventListener('click', (e) => {
    const w = e.target.closest('.w');
    if (w) prompter.jumpTo(Number(w.dataset.i));
  });

  // ---- toolbar wiring

  playBtn.addEventListener('click', () => {
    if (playBtn.getAttribute('aria-disabled') === 'true') return;
    togglePlay();
  });
  $('#tb-top').addEventListener('click', resetToTop);
  $('#tb-slower').addEventListener('click', () => changeSpeed(-0.5));
  $('#tb-faster').addEventListener('click', () => changeSpeed(0.5));
  $('#tb-mirror').addEventListener('click', toggleMirror);
  $('#tb-fullscreen').addEventListener('click', toggleFullscreen);
  $('#tb-settings').addEventListener('click', () => toggleSettings());
  $('#settings-close').addEventListener('click', closeSettings);

  // A remote in another window of this browser (e.g. for an operator's screen): OpenCue's own Remote tab.
  function openRemote() {
    window.open(new URL('./#remote', location.href).href, 'opencue-remote', 'width=420,height=780');
  }

  // ---------------------------------------------------------------- the Remote tab

  // #remote = control a prompter in another window of this browser;
  // #remote=K7P3QX.<secret> = paired with a prompter on another device (the QR link).
  const remoteView = $('#remote-view');

  function openRemoteView(room) {
    pause();
    setSidebar(false);
    closeEditor();
    closeSettings();
    prompterView.hidden = true;
    remoteView.hidden = false;
    document.title = 'OpenCue Remote';
    window.OpenCueRemote.open(room);
    broadcastState();
  }

  function closeRemoteView() {
    window.OpenCueRemote.close();
    remoteView.hidden = true;
    prompterView.hidden = false;
    document.title = 'OpenCue Teleprompter';
    history.replaceState(null, '', location.pathname + location.search);
    prompter.layout();
    showControls();
  }

  function routeFromHash() {
    const m = /^#remote(?:=(.*))?$/.exec(location.hash);
    if (!m) return;
    let value = m[1] || '';
    try { value = decodeURIComponent(value); } catch (_) { value = ''; }
    openRemoteView(value ? window.OpenCueLink.parseRoom(value) : null);
  }
  window.addEventListener('hashchange', routeFromHash);

  $('#remote-tab-btn').addEventListener('click', () => {
    history.replaceState(null, '', '#remote');
    openRemoteView(null);
  });
  $('#rc-back').addEventListener('click', closeRemoteView);
  $('#tb-remote').addEventListener('click', () => openPhoneRemote());

  function toggleMirror() {
    settings.mirrorX = !settings.mirrorX;
    applySettings();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => toast('Fullscreen is not available here', 3000, 'warn'));
    else toast('Fullscreen is not available here', 3000, 'warn');
  }
  document.addEventListener('fullscreenchange', () => {
    const fs = !!document.fullscreenElement;
    const b = $('#tb-fullscreen');
    setIcon(b, fs ? 'fullscreen-exit' : 'fullscreen');
    b.dataset.tip = fs ? 'Exit fullscreen' : 'Fullscreen';
    b.setAttribute('aria-label', b.dataset.tip);
    b.classList.toggle('on', fs);
  });

  // ---------------------------------------------------------------- wake lock

  let wakeLock = null;
  async function requestWakeLock() {
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (_) { /* not granted */ }
  }
  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  // Keep the screen awake while OpenCue is in front: it's always either a prompter
  // or a remote, and neither should go to sleep mid-shoot.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // ---------------------------------------------------------------- remote control

  // Commands arrive already checked against a fixed list (js/link.js). Remotes only
  // get status below, never the script text.
  function handleRemote(m) {
    if (!remoteView.hidden) return; // this window is being used as a remote, not as a prompter
    if (m.cmd === 'hello') return broadcastState();
    if (m.cmd === 'open') { closeEditor(); setSidebar(false); return broadcastState(); }
    if (isEditorOpen()) return; // someone is editing here; don't scroll under them
    showControls();
    switch (m.cmd) {
      case 'toggle': togglePlay(); break;
      case 'faster': changeSpeed(0.5); break;
      case 'slower': changeSpeed(-0.5); break;
      case 'back': prompter.nudgeLines(-2); break;
      case 'forward': prompter.nudgeLines(2); break;
      case 'top': resetToTop(); break;
      case 'bigger': changeFont(1); break;
      case 'smaller': changeFont(-1); break;
      case 'mirror': toggleMirror(); break;
      case 'mode': setMode(m.value); break;
    }
    broadcastState();
  }

  const link = new window.OpenCueLink.Host({
    onCommand: handleRemote,
    // Someone typed the room code by hand (the QR link joins without asking).
    onApproval: () => confirmDialog({
      title: 'Let a remote connect?',
      message: 'A phone or tablet typed this prompter’s room code and wants to control it. Allow it only if you know who it is. If you don’t, choose Deny, then press New code in the pairing window.',
      confirm: 'Allow',
      cancel: 'Deny',
      danger: false,
    }),
    onChange: (info) => {
      if (info.event === 'join') toast(info.remotes > 1 ? `Remote connected (${info.remotes} remotes)` : 'Remote connected');
      else if (info.event === 'leave') toast('Remote disconnected');
      renderRemoteDialog();
    },
  });

  function broadcastState() {
    link.send({
      type: 'state',
      active: remoteView.hidden && !isEditorOpen(),
      playing: playing || !!countdownTimer,
      mode: settings.mode,
      speed: settings.speed,
      fontSize: settings.fontSize,
      progress: prompter.progressRatio(),
      title: (current() && current().title.trim()) || 'Untitled script',
    });
  }
  setInterval(() => { if (remoteView.hidden) broadcastState(); }, 500);

  // ---- phone / tablet remote dialog

  const remoteDialog = $('#remote-dialog');
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.protocol === 'file:';

  function openPhoneRemote() {
    link.startRoom();
    renderRemoteDialog();
    if (!remoteDialog.open) remoteDialog.showModal();
  }

  function renderRemoteDialog() {
    if (!remoteDialog) return;
    const { status, code, remotes } = { status: link.status, code: link.code, remotes: link.remotes };
    $('#remote-code').textContent = code ? window.OpenCueLink.formatCode(code) : '— — —';
    const url = link.remoteUrl;
    $('#remote-link').textContent = url;
    const qrBox = $('#remote-qr');
    if (url && qrBox.dataset.url !== url && typeof window.qrcode === 'function') {
      const qr = window.qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      qrBox.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
      qrBox.dataset.url = url;
    }
    const text = {
      connecting: 'Getting a room ready…',
      ready: remotes ? `${remotes} remote${remotes === 1 ? '' : 's'} connected` : 'Ready. Waiting for a remote to join',
      offline: 'Can’t reach the pairing service. Check the internet connection; retrying…',
      unavailable: 'The phone remote couldn’t load in this browser.',
      off: '',
    }[status] || '';
    const st = $('#remote-status');
    st.textContent = text;
    st.className = 'remote-status ' + (status === 'ready' ? (remotes ? 'live' : 'ready') : status);
    const note = $('#remote-note');
    note.hidden = !isLocalHost;
    note.textContent = isLocalHost
      ? 'This copy is running from this computer, so a phone can’t open the link. The phone remote works once OpenCue is hosted (for example on GitHub Pages). For now, use “Open on this computer”.'
      : '';
  }

  $('#remote-newcode').addEventListener('click', () => {
    link.rotateCode();
    toast('New room code. Remotes using the old code were disconnected.');
    renderRemoteDialog();
  });
  $('#remote-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(link.remoteUrl);
      toast('Remote link copied');
    } catch (_) {
      toast('Couldn’t copy. Select the link and copy it instead.', 3500, 'warn');
    }
  });
  $('#remote-window').addEventListener('click', () => { remoteDialog.close(); openRemote(); });
  link.resume();

  // ---------------------------------------------------------------- keyboard

  // When Space starts or pauses the prompter while a button has focus, swallow
  // the click that the browser would otherwise also send to that button.
  let swallowClick = null;
  document.addEventListener('click', (e) => {
    if (swallowClick && e.detail === 0 && e.target === swallowClick.el && performance.now() < swallowClick.until) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
    swallowClick = null;
  }, true);

  document.addEventListener('keydown', (e) => {
    if (dlg.open) return;
    if (!remoteView.hidden) {
      if (e.key === 'Escape' && !(e.target instanceof Element && e.target.closest('input'))) closeRemoteView();
      return;
    }
    if (isEditorOpen()) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); presentScript(editingId); }
      else if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
      return;
    }
    if (isSidebarOpen()) {
      if (e.key === 'Escape') { e.preventDefault(); setSidebar(false); $('#tb-library').focus({ preventScroll: true }); }
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    const k = e.key;
    if (k === 'Escape') {
      if (target && target.matches('input[type="search"]') && target.value) return; // let the field clear itself
      e.preventDefault();
      if (openPop) closePops({ focus: true });
      else if (isSettingsOpen()) closeSettings();
      return;
    }
    if ((target && target.closest('input, select, textarea, .drawer, .popover, .menu')) || e.ctrlKey || e.metaKey || e.altKey) return;
    let handled = true;
    if (k === ' ' || k === 'k') {
      if (k === ' ' && target && target.closest('button')) swallowClick = { el: target.closest('button'), until: performance.now() + 600 };
      togglePlay();
    }
    else if (k === 'ArrowUp') settings.mode === 'auto' ? changeSpeed(0.5) : prompter.nudgeLines(-1);
    else if (k === 'ArrowDown') settings.mode === 'auto' ? changeSpeed(-0.5) : prompter.nudgeLines(1);
    else if (k === 'ArrowLeft') prompter.nudgeLines(-1);
    else if (k === 'ArrowRight') prompter.nudgeLines(1);
    else if (k === 'PageUp') prompter.nudge(-stage.clientHeight * 0.6);
    else if (k === 'PageDown') prompter.nudge(stage.clientHeight * 0.6);
    else if (k === 'Home') resetToTop();
    else if (k === '+' || k === '=') changeFont(1);
    else if (k === '-' || k === '_') changeFont(-1);
    else if (k === '[') changeWidth(-5);
    else if (k === ']') changeWidth(5);
    else if (k === 'm') toggleMirror();
    else if (k === 'f') toggleFullscreen();
    else if (k === 's') toggleSettings({ focusSearch: true });
    else handled = false;
    if (handled) {
      e.preventDefault();
      hideTip();
      showControls();
    }
  });

  // ---------------------------------------------------------------- toasts

  let toastTimer = 0;
  function toast(msg, ms = 3000, kind = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.hidden = true;
    void el.offsetWidth; // restart the entrance animation
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms);
  }

  // ---------------------------------------------------------------- install as an app

  // The service worker lets the installed app open without internet. Browsers only
  // allow it on https:// or localhost.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || isLocalHost) && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* still works, just not offline */ });
  }

  // Chrome and Edge offer installation; show our own button for it. Safari users
  // use File > Add to Dock (Mac) or Share > Add to Home Screen (iPhone, iPad).
  const installBtn = $('#install-btn');
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    installBtn.hidden = false;
  });
  installBtn.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    installBtn.hidden = true;
    if (outcome === 'accepted') toast('OpenCue is installed. Open it from your Dock, Start menu or desktop.', 5000);
  });
  window.addEventListener('appinstalled', () => { installBtn.hidden = true; });

  // ---------------------------------------------------------------- boot

  buildSettings();
  applySettings();
  document.body.classList.add('prompter-open');
  loadIntoPrompter();
  renderList();
  updatePlayUI();
  requestWakeLock();
  routeFromHash(); // a QR link or #remote opens straight into the Remote tab
  setInterval(() => { if (isSidebarOpen() && document.visibilityState === 'visible') renderList(); }, 60000);
})();
