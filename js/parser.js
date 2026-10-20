/* OpenCue — script parser and word normalization.
 *
 * Script markup:
 *   blank line        new paragraph
 *   # Heading         section marker (shown small, never read aloud)
 *   [stage direction] cue shown in the prompter but skipped by voice tracking
 *   *emphasis*        highlighted words (may span several words)
 */
(function (root) {
  'use strict';

  const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];

  // Reduce a word to a form that is comparable between the script and the speech recognizer.
  function normalize(token) {
    if (token === '&') return 'and';
    let w = String(token).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/['’`]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, '');
    if (/^\d+$/.test(w) && Number(w) <= 20) w = NUMBERS[Number(w)];
    return w;
  }

  // Split "well-known" into "well-" + "known" so each half can be matched separately.
  function splitPieces(s) {
    return s.match(/[^-–—/]+[-–—/]*|[-–—/]+/g) || [];
  }

  function parse(text) {
    const blocks = [];
    const words = [];
    const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/);
    let em = false;

    for (const para of paras) {
      if (!para.trim()) continue;
      let block = null;
      for (const rawLine of para.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        if (heading) {
          blocks.push({ type: 'heading', text: heading[1].trim() });
          block = null;
          continue;
        }
        if (!block) {
          block = { type: 'para', lines: [] };
          blocks.push(block);
        }
        const tokens = [];
        const re = /\[[^\]]*\]|\S+/g;
        let m;
        while ((m = re.exec(line))) {
          const t = m[0];
          if (t.length > 1 && t[0] === '[' && t[t.length - 1] === ']') {
            tokens.push({ type: 'cue', text: t.slice(1, -1).trim() });
            continue;
          }
          let s = t;
          let endEm = false;
          if (/^\*+\S/.test(s)) { s = s.replace(/^\*+/, ''); em = true; }
          const close = /\*+([^\p{L}\p{N}*]*)$/u;
          if (close.test(s)) { s = s.replace(close, '$1'); endEm = true; }
          const isEm = em;
          if (endEm) em = false;

          splitPieces(s).forEach((piece, pi) => {
            const n = normalize(piece);
            if (n) {
              tokens.push({ type: 'word', text: piece, index: words.length, em: isEm, join: pi > 0 });
              words.push(n);
            } else {
              tokens.push({ type: 'text', text: piece, join: pi > 0 });
            }
          });
        }
        if (tokens.length) block.lines.push(tokens);
      }
      em = false;
    }
    return { blocks, words };
  }

  const api = { parse, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OpenCueParser = api;
})(typeof window !== 'undefined' ? window : globalThis);
