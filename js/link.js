/* OpenCue — remote-control link between the prompter and remote.html.
 *
 * Two transports carry the same small messages:
 *   - Same computer: a BroadcastChannel between windows of one browser. No network.
 *   - Phone or tablet: a room code pairs the remote with the prompter over WebRTC,
 *     using PeerJS (js/vendor). The public PeerJS server only introduces the two
 *     devices (it sees the room's peer id and their network addresses); commands
 *     and status then travel directly between them, encrypted by WebRTC (DTLS),
 *     or through PeerJS's relay when a network blocks a direct connection.
 *     Nothing contacts those servers until someone opens the phone remote.
 *
 * Pairing: the QR link carries the room code plus a 128-bit secret, so a remote
 * that scanned it joins straight away. Someone who only knows the 6-character
 * code (it's shown on screen) has to be allowed in on the prompter.
 *
 * Privacy: remotes only ever receive status (title, mode, speed, text size,
 * progress, playing, recording), never script text. Everything received is
 * treated as untrusted: JSON only, checked against a fixed list, rate limited.
 */
(function (root) {
  'use strict';

  const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O or 1/I/L to misread
  const CODE_LEN = 6;                                 // 31^6 ≈ 887 million codes
  const PEER_PREFIX = 'opencue-v1-';
  const MAX_REMOTES = 4;
  const ROOM_KEY = 'opencue.room';                    // sessionStorage: survives a reload of this tab only
  const COMMANDS = new Set(['hello', 'open', 'toggle', 'faster', 'slower', 'back', 'forward', 'top', 'bigger', 'smaller', 'mirror', 'record', 'mode']);
  const MODES = new Set(['voice', 'auto', 'manual']);
  const RATE = { burst: 20, perSecond: 10 };          // per remote; more than this and it's disconnected
  const CONN_OPTS = (metadata) => ({ reliable: true, serialization: 'json', metadata });

  function makeCode() {
    const n = new Uint32Array(CODE_LEN);
    crypto.getRandomValues(n);
    let s = '';
    for (const v of n) s += ALPHABET[v % ALPHABET.length];
    return s;
  }

  function makeSecret() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const cleanSecret = (s) => (typeof s === 'string' && /^[A-Za-z0-9_-]{20,64}$/.test(s) ? s : null);

  // "k7p 3qx", "K7P-3QX" -> "K7P3QX"; null if it can't be a room code.
  function cleanCode(input) {
    const s = String(input || '').toUpperCase().replace(/[\s-]/g, '');
    if (s.length !== CODE_LEN) return null;
    for (const ch of s) if (!ALPHABET.includes(ch)) return null;
    return s;
  }
  const formatCode = (code) => (code ? `${code.slice(0, 3)} ${code.slice(3)}` : '');

  // "K7P3QX.secret" from a remote link's #hash -> { code, secret|null }, or null.
  function parseRoom(hash) {
    const [c, s] = String(hash || '').replace(/^#/, '').split('.');
    const code = cleanCode(c);
    return code ? { code, secret: cleanSecret(s) } : null;
  }

  function cleanCommand(m) {
    if (!m || typeof m !== 'object' || m.type !== 'cmd' || typeof m.cmd !== 'string' || !COMMANDS.has(m.cmd)) return null;
    if (m.cmd === 'mode') return MODES.has(m.value) ? { cmd: 'mode', value: m.value } : null;
    return { cmd: m.cmd };
  }

  function cleanState(s) {
    if (!s || typeof s !== 'object' || s.type !== 'state') return null;
    const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      type: 'state',
      active: s.active === true,
      playing: s.playing === true,
      recording: s.recording === true,
      mode: MODES.has(s.mode) ? s.mode : 'auto',
      speed: num(s.speed, 0, 100, 5),
      fontSize: num(s.fontSize, 1, 1000, 52),
      progress: num(s.progress, 0, 1, 0),
      title: typeof s.title === 'string' ? s.title.slice(0, 120) : '',
    };
  }

  function rateLimiter() {
    let tokens = RATE.burst, at = performance.now();
    return () => {
      const now = performance.now();
      tokens = Math.min(RATE.burst, tokens + ((now - at) / 1000) * RATE.perSecond);
      at = now;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    };
  }

  const hasPeer = () => typeof root.Peer === 'function';
  const NETWORK_ERRORS = new Set(['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc']);
  const closeQuietly = (conn) => { try { conn.close(); } catch (_) { /* already closed */ } };

  // ------------------------------------------------------------------ prompter side

  class Host {
    // onApproval(): Promise<boolean>, asked when a remote joins with the code but not the QR secret.
    constructor({ onCommand, onChange, onApproval }) {
      this.onCommand = onCommand || (() => {});
      this.onChange = onChange || (() => {});
      this.onApproval = onApproval || (() => Promise.resolve(false));
      this.code = null;
      this.secret = null;
      this.peer = null;
      this.status = 'off';   // off | connecting | ready | offline | unavailable
      this.conns = new Set();
      this.asking = false;
      this.idRetries = 0;
      this.channel = 'BroadcastChannel' in root ? new BroadcastChannel('opencue') : null;
      if (this.channel) {
        this.channel.onmessage = (e) => {
          const c = cleanCommand(e.data);
          if (c) this.onCommand(c);
        };
      }
    }

    get remotes() { return this.conns.size; }
    get remoteUrl() { return this.code ? `${new URL('remote.html', root.location.href).href}#${this.code}.${this.secret}` : ''; }

    // Restart a room this tab already had (after a reload), so paired phones reconnect.
    resume() {
      let saved = null;
      try { saved = parseRoom(sessionStorage.getItem(ROOM_KEY)); } catch (_) { /* storage blocked */ }
      if (saved && saved.secret) this.startRoom(saved);
    }

    startRoom(saved) {
      if (this.peer) return;
      if (!hasPeer()) { this._set('unavailable'); return; }
      if (saved) { this.code = saved.code; this.secret = saved.secret; }
      if (!this.code) { this.code = makeCode(); this.secret = makeSecret(); }
      this._remember();
      this._connect();
    }

    rotateCode() {
      this._teardown();
      this.code = makeCode();
      this.secret = makeSecret();
      this._remember();
      this.idRetries = 0;
      this._connect();
    }

    send(state) {
      if (this.channel) this.channel.postMessage(state);
      for (const conn of this.conns) if (conn.open) conn.send(state);
    }

    _remember() {
      try { sessionStorage.setItem(ROOM_KEY, `${this.code}.${this.secret}`); } catch (_) { /* storage blocked */ }
    }

    _set(status, event) {
      this.status = status;
      this.onChange({ status, code: this.code, remotes: this.conns.size, event });
    }

    _teardown() {
      for (const conn of this.conns) closeQuietly(conn);
      this.conns.clear();
      if (this.peer) {
        const p = this.peer;
        this.peer = null;
        try { p.destroy(); } catch (_) { /* already destroyed */ }
      }
    }

    _admit(conn) {
      if (this.conns.size >= MAX_REMOTES) { closeQuietly(conn); return; }
      this.conns.add(conn);
      this._set(this.status, 'join');
      this.onCommand({ cmd: 'hello' }); // the app answers with fresh state
    }

    _connect() {
      const peer = new root.Peer(PEER_PREFIX + this.code, { debug: 0 });
      this.peer = peer;
      this._set('connecting');

      peer.on('open', () => {
        if (this.peer !== peer) return;
        this.idRetries = 0;
        this._set('ready');
      });

      peer.on('connection', (conn) => {
        // JSON only: PeerJS's binary format can be crashed by a crafted message.
        if (this.peer !== peer || conn.serialization !== 'json') { closeQuietly(conn); return; }
        const trusted = cleanSecret(conn.metadata && conn.metadata.secret) === this.secret;
        const allow = rateLimiter();

        conn.on('open', async () => {
          if (trusted) { this._admit(conn); return; }
          // Code typed by hand: the presenter decides. One request at a time.
          if (this.asking || this.conns.size >= MAX_REMOTES) { conn.send({ type: 'denied' }); setTimeout(() => closeQuietly(conn), 300); return; }
          this.asking = true;
          conn.send({ type: 'pending' });
          let ok = false;
          try { ok = await this.onApproval(); } finally { this.asking = false; }
          if (!conn.open || this.peer !== peer) return;
          if (ok) this._admit(conn);
          else { conn.send({ type: 'denied' }); setTimeout(() => closeQuietly(conn), 300); }
        });
        conn.on('data', (d) => {
          if (!this.conns.has(conn)) return;
          if (!allow()) { closeQuietly(conn); return; } // flooding
          const c = cleanCommand(d);
          if (c) this.onCommand(c);
        });
        const gone = () => {
          if (this.conns.delete(conn)) this._set(this.status, 'leave');
        };
        conn.on('close', gone);
        conn.on('error', gone);
      });

      peer.on('disconnected', () => {
        // Lost the pairing server (existing remotes stay connected). Re-register the same code.
        if (this.peer !== peer || peer.destroyed) return;
        this._set('connecting');
        setTimeout(() => { if (this.peer === peer && !peer.destroyed) peer.reconnect(); }, 1500);
      });

      peer.on('error', (err) => {
        if (this.peer !== peer) return;
        if (err.type === 'unavailable-id') {
          // After a quick reload the server may still hold our id for a few seconds: retry, then give up on it.
          this._teardown();
          if (++this.idRetries <= 4) setTimeout(() => { if (!this.peer) this._connect(); }, 2500);
          else this.rotateCode();
          return;
        }
        if (NETWORK_ERRORS.has(err.type)) {
          this._teardown();
          this._set('offline');
          setTimeout(() => { if (!this.peer && this.code) this._connect(); }, 5000);
        }
      });
    }
  }

  // ------------------------------------------------------------------ remote side

  class Client {
    constructor({ onState, onStatus }) {
      this.onState = onState || (() => {});
      this.onStatus = onStatus || (() => {});
      this.room = null;
      this.peer = null;
      this.conn = null;
      this.channel = null;
      this.timer = 0;
      this.denied = false;
    }

    // Same computer: talk to OpenCue in another window of this browser.
    connectLocal() {
      if (!('BroadcastChannel' in root)) return false;
      this.channel = new BroadcastChannel('opencue');
      this.channel.onmessage = (e) => {
        const s = cleanState(e.data);
        if (s) this.onState(s, 'local');
      };
      this.channel.postMessage({ type: 'cmd', cmd: 'hello' });
      return true;
    }

    connectRoom(room) {
      this.room = room;
      if (!hasPeer()) { this.onStatus('unavailable'); return; }
      this.onStatus('connecting');
      const peer = new root.Peer({ debug: 0 });
      this.peer = peer;
      peer.on('open', () => this._dial());
      peer.on('disconnected', () => { if (!peer.destroyed && !this.denied) setTimeout(() => peer.reconnect(), 1500); });
      peer.on('error', (err) => {
        if (this.denied) return;
        if (err.type === 'peer-unavailable') { this.onStatus('not-found'); this._retry(4000); }
        else if (NETWORK_ERRORS.has(err.type)) { this.onStatus('offline'); this._retry(5000); }
      });
    }

    _retry(ms) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { if (this.peer && this.peer.open && !this.denied) this._dial(); }, ms);
    }

    _dial() {
      if (this.conn) closeQuietly(this.conn);
      const conn = this.peer.connect(PEER_PREFIX + this.room.code, CONN_OPTS(this.room.secret ? { secret: this.room.secret } : {}));
      this.conn = conn;
      conn.on('open', () => {
        if (this.conn !== conn) return;
        this.onStatus('connected');
        conn.send({ type: 'cmd', cmd: 'hello' });
      });
      conn.on('data', (d) => {
        if (this.conn !== conn) return;
        if (d && d.type === 'pending') { this.onStatus('pending'); return; }
        if (d && d.type === 'denied') { this.denied = true; this.onStatus('denied'); return; }
        const s = cleanState(d);
        if (s) this.onState(s, 'room');
      });
      conn.on('close', () => {
        if (this.conn !== conn) return;
        this.conn = null;
        if (this.denied) return;
        this.onStatus('reconnecting');
        this._retry(2000);
      });
    }

    send(cmd, value) {
      const msg = { type: 'cmd', cmd, value };
      if (!cleanCommand(msg)) return;
      if (this.conn && this.conn.open) this.conn.send(msg);
      else if (this.channel) this.channel.postMessage(msg);
    }
  }

  root.OpenCueLink = { Host, Client, cleanCode, formatCode, parseRoom, cleanCommand, cleanState, makeCode };
})(typeof window !== 'undefined' ? window : globalThis);
