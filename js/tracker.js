/* OpenCue — voice position tracker.
 *
 * Given the last few words the speech recognizer heard, find where in the script
 * the speaker is. Candidate positions are script words that match one of the
 * last two heard words (the very last one is often a half-recognized interim
 * word). Each candidate is scored by a weighted alignment of the heard words
 * against the script just before it: common words like "the" count for less
 * than distinctive ones, and skipping script words between matches costs more
 * than a misheard word. Moves need more evidence the farther they go, and going
 * backwards needs more than going forwards.
 *
 * If nothing near the current position matches for a few updates (the speaker
 * skipped a section, or the recognizer is struggling), the tracker searches far
 * ahead with a bar that lowers the longer it stays lost, and the whole script
 * with a high bar.
 *
 * Tuned against recorded sessions in test/fixtures (run `node test/replay.js`).
 */
(function (root) {
  'use strict';

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function similar(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const la = a.length, lb = b.length;
    const shorter = Math.min(la, lb), longer = Math.max(la, lb);
    // Interim results often cut words short ("intern" for "international").
    if (shorter >= 4 && (a.startsWith(b) || b.startsWith(a))) return true;
    if (longer < 5) return false; // "hand" vs "and" are different words
    const tolerance = longer >= 8 ? 2 : 1;
    if (longer - shorter > tolerance) return false;
    return levenshtein(a, b) <= tolerance;
  }

  const COMMON = new Set(('a an the of to and in on at is it its we our us you your i me my he she they them their ' +
    'this that these those for be by as or but not no with from are was were will would can could shall should may ' +
    'might must have has had do does did so all who whom which what here there then than if into upon one').split(' '));
  const weightOf = (w) => (COMMON.has(w) || w.length <= 2 ? 0.4 : 1);

  const DEFAULTS = {
    lookBehind: 40,
    lookAhead: 60,
    skipCost: 0.25,      // script word jumped over between matches
    extraCost: 0.15,     // heard word that is not in the script
    substCost: 0.05,     // heard word in place of a script word (misrecognition)
    lostAfter: 3,        // failed updates before the wider searches start
    recoverAhead: 250,   // how far ahead to look while lost
    recoverStart: 3.2,   // evidence needed for a far forward jump when first lost...
    recoverFloor: 2,     // ...lowering to this the longer it stays lost
    recoverStep: 0.1,
    recoverGlobal: 4,    // evidence needed to jump anywhere else in the script
  };

  // Evidence needed to move from the current position to `ahead` words away
  // (1 = the next word, 0 = stay, negative = backwards).
  function required(ahead) {
    if (ahead === 0 || ahead === 1) return 0.4;
    if (ahead > 1 && ahead <= 3) return 1;
    if (ahead > 3 && ahead <= 12) return 1.8;
    if (ahead > 12) return 3;
    if (ahead >= -12) return 3;
    return 3.8;
  }

  class Tracker {
    constructor(words, options) {
      this.words = words || [];
      this.weights = this.words.map(weightOf);
      this.opts = Object.assign({}, DEFAULTS, options);
      this.pos = 0;  // index of the next word the speaker is expected to say
      this.lost = 0; // consecutive updates with no acceptable match
    }

    reset(pos) {
      this.pos = Math.max(0, Math.min(pos || 0, this.words.length));
      this.lost = 0;
    }

    // spoken: normalized words, most recent last. Returns the new position, or null if unchanged.
    update(spoken) {
      const n = this.words.length;
      const o = this.opts;
      if (!spoken || !spoken.length || !n) return null;
      const near = (ahead) => required(ahead);
      let best = this.search(spoken, this.pos - o.lookBehind, this.pos + o.lookAhead, near);
      if (!best && this.lost >= o.lostAfter) {
        const bar = Math.max(o.recoverFloor, o.recoverStart - o.recoverStep * (this.lost - o.lostAfter));
        best = this.search(spoken, this.pos, this.pos + o.recoverAhead, () => bar) ||
          this.search(spoken, 0, n - 1, () => o.recoverGlobal);
      }
      if (!best) {
        this.lost++;
        return null;
      }
      this.lost = 0;
      const next = best.j + 1;
      if (next === this.pos) return null;
      this.pos = next;
      return next;
    }

    search(spoken, lo, hi, need) {
      const W = this.words;
      lo = Math.max(0, lo);
      hi = Math.min(W.length - 1, hi);
      const last = spoken[spoken.length - 1];
      const prev = spoken.length > 1 ? spoken[spoken.length - 2] : null;
      let best = null;
      for (let j = lo; j <= hi; j++) {
        if (!similar(last, W[j]) && !(prev && similar(prev, W[j]))) continue;
        const evidence = this.align(spoken, j);
        const ahead = j - (this.pos - 1);
        if (evidence < need(ahead)) continue;
        const dist = ahead >= 0 ? ahead : -ahead * 3;
        const score = evidence - dist * 0.03;
        if (!best || score > best.score) best = { j, score };
      }
      return best;
    }

    // Weighted alignment of the heard words with the script ending at word j,
    // where W[j] must match one of the last two heard words. Unmatched words
    // before the first match are free.
    align(spoken, j) {
      const W = this.words, wt = this.weights, o = this.opts;
      const m = spoken.length;
      const L = Math.min(j, m + 4);     // script words before the anchor
      const s0 = j - L;
      // dp[a][b]: best score aligning spoken[0..a) with W[s0..s0+b)
      const dp = [];
      for (let a = 0; a <= m; a++) dp.push(new Float64Array(L + 1));
      for (let a = 1; a <= m; a++) {
        for (let b = 1; b <= L; b++) {
          let v = Math.max(0, dp[a - 1][b] - o.extraCost, dp[a][b - 1] - o.skipCost, dp[a - 1][b - 1] - o.substCost);
          if (similar(spoken[a - 1], W[s0 + b - 1])) v = Math.max(v, dp[a - 1][b - 1] + wt[s0 + b - 1]);
          dp[a][b] = v;
        }
      }
      let best = 0;
      if (similar(spoken[m - 1], W[j])) best = dp[m - 1][L] + wt[j];
      if (m > 1 && similar(spoken[m - 2], W[j])) best = Math.max(best, dp[m - 2][L] - o.extraCost + wt[j]);
      return best;
    }
  }

  const api = { Tracker, similar, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenCueTracker = api;
})(typeof window !== 'undefined' ? window : globalThis);
