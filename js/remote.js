/* OpenCue Remote — controls a prompter on this computer (another window of the
 * same browser) or, with a room code in the address (remote.html#K7P3QX), a
 * prompter on another device. See js/link.js. */
(function () {
  'use strict';

  // Never run inside another site's frame (clickjacking).
  if (window.top !== window.self) {
    document.documentElement.hidden = true;
    throw new Error('OpenCue cannot run inside a frame');
  }

  const { Client, cleanCode, formatCode, parseRoom } = window.OpenCueLink;
  const $ = (id) => document.getElementById(id);

  const ICONS = {
    play: '<path d="M7.5 5.2v13.6a1 1 0 0 0 1.53.85l10.9-6.8a1 1 0 0 0 0-1.7L9.03 4.35A1 1 0 0 0 7.5 5.2z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6" y="4.5" width="4.25" height="15" rx="1.25" fill="currentColor" stroke="none"/><rect x="13.75" y="4.5" width="4.25" height="15" rx="1.25" fill="currentColor" stroke="none"/>',
    up: '<path d="M6 15l6-6 6 6"/>',
    down: '<path d="M6 9l6 6 6-6"/>',
    restart: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    mirror: '<path d="M12 3v18" stroke-dasharray="2 2.6"/><path d="M8.5 7.5L4 12l4.5 4.5z"/><path d="M15.5 7.5L20 12l-4.5 4.5z"/>',
    record: '<circle cx="12" cy="12" r="6.5" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
  document.querySelectorAll('[data-i]').forEach((el) => { el.outerHTML = svg(el.dataset.i); });
  const setToggle = (on) => {
    $('toggle-icon').innerHTML = svg(on ? 'pause' : 'play');
    $('toggle-label').textContent = on ? 'Pause' : 'Start';
  };
  setToggle(false);

  let hash = location.hash;
  try { hash = decodeURIComponent(hash); } catch (_) { /* malformed address: treat as no room */ }
  const room = parseRoom(hash);   // { code, secret } from a QR link, { code, secret: null } if typed
  const code = room && room.code;
  let lastSeen = 0;
  let linkStatus = code ? 'connecting' : 'local';

  const client = new Client({
    onState: (s) => {
      lastSeen = Date.now();
      render(s);
    },
    onStatus: (st) => {
      linkStatus = st;
      if (st !== 'connected') lastSeen = 0;
      render(null);
    },
  });

  function setPill(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.classList.toggle('live', cls === 'live');
    el.classList.toggle('ready', cls === 'ready');
  }

  function render(s) {
    const fresh = s && Date.now() - lastSeen < 2500;
    if (!fresh) {
      $('controls').hidden = true;
      $('offline').hidden = false;
      $('open-btn').hidden = true;
      $('title').textContent = 'Not connected';
      $('progress').style.width = '0%';
      const roomText = {
        connecting: ['Connecting…', `Connecting to room ${formatCode(code)}`, 'Hold on a moment.'],
        reconnecting: ['Reconnecting…', `Reconnecting to room ${formatCode(code)}`, 'The connection dropped. Trying again…'],
        connected: ['Connected', `Connected to room ${formatCode(code)}`, 'Waiting for the prompter…'],
        'not-found': ['Not found', `No prompter is using ${formatCode(code)}`, 'Check the code on the prompter (Settings, then Behavior, then Pair a remote). This page keeps trying.'],
        pending: ['Waiting…', 'Waiting to be let in', 'Ask the person at the prompter to choose Allow.'],
        denied: ['Not allowed', 'The prompter didn’t let this remote in', 'Ask for a new code, or scan the QR code on the prompter.'],
        offline: ['Offline', 'Can’t reach the pairing service', 'Check this device’s internet connection. Retrying…'],
        unavailable: ['Unavailable', 'The remote couldn’t start in this browser', 'Try Chrome or Safari.'],
      }[linkStatus];
      if (code && roomText) {
        setPill(roomText[0], linkStatus === 'connected' ? 'ready' : '');
        $('offline-title').textContent = roomText[1];
        $('offline-msg').textContent = roomText[2];
        $('join').hidden = true;
      } else {
        setPill('Not connected', '');
        $('offline-title').textContent = 'Connect to a prompter';
        $('offline-msg').textContent = 'On the prompter, open Settings, then Behavior, then Pair a remote. Scan its QR code, or type the room code here.';
        $('join').hidden = false;
      }
      return;
    }
    $('title').textContent = s.title || 'OpenCue';
    $('offline').hidden = s.active;
    $('controls').hidden = !s.active;
    if (!s.active) {
      $('offline-title').textContent = 'The prompter is in the editor';
      $('offline-msg').textContent = 'Start prompting from here, or press Present on the prompter.';
      $('join').hidden = true;
      $('open-btn').hidden = false;
    }
    setPill(s.active ? (s.playing ? 'Running' : 'Paused') : 'In editor', s.playing ? 'live' : 'ready');
    $('progress').style.width = Math.round(s.progress * 100) + '%';
    setToggle(s.playing);
    $('speed').textContent = Math.round(s.speed * 10) / 10;
    $('size').textContent = s.fontSize;
    $('record').classList.toggle('on', s.recording);
    $('record-label').textContent = s.recording ? 'Stop' : 'Record';
    $('record').querySelector('svg').outerHTML = svg(s.recording ? 'stop' : 'record');
    document.querySelectorAll('[data-cmd="mode"]').forEach((b) => {
      const on = b.dataset.value === s.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) client.send(b.dataset.cmd, b.dataset.value);
  });

  // ---- room code entry

  $('join').addEventListener('submit', (e) => {
    e.preventDefault();
    const c = cleanCode($('join-code').value);
    $('join-error').hidden = !!c;
    if (!c) return;
    location.hash = c;
    location.reload();
  });
  $('join-code').addEventListener('input', () => { $('join-error').hidden = true; });
  $('room-change').addEventListener('click', (e) => {
    e.preventDefault();
    location.hash = '';
    location.reload();
  });

  if (code) {
    $('room-bar').hidden = false;
    $('room-code').textContent = formatCode(code);
    client.connectRoom(room);
  } else {
    client.connectLocal();
  }

  setInterval(() => {
    if (lastSeen && Date.now() - lastSeen > 2500) {
      lastSeen = 0;
      render(null);
    }
    if (!lastSeen && !code) client.send('hello');
  }, 1000);
  render(null);
})();
