/* OpenCue — the scrolling prompter display.
 *
 * The text is moved with a transform rather than native scrolling so it stays
 * smooth and works the same when mirrored. `target` is where we want to be,
 * `offset` eases towards it every frame. An offset of 0 puts the first line on
 * the eyeline.
 */
(function (root) {
  'use strict';

  const { Tracker } = root.OpenCueTracker;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const SPEED_EASE = 8; // 1/s; higher settles faster
  const PACE_COAST = 1.5; // continuous voice scrolling: seconds to keep moving after the last word heard
  const PACE_LEAD = 3;    // ...and at most this many words past it

  class Prompter {
    constructor({ stage, text, eyeline, fade, progress }) {
      this.stage = stage;
      this.text = text;
      this.eyeline = eyeline;
      this.fade = fade;
      this.progress = progress;

      this.offset = 0;
      this.target = 0;
      this.maxOffset = 0;
      this.padTop = 0;
      this.playing = false;
      this.mode = 'auto';
      this.speed = 5;      // requested auto-scroll speed
      this.curSpeed = 0;   // actual speed, easing towards `speed` (or 0 when stopped)
      this.eyelinePct = 33;
      this.lineHeightPx = 80;
      this.voiceFollow = 8; // Voice mode: how fast the text glides to the reader's line (1/s)
      this.voiceLead = 0;   // Voice mode: lines the reader's line sits above the eyeline
      this.voiceStyle = 'lines'; // Voice mode: 'lines' glides line by line, 'continuous' scrolls at the reading pace
      this.listening = false;    // set by the app while Voice mode is running
      this._lines = null;        // word -> line map for continuous scrolling (rebuilt after reflow)
      this._pace = { rate: 0, lastP: 0, lastT: 0, pos: 0 }; // reading pace (words/s) and fractional position

      this.wordEls = [];
      this.tracker = new Tracker([]);
      this.readUpTo = 0;
      this.currentEl = null;
      this.onEnd = null;

      this._last = 0;
      this._applied = NaN;
      this._geom = '';      // layout fingerprint, to notice when the text reflows
      this._anchor = null;  // word on the eyeline and how far past it we are, in lines
      this._tick = this._tick.bind(this);
      requestAnimationFrame(this._tick);

      if ('ResizeObserver' in root) {
        const ro = new ResizeObserver(() => this.layout());
        ro.observe(this.stage);
        ro.observe(this.text);
      }
      if (document.fonts) document.fonts.ready.then(() => this.layout());
    }

    load(parsed) {
      const frag = document.createDocumentFragment();
      this.wordEls = [];
      for (const b of parsed.blocks) {
        if (b.type === 'heading') {
          const h = document.createElement('h2');
          h.className = 'section';
          h.textContent = b.text;
          frag.appendChild(h);
          continue;
        }
        const p = document.createElement('p');
        b.lines.forEach((tokens, li) => {
          if (li > 0) p.appendChild(document.createElement('br'));
          tokens.forEach((t, ti) => {
            if (ti > 0 && !t.join) p.appendChild(document.createTextNode(' '));
            if (t.type === 'word') {
              const s = document.createElement('span');
              s.className = t.em ? 'w em' : 'w';
              s.textContent = t.text;
              s.dataset.i = t.index;
              this.wordEls[t.index] = s;
              p.appendChild(s);
            } else if (t.type === 'cue') {
              const s = document.createElement('span');
              s.className = 'cue';
              s.textContent = t.text;
              p.appendChild(s);
            } else {
              p.appendChild(document.createTextNode(t.text));
            }
          });
        });
        frag.appendChild(p);
      }
      if (!parsed.blocks.length) {
        const p = document.createElement('p');
        p.className = 'empty';
        p.textContent = 'This script is empty. Go back to the editor and write something.';
        frag.appendChild(p);
      }
      this.text.replaceChildren(frag);
      this.tracker = new Tracker(parsed.words);
      this.readUpTo = 0;
      this.currentEl = null;
      this.playing = false;
      this.curSpeed = 0;
      this._anchor = null;
      this._lines = null;
      this._pace = { rate: 0, lastP: 0, lastT: 0, pos: 0 };
      this.offset = this.target = 0;
      this.layout();
    }

    // Apply eyeline / line height / speed. A speed change leaves the position
    // alone (the frame loop eases into the new speed); anything that reflows
    // the text is handled by layout(), which keeps the reader's place.
    configure(opts) {
      Object.assign(this, opts);
      this.layout();
    }

    layout() {
      const h = this.stage.clientHeight;
      if (!h) return;
      this.padTop = Math.round(h * this.eyelinePct / 100);
      this.text.style.paddingTop = this.padTop + 'px';
      this.text.style.paddingBottom = (h - this.padTop) + 'px';
      this.eyeline.style.top = this.padTop + 'px';
      this.fade.style.height = this.padTop + 'px';
      this.maxOffset = Math.max(0, this.text.offsetHeight - h);
      const geom = `${this.text.offsetWidth}|${this.text.offsetHeight}|${this.padTop}|${this.lineHeightPx}`;
      const reflowed = this._geom && geom !== this._geom;
      this._geom = geom;
      if (reflowed) this._lines = null;
      if (this.mode === 'voice' && this.wordEls.length) {
        this.target = this.voiceStyle === 'continuous' ? this.contTarget(this._pace.pos) : this.voiceTarget(this.anchorIndex());
      } else if (reflowed && this._anchor && this.offset > 0) {
        // Same word on the eyeline, same distance into its line, so nothing appears to jump.
        const y = this.rawWordOffset(this._anchor.i) + this._anchor.lines * this.lineHeightPx;
        const delta = clamp(y, 0, this.maxOffset) - this.offset;
        this.offset += delta;
        this.target += delta;
      }
      this.target = clamp(this.target, 0, this.maxOffset);
    }

    setMode(mode) {
      const prev = this.mode;
      this.mode = mode;
      this.playing = false;
      this.stage.classList.toggle('voice-mode', mode === 'voice');
      if (mode === 'voice' && prev !== 'voice') this.setVoicePos(Math.max(0, this.wordAtEyeline()));
      else if (mode !== 'voice') this.clearRead();
    }

    // ---- positioning helpers ----

    wordOffset(i) {
      return clamp(this.rawWordOffset(i), 0, this.maxOffset);
    }

    // Offset that centers word i's line on the eyeline (unclamped).
    rawWordOffset(i) {
      const el = this.wordEls[i];
      if (!el) return 0;
      return el.offsetTop + el.offsetHeight / 2 - (this.padTop + this.lineHeightPx / 2);
    }

    // Index of the first word whose line reaches the eyeline.
    wordAtEyeline() {
      const els = this.wordEls;
      if (!els.length) return -1;
      const y = this.offset + this.padTop;
      let lo = 0, hi = els.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (els[mid].offsetTop + els[mid].offsetHeight > y) hi = mid;
        else lo = mid + 1;
      }
      return lo;
    }

    anchorIndex() {
      return Math.min(this.readUpTo, this.wordEls.length - 1);
    }

    progressRatio() {
      return this.maxOffset ? clamp(this.offset / this.maxOffset, 0, 1) : 0;
    }

    // ---- movement ----

    nudge(px) {
      this.target = clamp(this.target + px, 0, this.maxOffset);
    }

    nudgeLines(n) {
      this.nudge(n * this.lineHeightPx);
    }

    jumpTo(i) {
      if (this.mode === 'voice') this.setVoicePos(i);
      else this.target = this.wordOffset(i);
    }

    reset() {
      this.clearRead();
      this.tracker.reset(0);
      if (this.mode === 'voice') this.setVoicePos(0);
      this.target = 0;
    }

    // ---- voice tracking ----

    voiceUpdate(words) {
      const p = this.tracker.update(words);
      if (p !== null) this.setVoicePos(p, true);
    }

    // heard: the position came from speech (feeds the reading-pace estimate),
    // rather than a click, reset or mode switch.
    setVoicePos(p, heard = false) {
      const n = this.wordEls.length;
      p = clamp(p, 0, n);
      const from = Math.min(p, this.readUpTo), to = Math.max(p, this.readUpTo);
      for (let i = from; i < to; i++) this.wordEls[i].classList.toggle('read', i < p);
      if (this.currentEl) this.currentEl.classList.remove('current');
      this.currentEl = p > 0 ? this.wordEls[p - 1] : null;
      if (this.currentEl) this.currentEl.classList.add('current');
      this.readUpTo = p;
      this.tracker.pos = p;
      this._trackPace(p, heard);
      if (!n) return;
      this.target = this.voiceStyle === 'continuous' ? this.contTarget(this._pace.pos) : this.voiceTarget(Math.min(p, n - 1));
    }

    // Measure how fast the reader is going (words per second, smoothed) so
    // continuous scrolling can glide at their pace between recognizer updates.
    _trackPace(p, heard) {
      const pace = this._pace, now = performance.now();
      const step = p - pace.lastP;
      if (heard && step > 0 && step <= 12 && pace.lastT) {
        const dt = (now - pace.lastT) / 1000;
        if (dt > 0.05 && dt < 5) {
          const inst = step / dt;
          pace.rate = pace.rate ? pace.rate * 0.7 + inst * 0.3 : inst;
        }
      }
      // A real jump (skip, re-read, click) moves straight there; small updates
      // never pull the smooth position backwards.
      if (!heard || p < pace.pos - 3 || p > pace.pos + 12) pace.pos = p;
      else pace.pos = Math.max(pace.pos, p);
      pace.lastP = p;
      pace.lastT = now;
    }

    // Voice mode is starting or stopping: restart the pace clock so a pause
    // doesn't count as reading time.
    setListening(on) {
      this.listening = on;
      this._pace.lastT = performance.now();
      this._pace.lastP = this.readUpTo;
    }

    // Continuous scrolling: the offset for a fractional word position. The
    // reader's line is centered on the eyeline halfway through it, sits half a
    // line low as they start it and half a line high as they finish, so the
    // motion is seamless from one line to the next.
    contTarget(x) {
      const n = this.wordEls.length;
      if (!n) return 0;
      const L = this._lines || (this._lines = this._buildLines());
      const i = clamp(Math.floor(x), 0, n - 1);
      const li = L.of[i];
      const start = L.start[li];
      const end = li + 1 < L.start.length ? L.start[li + 1] : n;
      const y = L.y[li];
      const next = li + 1 < L.y.length ? L.y[li + 1] : y + this.lineHeightPx;
      const prev = li > 0 ? L.y[li - 1] : y - this.lineHeightPx;
      const f = clamp((x - start) / Math.max(1, end - start), 0, 1);
      const pos = f >= 0.5 ? y + (f - 0.5) * (next - y) : y - (0.5 - f) * (y - prev);
      return clamp(pos + this.voiceLead * this.lineHeightPx, 0, this.maxOffset);
    }

    _buildLines() {
      const n = this.wordEls.length;
      const of = new Int32Array(n), start = [], y = [];
      let top = -Infinity;
      for (let i = 0; i < n; i++) {
        const t = this.wordEls[i].offsetTop;
        if (Math.abs(t - top) > 2) { start.push(i); y.push(this.rawWordOffset(i)); top = t; }
        of[i] = start.length - 1;
      }
      return { of, start, y };
    }

    // Where to scroll for word i in Voice mode: its line on the eyeline, or
    // voiceLead lines above it so more upcoming text shows below.
    voiceTarget(i) {
      return clamp(this.rawWordOffset(i) + this.voiceLead * this.lineHeightPx, 0, this.maxOffset);
    }

    clearRead() {
      for (let i = 0; i < this.readUpTo; i++) this.wordEls[i].classList.remove('read');
      if (this.currentEl) this.currentEl.classList.remove('current');
      this.currentEl = null;
      this.readUpTo = 0;
    }

    // ---- frame loop ----

    _tick(t) {
      const dt = this._last ? Math.min(0.1, (t - this._last) / 1000) : 0;
      this._last = t;
      // Ease the actual speed towards the requested one (~0.4 s to settle), so speed
      // changes, starting and pausing glide rather than jump.
      const goal = this.playing && this.mode === 'auto' ? this.speed : 0;
      this.curSpeed += (goal - this.curSpeed) * Math.min(1, dt * SPEED_EASE);
      if (Math.abs(goal - this.curSpeed) < 0.01) this.curSpeed = goal;
      if (this.curSpeed > 0 && this.mode === 'auto') {
        this.target += this.curSpeed * this.lineHeightPx * 0.06 * dt;
        if (this.target >= this.maxOffset) {
          this.target = this.maxOffset;
          this.curSpeed = 0;
          if (this.playing) {
            this.playing = false;
            if (this.onEnd) this.onEnd();
          }
        }
      }
      // Continuous voice scrolling: between recognizer updates, keep moving at the
      // reader's pace, but never more than a few words past the last word heard,
      // and coast to a stop when they pause.
      if (this.mode === 'voice' && this.voiceStyle === 'continuous' && this.wordEls.length) {
        const pace = this._pace;
        if (this.listening && pace.rate > 0) {
          const since = (performance.now() - pace.lastT) / 1000;
          const ahead = Math.min(pace.rate * Math.min(since, PACE_COAST), PACE_LEAD);
          pace.pos = Math.max(pace.pos, Math.min(pace.lastP + ahead, this.wordEls.length));
        }
        this.target = this.contTarget(pace.pos);
      }
      const diff = this.target - this.offset;
      const rate = this.mode === 'voice' ? this.voiceFollow : 8;
      this.offset = Math.abs(diff) < 0.25 ? this.target : this.offset + diff * Math.min(1, dt * rate);
      if (this.offset !== this._applied) {
        this._applied = this.offset;
        this.text.style.transform = `translate3d(0, ${(-this.offset).toFixed(2)}px, 0)`;
        if (this.progress) this.progress.style.transform = `scaleX(${this.progressRatio()})`;
        if (this.mode !== 'voice' && this.wordEls.length) {
          const i = this.wordAtEyeline();
          this._anchor = { i, lines: (this.offset - this.rawWordOffset(i)) / this.lineHeightPx };
        }
      }
      requestAnimationFrame(this._tick);
    }
  }

  root.OpenCuePrompter = Prompter;
})(window);
