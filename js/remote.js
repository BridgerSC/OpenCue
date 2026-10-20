/* OpenCue — the Remote tab. Controls a prompter on another device (paired by
 * room code or QR link, #remote=K7P3QX.<secret>) or in another window of this
 * browser (#remote). See js/link.js for the connection and its safety checks.
 * js/app.js opens and closes it; nothing connects until it's opened. */
(function () {
  'use strict';

  const { Client, cleanCode, formatCode } = window.OpenCueLink;
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
  document.querySelectorAll('#remote-view [data-ri]').forEach((el) => { el.outerHTML = svg(el.dataset.ri); });

  const STATUS_TEXT = {
    connecting: ['Connecting…', (c) => `Connecting to room ${c}`, 'Hold on a moment.'],
    reconnecting: ['Reconnecting…', (c) => `Reconnecting to room ${c}`, 'The connection dropped. Trying again…'],
    connected: ['Connected', (c) => `Connected to room ${c}`, 'Waiting for the prompter…'],
    'not-found': ['Not found', (c) => `No prompter is using ${c}`, 'Check the code on the prompter (the Remote button in its control bar). This keeps trying.'],
    pending: ['Waiting…', () => 'Waiting to be let in', 'Ask the person at the prompter to choose Allow.'],
    denied: ['Not allowed', () => 'The prompter didn’t let this remote in', 'Ask for a new code, or scan the QR code on the prompter.'],
    offline: ['Offline', () => 'Can’t reach the pairing service', 'Check this device’s internet connection. Retrying…'],
    unavailable: ['Unavailable', () => 'The remote couldn’t start in this browser', 'Try Chrome, Edge or Safari.'],
  };
  const JOIN_TEXT = 'Open the prompter, press Remote in its control bar, and scan the QR code with this device’s camera. Or type the room code here.';

  let client = null;
  let room = null;
  let timer = 0;
  let lastSeen = 0;
  let linkStatus = 'local';

  function setToggle(on) {
    $('rc-toggle-icon').innerHTML = svg(on ? 'pause' : 'play');
    $('rc-toggle-label').textContent = on ? 'Pause' : 'Start';
  }

  function setPill(text, cls) {
    const el = $('rc-status');
    el.textContent = text;
    el.classList.toggle('live', cls === 'live');
    el.classList.toggle('ready', cls === 'ready');
  }

  function render(s) {
    const fresh = s && Date.now() - lastSeen < 2500;
    if (!fresh) {
      $('rc-controls').hidden = true;
      $('rc-offline').hidden = false;
      $('rc-open').hidden = true;
      $('rc-title').textContent = 'Not connected';
      $('rc-progress').style.width = '0%';
      const t = room && STATUS_TEXT[linkStatus];
      if (t) {
        setPill(t[0], linkStatus === 'connected' ? 'ready' : '');
        $('rc-offline-title').textContent = t[1](formatCode(room.code));
        $('rc-offline-msg').textContent = t[2];
        $('rc-join').hidden = true;
      } else {
        setPill('Not connected', '');
        $('rc-offline-title').textContent = 'Connect to a prompter';
        $('rc-offline-msg').textContent = JOIN_TEXT;
        $('rc-join').hidden = false;
      }
      return;
    }
    $('rc-title').textContent = s.title || 'OpenCue';
    $('rc-offline').hidden = s.active;
    $('rc-controls').hidden = !s.active;
    if (!s.active) {
      $('rc-offline-title').textContent = 'The prompter is in the editor';
      $('rc-offline-msg').textContent = 'Start prompting from here, or press Present on the prompter.';
      $('rc-join').hidden = true;
      $('rc-open').hidden = false;
    }
    setPill(s.active ? (s.playing ? 'Running' : 'Paused') : 'In editor', s.playing ? 'live' : 'ready');
    $('rc-progress').style.width = Math.round(s.progress * 100) + '%';
    setToggle(s.playing);
    $('rc-speed').textContent = Math.round(s.speed * 10) / 10;
    $('rc-size').textContent = s.fontSize;
    const rec = $('rc-record');
    rec.classList.toggle('on', s.recording);
    $('rc-record-label').textContent = s.recording ? 'Stop' : 'Record';
    rec.querySelector('svg').outerHTML = svg(s.recording ? 'stop' : 'record');
    document.querySelectorAll('#rc-controls [data-cmd="mode"]').forEach((b) => {
      const on = b.dataset.value === s.mode;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  // room: { code, secret } to pair with another device, or null for this computer.
  function open(r) {
    close();
    room = r || null;
    lastSeen = 0;
    linkStatus = room ? 'connecting' : 'local';
    client = new Client({
      onState: (s) => { lastSeen = Date.now(); render(s); },
      onStatus: (st) => { linkStatus = st; if (st !== 'connected') lastSeen = 0; render(null); },
    });
    $('rc-room').hidden = !room;
    $('rc-room-code').textContent = room ? formatCode(room.code) : '';
    $('rc-join-error').hidden = true;
    if (room) client.connectRoom(room);
    else client.connectLocal();
    timer = setInterval(() => {
      if (lastSeen && Date.now() - lastSeen > 2500) { lastSeen = 0; render(null); }
      if (!lastSeen && !room && client) client.send('hello');
    }, 1000);
    setToggle(false);
    render(null);
  }

  function close() {
    clearInterval(timer);
    if (client) client.destroy();
    client = null;
  }

  // Joining by typed code or switching code keeps the address in step, so a reload rejoins.
  function joinRoom(r) {
    history.replaceState(null, '', r ? `#remote=${r.code}` : '#remote');
    open(r);
  }

  $('remote-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b && client) client.send(b.dataset.cmd, b.dataset.value);
  });
  $('rc-join').addEventListener('submit', (e) => {
    e.preventDefault();
    const code = cleanCode($('rc-join-code').value);
    $('rc-join-error').hidden = !!code;
    if (code) joinRoom({ code, secret: null });
  });
  $('rc-join-code').addEventListener('input', () => { $('rc-join-error').hidden = true; });
  $('rc-change').addEventListener('click', () => joinRoom(null));

  window.OpenCueRemote = { open, close };
})();
