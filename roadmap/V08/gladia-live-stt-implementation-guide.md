# Gladia Live STT — Implementation Guide for Electron Desktop App

> **Audience:** Claude Code / developer implementing Gladia real-time STT alongside an existing Deepgram integration in an Electron (Windows) desktop application.
> **Scope:** Session lifecycle, audio streaming, diarization, named entity recognition, sentiment analysis, Electron-specific integration patterns, coexistence with Deepgram, error handling, and billing considerations.

---

## Overview

Gladia's Live STT API v2 uses a two-step pattern: an HTTP POST to initialise the session, followed by a persistent WebSocket connection through which raw audio is streamed and transcript/intelligence messages are received. This differs from Deepgram's single-step WebSocket connect, so the provider-switching logic in the existing app requires handling the async init step before establishing the socket.

Key characteristics relevant to this use case:

- **Model:** `solaria-1` — Gladia's latest real-time model, optimised for low latency and multi-language live audio.
- **Session limit:** 3 hours per session. For longer calls, start a new session before reaching the limit and stitch results.
- **Audio intelligence (diarization, NER, sentiment):** Configured at session init and delivered via WebSocket messages and/or a final results endpoint after `stop_recording`.
- **Multi-channel support:** Multiple speakers can be sent over a single WebSocket by interleaving audio channels — ideal for capturing both sides of a call.

---

## Architecture in the Electron App

The Electron app already captures meeting audio and routes it to Deepgram. The recommended pattern to add Gladia is:

```
Main Process
  └── STTManager
        ├── DeepgramProvider   (existing)
        └── GladiaProvider     (new)
              ├── initSession()    → POST /v2/live  → returns { id, url }
              ├── GladiaSession
              │     ├── WebSocket  → wss://api.gladia.io/v2/live?token=<id>
              │     └── AudioPump  → sendAudio(chunk)
              └── ResultsStore     → accumulates transcripts + AI results
```

**Why keep API key in the Main Process:** Electron's Main Process can securely hold the Gladia API key in an environment variable and proxy the init call, then pass the `wss://` URL to the Renderer or back to the audio pipeline without exposing credentials. This matches Gladia's own security recommendation for the two-step init pattern.

---

## 1. Installation

```bash
npm install @gladiaio/sdk
```

The SDK wraps both the init REST call and the WebSocket in a single `liveSession` object. Use it instead of raw WebSocket management to get automatic reconnection and typed message handling.

---

## 2. Session Initialisation

Call `POST https://api.gladia.io/v2/live` before opening the WebSocket. All configuration is fixed at this point — you cannot change model, encoding, or intelligence features mid-session.

### Minimum config for live meeting calls

```typescript
// gladia-provider.ts — Main Process or Node context

import { GladiaClient } from "@gladiaio/sdk";

const gladiaClient = new GladiaClient({
  apiKey: process.env.GLADIA_API_KEY!,
});

const sessionConfig = {
  model: "solaria-1",

  // Audio format — must match exactly what your audio capture produces
  encoding: "wav/pcm",   // Raw PCM, no WAV headers. Also supported: "wav/alaw", "wav/ulaw"
  sample_rate: 16000,    // 16 kHz is the sweet spot: low bandwidth, good accuracy
  bit_depth: 16,
  channels: 1,           // Set to 2 if you interleave both call participants (see Section 7)

  // Language config
  language_config: {
    languages: ["en"],   // ISO 639-1. Omit to use auto-detection.
    code_switching: false, // true = detect mid-sentence language switches (small latency cost)
  },

  // What to receive over the WebSocket
  messages_config: {
    receive_partial_transcripts: true,   // Low-latency word-by-word updates
    receive_audio_events: false,         // Set true if you want silence/speech events
  },

  // Audio intelligence — all three enabled for this use case
  diarization: true,
  named_entity_recognition: true,
  sentiment_analysis: true,
};

export async function createGladiaSession() {
  const liveSession = gladiaClient.liveV2().startSession(sessionConfig);
  return liveSession; // Exposes .on(), .sendAudio(), .stopRecording()
}
```

