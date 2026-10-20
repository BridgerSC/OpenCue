# OpenCue

A free, open-source teleprompter that runs in your browser. It follows your voice as you read, scrolls at a steady speed, or lets you scroll by hand. It can also record you on camera while you read.

No accounts, no build step and no server. Your scripts stay in your browser's local storage.

## Features

- **Voice tracking.** OpenCue listens while you read and keeps your current line on the eyeline. Pause and it waits for you. Skip ahead or go back and it catches up. Words you've already said are dimmed and the last one you said is highlighted.
- **Auto-scroll** at an adjustable speed, plus a **manual** mode for an operator (mouse wheel, touch drag, arrow keys).
- **Everything in one window.** The prompter is the home screen. **Scripts** (top left) slides in your library, where each script has **Edit**, which opens a clean editor in a pop-up, and **Present**.
- **Script library** with search, autosave, word count and an estimated reading time. You can import `.txt`/`.md` files, export scripts, and back up or restore everything as JSON.
- **Simple markup:** `[stage directions]` are shown but not read, `# Headings` mark sections, and `*emphasis*` highlights words. A small toolbar above the editor inserts or wraps each of these at the cursor (`Ctrl+B` for emphasis).
- **Display options:** text size, line-height presets, script width, horizontal position, font, alignment, ALL CAPS, colors and presets, and an eyeline with an adjustable position and color.
- **Mirror mode** (horizontal and/or vertical) for beam-splitter teleprompter rigs.
- **Camera preview and recording**, as a small preview or behind the text. Pick the camera and microphone in Settings, and use "Check devices" for a live preview and a mic level meter. Takes are saved to your downloads as `.webm` or `.mp4`.
- **Floating control bar** with Start/Pause, restart, a mode switcher, a speed stepper in Auto mode, a Layout popover and a progress track. It hides while you're running and comes back when you move the mouse.
- **Searchable settings drawer** grouped into collapsible sections: Scrolling, Typography, Layout, Display, Camera & mic, Voice, Behavior and Keyboard shortcuts.
- **Phone or tablet remote, built in.** Press **Remote** in the prompter's bar and scan the QR code; the phone opens OpenCue's Remote tab already paired. Or, on the phone, open **Scripts**, then **Use this device as a remote**, and type the 6-character room code, and the presenter taps Allow. The same tab also works as a second window on the same computer. Remotes get status only, never the script.
- **Installable app** on Mac, Windows, iPad and iPhone (it's a PWA). The installed app opens offline.
- A countdown, a timer, fullscreen, and a screen wake lock.
- Click any word to jump there.
- Works offline: the Inter typeface is bundled in `css/fonts/` (SIL Open Font License, see `css/fonts/OFL.txt`).

## Running it

Open `index.html` in a browser. That's it.

Some browsers only allow microphone and camera access over `http://localhost` or HTTPS. If they're blocked from a `file://` URL, serve the folder:

```bash
npx serve .
```

or

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>. To host it publicly, any static host works (GitHub Pages, Netlify, Cloudflare Pages).

## Keyboard shortcuts (prompter)

| Key | Action |
| --- | --- |
| `Space` | Start / pause |
| `↑` `↓` | Speed (Auto mode), or scroll one line |
| `←` `→` | Scroll one line |
| `PgUp` `PgDn` | Jump back / ahead |
| `Home` | Back to top |
| `+` `-` | Text size |
| `[` `]` | Script width |
| `M` | Mirror |
| `C` / `R` | Camera / record |
| `F` | Fullscreen |
| `S` | Settings |
| `Esc` | Close a menu, Settings, the Scripts panel or the editor |

In the editor, `Ctrl+Enter` (`⌘+Enter` on a Mac) presents the script and `Ctrl+B` (`⌘+B`) wraps the selection in `*emphasis*`. Hover any control in the prompter to see its shortcut.

## Browser support

| | Voice tracking | Auto / manual | Recording |
| --- | --- | --- | --- |
| Chrome, Edge (desktop and Android) | ✅ | ✅ | ✅ |
| Safari (macOS, iOS) | ✅ | ✅ | ✅ (mp4) |
| Firefox | ❌ (no Web Speech API) | ✅ | ✅ |

Voice tracking uses the browser's built-in [Web Speech API](https://developer.mozilla.org/docs/Web/API/SpeechRecognition). **Privacy note:** in Chrome and Edge, the browser sends microphone audio to its vendor's speech service to transcribe it, so voice mode needs an internet connection. Safari may transcribe on the device. OpenCue shows a one-time notice about this before Voice mode is first used, and defaults to Auto.

## Security and privacy

- **No server, no accounts.** Scripts live only in each person's browser (`localStorage`) and never leave the device. Backups are files the user downloads.
- **Phone remote.** Pairing goes through the public [PeerJS](https://peerjs.com) server, which introduces the two devices and sees their IP addresses and the room ID. After that, traffic is a direct WebRTC connection, encrypted with DTLS, or goes through PeerJS's relay when a network blocks direct connections.
  - Remotes receive status only: title, mode, speed, text size, progress, and playing/recording.
  - Incoming messages must be JSON, are checked against a fixed command list, and are rate limited.
  - The QR link carries a 128-bit secret. A typed room code needs the presenter's approval.
  - "New code" disconnects everyone.
  - A remote can't switch the camera on.
- **Hardening.** A Content Security Policy allows only OpenCue's own scripts, and the app refuses to run inside a frame.
- **Hosting on GitHub Pages:** give OpenCue its own origin. Every Pages site under one `<account>.github.io` shares an origin, and with it localStorage, so a dedicated GitHub organization or a custom subdomain keeps other sites from reading scripts. Deploy only the files from `node tools/make-upload.js`, which leaves out the test pages.

## How voice tracking works

The script is split into words, and each word is normalized: lowercase, no punctuation, no accents, and small numbers spelled out. The recognizer's latest ~8 words are aligned backwards against the script near your current position. The alignment tolerates skipped, added and misheard words, and it also accepts partial words from the recognizer's interim results.

A move only counts when there's enough evidence:

- 1 matching word to advance a few words
- 2 to jump up to ~12 words ahead
- 3 to leap further or to go backwards

That keeps common words like "the" from making the prompter jump around. The logic is in [`js/tracker.js`](js/tracker.js) and has no dependencies, so it's easy to unit-test (`node test/tracker.test.js`).

## Testing voice tracking with real speech

`test/fixtures/transcripts` holds 22 recorded speech-recognition sessions: everything the recognizer said, interim guesses included, with timestamps.

- **15 human readings** of the Gettysburg Address from LibriVox's [150th-anniversary project](https://librivox.org/the-gettysburg-address-150th-anniversary-by-abraham-lincoln/) (public domain). Each includes the spoken LibriVox intro and outro, which aren't in the script.
- **7 synthesized sessions** of the Gettysburg Address and JFK's 1961 inaugural address: clean, fast and slow reads, a presenter who ad-libs, flubs and restarts a line, skips a section and takes an aside, and one who paraphrases. These come with exact word timings as ground truth.

The transcripts come from Windows' built-in dictation recognizer, which is much less accurate than the ones in Chrome or Safari, so they're a pessimistic test.

```bash
node test/replay.test.js
```

This replays every session through the tracker the way the browser would. It fails if the prompter falls off the reader's line, runs ahead of them, or stalls.

```bash
node test/replay.js --trace
```

This prints a detailed score table, including how accurate the recognizer itself was on each session.

To watch a session drive the real app, serve the folder over `http://localhost` and open `test/live-replay.html`. To regenerate the fixtures on Windows (needs ffmpeg), run `node test/speech/build.js <work-dir> <librivox-mp3-dir>`.

## Project layout

```
index.html        app shell
manifest.webmanifest, sw.js, icons/   install-as-an-app support and offline cache
css/style.css     all styles, built on the design tokens at the top of the file
css/fonts/        self-hosted Inter (variable woff2) and its OFL license
js/parser.js      script markup parser + word normalization
js/tracker.js     voice position tracker
js/voice.js       Web Speech API wrapper with auto-restart
js/prompter.js    the scrolling display
js/app.js         editor, settings, playback, camera, remote, shortcuts
js/link.js        remote link: room codes, pairing, message checks (shared by both pages)
js/remote.js      the Remote tab (phone/tablet by room code or QR, or another window)
js/vendor/        PeerJS and qrcode-generator, copied unmodified (see its README)
tools/make-upload.js   copies just the files the live site needs into upload/
test/             unit tests, speech replay tests and fixtures, live-replay page
test/speech/      Windows tooling that generates the speech fixtures
```

## Ideas for contributions

- A self-hosted PeerJS server option, so the phone remote doesn't depend on the public one
- Offline speech recognition (e.g. Vosk or Whisper in WebAssembly) for private, offline voice tracking
- Rich-text editor and `.docx` / Google Docs import
- Recording with the script burned in, or with background blur
- Better tokenization for languages written without spaces (Chinese, Japanese, Thai)

## License

MIT. See [LICENSE](LICENSE).
