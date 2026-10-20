/* OpenCue — thin wrapper around the Web Speech API that keeps listening
 * (browsers end recognition sessions after silence) and emits the most
 * recent normalized words each time the transcript changes. */
(function (root) {
  'use strict';

  const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
  const { normalize } = root.OpenCueParser;
  const TAIL = 8;
  const FATAL = new Set(['not-allowed', 'service-not-allowed', 'audio-capture', 'language-not-supported']);

  class Voice {
    static get supported() { return !!SR; }

    constructor({ onWords, onState, onError, onHeard }) {
      this.onWords = onWords || (() => {});
      this.onState = onState || (() => {});
      this.onError = onError || (() => {});
      this.onHeard = onHeard || (() => {});
      this.active = false;
      this.rec = null;
      this.lastKey = '';
      this.failures = 0;
    }

    start(lang) {
      if (!SR) return false;
      if (this.active) return true;
      this.active = true;
      this.lang = lang;
      this.failures = 0;
      this._spawn();
      return true;
    }

    stop() {
      this.active = false;
      if (this.rec) {
        const rec = this.rec;
        this.rec = null;
        try { rec.abort(); } catch (_) { /* already stopped */ }
      }
      this.onState('off');
    }

    _spawn() {
      const rec = new SR();
      rec.lang = this.lang || 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => { if (this.rec === rec) this.onState('listening'); };

      rec.onresult = (e) => {
        this.failures = 0;
        let text = '';
        for (let r = Math.max(0, e.results.length - 2); r < e.results.length; r++) {
          text += ' ' + e.results[r][0].transcript;
        }
        const words = text.split(/[\s\-–—/]+/).map(normalize).filter(Boolean).slice(-TAIL);
        const key = words.join(' ');
        if (!key || key === this.lastKey) return;
        this.lastKey = key;
        this.onHeard(text.trim());
        this.onWords(words);
      };

      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        this.failures++;
        if (FATAL.has(e.error) || this.failures > 3) {
          this.active = false;
          this.onError(e.error);
        }
      };

      rec.onend = () => {
        if (this.rec !== rec) return;
        if (this.active) {
          this.lastKey = '';
          setTimeout(() => { if (this.active && this.rec === rec) this._spawn(); }, 120);
        } else {
          this.rec = null;
          this.onState('off');
        }
      };

      this.rec = rec;
      try { rec.start(); } catch (_) { /* start() throws if already started */ }
    }
  }

  root.OpenCueVoice = Voice;
})(window);