> **Important:** `diarization`, `named_entity_recognition`, and `sentiment_analysis` are post-session features — Gladia processes them after `stop_recording` and delivers them in the final results payload via `GET /v2/live/:id`. They are NOT available as real-time WebSocket messages mid-session (unlike transcripts). Plan your UX accordingly: show live transcripts in real time, then enrich the UI with AI insights after the call ends.

---

## 3. WebSocket Event Handling

```typescript
// gladia-session-handler.ts

export function attachSessionHandlers(liveSession: any, callbacks: {
  onPartialTranscript: (text: string, channel?: number) => void;
  onFinalTranscript: (utterance: GladiaUtterance) => void;
  onSessionStarted: () => void;
  onSessionEnded: (sessionId: string) => void;
  onError: (err: Error) => void;
}) {
  liveSession.once("started", (_response: any) => {
    callbacks.onSessionStarted();
  });

  liveSession.on("message", (message: any) => {
    if (message.type !== "transcript") return;

    const { utterance, is_final } = message.data;

    if (!is_final) {
      // Partial: show live caption, do not store permanently
      callbacks.onPartialTranscript(utterance.text, utterance.channel);
      return;
    }

    // Final: store utterance, update transcript display
    callbacks.onFinalTranscript({
      id: message.data.id,
      text: utterance.text,
      start: utterance.start,         // seconds from session start
      end: utterance.end,
      language: utterance.language,
      channel: utterance.channel,     // which audio channel (speaker)
      speaker: utterance.speaker,     // set if single-channel diarization is enabled
    });
  });

  liveSession.once("ended", (ended: any) => {
    callbacks.onSessionEnded(ended?.session_id ?? "");
  });

  liveSession.on("error", (err: Error) => {
    callbacks.onError(err);
  });
}

interface GladiaUtterance {
  id: string;
  text: string;
  start: number;
  end: number;
  language: string;
  channel?: number;
  speaker?: number;
}
```

### WebSocket message types reference

| Message type | When received | Contains |
|---|---|---|
| `session_started` | Connection established | Session ID, config echo |
| `transcript` (partial) | During speech, low latency | Intermediate text, `is_final: false` |
| `transcript` (final) | After utterance boundary | Full utterance text, timestamps, channel |
| `post_processing` | After `stop_recording` | Progress of AI enrichment |
| `session_ended` | Processing complete | Summary, metadata |

---

## 4. Sending Audio

```typescript
// audio-pump.ts

export function startAudioPump(
  liveSession: any,
  audioSource: NodeJS.ReadableStream | (() => Buffer)
) {
  // If using a Node.js Readable stream (e.g., from electron's desktopCapturer pipeline):
  audioSource.on?.("data", (chunk: Buffer) => {
    liveSession.sendAudio(chunk);
  });

  // If using a polling approach (e.g., Web Audio API → IPC → Main):
  // Call liveSession.sendAudio(chunk) each time you receive a PCM chunk from the Renderer.
}
```

**Audio chunk guidelines:**

- Send chunks continuously as they arrive — do not buffer large blocks.
- Recommended chunk size: 20–100 ms of audio (320–1,600 bytes at 16 kHz / 16-bit mono).
- PCM data only — strip any WAV headers before sending.
- Silence is fine to send; Gladia's VAD (voice activity detection) handles it internally.

### Capturing meeting audio in Electron (Windows)

For Teams/Zoom/Meet, the audio is in the system loopback (WASAPI loopback on Windows). Use `desktopCapturer` or a native addon to capture it:

