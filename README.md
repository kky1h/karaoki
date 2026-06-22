# KaraOki

A dependency-free, one-page browser karaoke studio with multi-input/output routing, a low-latency Web Audio vocal chain, MP3 playback, and CD+G lyric rendering.

## Run locally

```bash
npm run dev
```

Open `http://127.0.0.1:4173`. Microphone and output-device selection require a secure context; localhost qualifies. Chrome or Edge currently provides the broadest `setSinkId()` support for selecting output devices.

The default command uses the included PowerShell server on Windows. `npm run dev:node` is also available in environments where Node can resolve the project path normally.

## Audio design

- The `AudioContext` requests the `interactive` latency class.
- Capture disables echo cancellation, noise suppression, and automatic gain control to minimize processing latency and preserve the vocal signal.
- Up to three microphone streams feed one shared effects bus.
- Clarity (high-pass filter), Smooth (gentle compressor), Space (convolution reverb), and Echo (short slapback delay) are independently switchable, with one master toggle.
- Audio uses the operating system's default speaker through one direct `AudioContext` output.
- Low-latency processing is always enabled and bypasses compressor look-ahead.
- One master output slider and mute control manage the complete karaoke mix.

Use headphones while monitoring a live microphone. Browser audio cannot guarantee a specific end-to-end latency because the operating system, audio driver, Bluetooth codec, and output hardware remain in the path.