```typescript
// renderer.ts — Audio capture via Web Audio API + IPC

async function startSystemAudioCapture() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      // On Windows, 'default' usually includes system loopback if virtual cable is used.
      // For guaranteed loopback: use a virtual audio cable (e.g., VB-Cable) or
      // a native Node addon like node-audiorecorder with WASAPI loopback.
      echoCancellation: false,
      noiseSuppression: false, // Let Gladia's model handle noise
      sampleRate: 16000,
    },
    video: false,
  });

  const audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(1024, 1, 1);

  processor.onaudioprocess = (e) => {
    const float32 = e.inputBuffer.getChannelData(0);
    const pcm16 = float32ToPcm16(float32);
    // Send PCM chunk to Main Process via IPC
    window.electronAPI.sendAudioChunk(pcm16);
  };

  source.connect(processor);
  processor.connect(audioContext.destination);
}

function float32ToPcm16(float32Array: Float32Array): Buffer {
  const buffer = Buffer.alloc(float32Array.length * 2);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    buffer.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  return buffer;
}
```

> **Note on Windows loopback:** `desktopCapturer` in Electron does not expose system audio on Windows without a virtual audio device. The most reliable cross-platform approach is **VB-Cable** (free virtual audio cable) routed as the input source, or a native WASAPI loopback integration via a native Node addon.

---

## 5. Stopping the Session

```typescript
// Stop gracefully — triggers post-processing of AI features
await liveSession.stopRecording();

// Alternative: close the WebSocket directly with code 1000.
// Post-processing still runs server-side; results arrive via callback if configured.
```

After `stop_recording`, Gladia processes the full session audio to produce:

- Final stitched transcript
- **Diarization** — speaker attribution per utterance
- **Named Entity Recognition (NER)** — extracted entities per utterance
- **Sentiment Analysis** — sentiment per utterance/sentence

---

## 6. Fetching Final Results (Diarization, NER, Sentiment)

Fetch the enriched results after the `session_ended` event fires:

```typescript
// results-fetcher.ts

interface GladiaFinalResult {
  id: string;
  status: string;
  result: {
    transcription: {
      utterances: FinalUtterance[];
    };
  };
}

interface FinalUtterance {
  text: string;
  start: number;
  end: number;
  speaker: number;          // Diarization: 0-indexed speaker ID
  channel: number;
  language: string;
  named_entity_recognition?: {
    success: boolean;
    is_empty: boolean;
    results: NERResult[];
  };
  sentiment_analysis?: {
    success: boolean;
    results: SentimentResult[];
  };
}

interface NERResult {
  entity_kind: string;   // e.g. "person", "location", "organisation", "date", "product"
  text: string;          // The extracted entity text
  start: number;         // Char offset in utterance text
  end: number;
  confidence: number;    // 0-1
  score: number;         // Model score
}

interface SentimentResult {
  text: string;
  sentence: string;
  start: number;
  end: number;
  sentiment: "positive" | "negative" | "neutral";
  confidence: number;    // 0-1 for the winning class
  positive: number;      // Raw probability scores
  negative: number;
  neutral: number;
}

export async function fetchFinalResults(sessionId: string): Promise<GladiaFinalResult> {
  const response = await fetch(`https://api.gladia.io/v2/live/${sessionId}`, {
    method: "GET",
    headers: {
      "x-gladia-key": process.env.GLADIA_API_KEY!,
    },
  });

  if (!response.ok) {
    throw new Error(`Gladia results fetch failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

// Usage after session_ended event:
liveSession.once("ended", async (ended: any) => {
  const results = await fetchFinalResults(ended.session_id);
  const utterances = results.result.transcription.utterances;

  for (const utterance of utterances) {
    console.log(`[Speaker ${utterance.speaker}] ${utterance.text}`);

    // NER
    utterance.named_entity_recognition?.results.forEach((ner) => {
      console.log(`  → Entity: "${ner.text}" (${ner.entity_kind}, conf: ${ner.confidence})`);
    });

    // Sentiment
    utterance.sentiment_analysis?.results.forEach((s) => {
      console.log(`  → Sentiment: ${s.sentiment} (${(s.confidence * 100).toFixed(1)}%)`);
    });
  }
});
```

### NER entity kinds

| Kind | Examples |
|---|---|
| `person` | "José", "John Smith" |
| `location` | "Braga", "London" |
| `organisation` | "ebankIT", "Microsoft" |
| `date` | "next Tuesday", "Q3 2026" |
| `product` | "Teams", "Zoom", "Gladia API" |
| `number` | "three million euros" |
| `event` | "the merger", "product launch" |

NER supports 100+ languages and can auto-detect the language per utterance when `code_switching` is enabled.

---

## 7. Multi-Channel Audio (Two-Sided Call Capture)

For meeting calls where you have separate tracks for the local mic and the remote participants (e.g., from a virtual audio cable setup), you can interleave them into a single WebSocket connection and get per-channel transcription. This replaces diarization for two-party calls.

```typescript
// multi-channel-interleave.ts

export function interleaveAudio(channelsData: Buffer[], bitDepth = 16): Buffer {
  const nbChannels = channelsData.length;
  if (nbChannels === 1) return channelsData[0];

  const bytesPerSample = bitDepth / 8;
  const samplesPerChannel = channelsData[0].byteLength / bytesPerSample;
  const audio = Buffer.alloc(nbChannels * samplesPerChannel * bytesPerSample);

  for (let i = 0; i < samplesPerChannel; i++) {
    for (let j = 0; j < nbChannels; j++) {
      const sample = channelsData[j].subarray(i * bytesPerSample, (i + 1) * bytesPerSample);
      audio.set(sample, (i * nbChannels + j) * bytesPerSample);
    }
  }

  return audio;
}

// Session config when using 2 channels:
const twoChannelConfig = {
  ...sessionConfig,
  channels: 2,  // Channel 0 = local mic, Channel 1 = remote audio
};

// Each transcript message will include utterance.channel: 0 or 1
// Map channel index to participant identity in your app.
```

> **Billing note:** Multi-channel transcription is billed by `duration × number_of_channels`. A 30-minute two-channel session = 60 minutes of billed usage.

---

## 8. Recommended Parameters by Use Case

For live meeting calls, Gladia recommends the following parameter set:

```typescript
const meetingCallConfig = {
  model: "solaria-1",
  encoding: "wav/pcm",
  sample_rate: 16000,
  bit_depth: 16,
  channels: 1,  // or 2 if using multi-channel (see Section 7)

  language_config: {
    languages: [],         // Empty = auto-detect per utterance
    code_switching: true,  // Enable for international calls with mixed languages
  },

  messages_config: {
    receive_partial_transcripts: true,
    receive_audio_events: false,
  },

  diarization: true,
  named_entity_recognition: true,
  sentiment_analysis: true,

  // Optional: improve accuracy for domain-specific terms
  // custom_vocabulary: ["ebankIT", "Gladia", "omnichannel", "PRINCE2"],
};
```

---

## 9. Provider Abstraction — Coexisting with Deepgram

The cleanest way to integrate Gladia alongside Deepgram is a provider interface that both implementations satisfy:

```typescript
// stt-provider.ts

export interface STTProvider {
  name: "deepgram" | "gladia";
  start(config: STTConfig): Promise<void>;
  sendAudio(chunk: Buffer): void;
  stop(): Promise<void>;
  on(event: "partial" | "final" | "error" | "end", handler: (...args: any[]) => void): void;
}

export interface STTConfig {
  sampleRate: number;
  channels: number;
  language?: string;
  enableDiarization?: boolean;
  enableNER?: boolean;
  enableSentiment?: boolean;
}
```

```typescript
// gladia-provider.ts — implements STTProvider

import { GladiaClient } from "@gladiaio/sdk";
import EventEmitter from "events";

export class GladiaProvider extends EventEmitter implements STTProvider {
  name = "gladia" as const;
  private session: any = null;
  private sessionId: string | null = null;
  private client: GladiaClient;

  constructor(apiKey: string) {
    super();
    this.client = new GladiaClient({ apiKey });
  }

  async start(config: STTConfig): Promise<void> {
    this.session = this.client.liveV2().startSession({
      model: "solaria-1",
      encoding: "wav/pcm",
      sample_rate: config.sampleRate,
      bit_depth: 16,
      channels: config.channels,
      language_config: {
        languages: config.language ? [config.language] : [],
        code_switching: !config.language,
      },
      messages_config: { receive_partial_transcripts: true },
      diarization: config.enableDiarization ?? true,
      named_entity_recognition: config.enableNER ?? true,
      sentiment_analysis: config.enableSentiment ?? true,
    });

    this.session.once("started", (res: any) => {
      this.sessionId = res?.id ?? null;
    });

    this.session.on("message", (msg: any) => {
      if (msg.type !== "transcript") return;
      const { utterance, is_final } = msg.data;
      if (!is_final) {
        this.emit("partial", utterance.text, utterance.channel);
      } else {
        this.emit("final", msg.data);
      }
    });

    this.session.on("error", (err: Error) => this.emit("error", err));

    this.session.once("ended", async (ended: any) => {
      if (this.sessionId) {
        try {
          const results = await fetchFinalResults(this.sessionId);
          this.emit("end", results);
        } catch (err) {
          this.emit("error", err);
        }
      }
    });
  }

  sendAudio(chunk: Buffer): void {
    this.session?.sendAudio(chunk);
  }

  async stop(): Promise<void> {
    await this.session?.stopRecording();
  }
}
```

### Switching providers in the STT manager

```typescript
// stt-manager.ts

import { DeepgramProvider } from "./deepgram-provider";  // existing
import { GladiaProvider } from "./gladia-provider";

type ProviderName = "deepgram" | "gladia";

export class STTManager {
  private provider: STTProvider;

  constructor(providerName: ProviderName) {
    this.provider = providerName === "gladia"
      ? new GladiaProvider(process.env.GLADIA_API_KEY!)
      : new DeepgramProvider(process.env.DEEPGRAM_API_KEY!);
  }

  async startSession(config: STTConfig) {
    await this.provider.start(config);

    this.provider.on("partial", (text, channel) => {
      // update UI live caption
    });

    this.provider.on("final", (utterance) => {
      // store in session transcript
    });

    this.provider.on("end", (results) => {
      // render diarization, NER, sentiment in post-call view
    });

    this.provider.on("error", (err) => {
      console.error(`[${this.provider.name}] STT error:`, err);
    });
  }

  sendAudio(chunk: Buffer) {
    this.provider.sendAudio(chunk);
  }

  async stopSession() {
    await this.provider.stop();
  }
}
```

---

## 10. Error Handling & Reconnection

The Gladia SDK handles automatic reconnection internally when using `startSession()`. For raw WebSocket usage, implement manual reconnection:

```typescript
// Manual reconnect pattern (raw WebSocket only — not needed when using the SDK)

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;

let reconnectAttempts = 0;
let wsUrl: string;  // Stored from the init response

function connectSocket(url: string) {
  const ws = new WebSocket(url);

  ws.addEventListener("close", ({ code }) => {
    if (code === 1000) return;  // Intentional close — do not reconnect

    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++;
      console.warn(`WebSocket closed (${code}). Reconnecting in ${RECONNECT_DELAY_MS}ms... (attempt ${reconnectAttempts})`);
      setTimeout(() => connectSocket(wsUrl), RECONNECT_DELAY_MS * reconnectAttempts);
    } else {
      console.error("Max reconnect attempts reached. Switching to Deepgram fallback.");
      // Emit fallback event or switch provider
    }
  });
}
```

### Common error codes and remediation

| HTTP / WS Code | Cause | Fix |
|---|---|---|
| `401` on init | Invalid API key | Check `GLADIA_API_KEY` env var |
| `422` on init | Bad audio config (wrong encoding/sample_rate) | Verify PCM format matches capture output |
| WS `1006` | Abnormal close (network drop) | Reconnect to same `wss://` URL |
| WS `1000` | Normal close after `stop_recording` | Do not reconnect; fetch final results |
| `404` on results fetch | Session ID not found or too early | Wait for `session_ended` event before fetching |

---

## 11. Environment Configuration

```bash
# .env (never commit to version control)
GLADIA_API_KEY=your_gladia_api_key_here
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Optional: default provider
STT_PROVIDER=gladia  # "gladia" | "deepgram"
```

In Electron's Main Process:

```typescript
// main.ts
import { app } from "electron";
import dotenv from "dotenv";

dotenv.config();

// Expose provider selection to Renderer via IPC — never expose raw API keys
ipcMain.handle("get-stt-provider", () => process.env.STT_PROVIDER ?? "deepgram");
ipcMain.handle("send-audio-chunk", (_event, chunk: Buffer) => {
  sttManager.sendAudio(chunk);
});
ipcMain.handle("start-stt-session", (_event, config: STTConfig) => {
  return sttManager.startSession(config);
});
ipcMain.handle("stop-stt-session", () => {
  return sttManager.stopSession();
});
```

---

## 12. Session Limits and Billing

| Limit | Value | Notes |
|---|---|---|
| Max session duration | 3 hours | Start a new session before reaching limit for long calls |
| Multi-channel billing | duration × channels | 30 min / 2 channels = 60 min billed |
| Concurrent sessions | Plan-dependent | Check Gladia dashboard for your concurrency tier |
| Audio intelligence | Billed as add-on | NER, diarization, sentiment each have separate per-minute pricing |

For long calls (> 2.5 hours), implement a session handoff:

```typescript
const SESSION_LIMIT_MS = 2.5 * 60 * 60 * 1000; // 2.5 hours

setTimeout(async () => {
  await sttManager.stopSession();
  await sttManager.startSession(config);  // New session, seamless for the user
}, SESSION_LIMIT_MS);
```

---

## 13. Post-Call Results UX Recommendations

Since diarization, NER, and sentiment arrive after the call ends (not in real time), the UI should:

1. **During the call:** Show live transcripts (partial + final utterances) with a channel/speaker indicator if multi-channel.
2. **After `stop_recording`:** Display a "Analysing..." state while Gladia's post-processing completes.
3. **After `session_ended`:** Enrich the transcript view with:
   - **Diarization:** Colour-code utterances by `speaker` ID.
   - **NER:** Underline or tag named entities inline (person = blue, organisation = teal, date = orange).
   - **Sentiment:** Show per-utterance emoji or bar indicator (😊 positive, 😐 neutral, 😟 negative).
4. **Export:** Offer a JSON/text export of the enriched transcript for CRM or note-taking integration.

---

## 14. Quickstart Checklist for Claude Code

Use this list to verify the implementation at each step:

- [ ] `GLADIA_API_KEY` loaded in Main Process via `dotenv`
- [ ] `@gladiaio/sdk` installed and imported
- [ ] `startSession()` called with correct `encoding`, `sample_rate`, `bit_depth`, `channels`
- [ ] `diarization`, `named_entity_recognition`, `sentiment_analysis` set to `true` in config
- [ ] WebSocket event handlers attached: `started`, `message`, `ended`, `error`
- [ ] Audio chunks converted from Float32 to PCM16 before calling `sendAudio()`
- [ ] `stopRecording()` called at end of call (not just closing the socket)
- [ ] `GET /v2/live/:id` called after `session_ended` to retrieve enriched results
- [ ] `STTProvider` interface implemented so Deepgram and Gladia are swappable
- [ ] IPC handlers expose only actions to Renderer — API keys never leave Main Process
- [ ] Session handoff logic in place for calls approaching 3 hours
- [ ] Reconnection logic handles WS close codes other than 1000

---

## References

- Gladia Live STT Quickstart: https://docs.gladia.io/chapters/live-stt/quickstart
- Gladia Audio Intelligence: https://docs.gladia.io/chapters/live-stt/audio-intelligence
- Gladia NER Docs: https://docs.gladia.io/chapters/audio-intelligence/named-entity-recognition
- Gladia Sentiment Analysis Docs: https://docs.gladia.io/chapters/audio-intelligence/sentiment-analysis
- Gladia Recommended Parameters: https://docs.gladia.io/chapters/live-stt/recommended-parameters
- Gladia Sample Code (GitHub): https://github.com/gladiaio/gladia-samples
- Gladia SDK (npm): https://www.npmjs.com/package/@gladiaio/sdk
