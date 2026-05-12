import { wsRequest } from './wsClient';

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

export type ListenReason = 'speech-end' | 'no-speech' | 'cancelled' | 'max-duration';

export interface ListenResult {
  blob: Blob | null;
  reason: ListenReason;
}

export interface ListenOptions {
  speechThreshold?: number;
  silenceThreshold?: number;
  silenceMs?: number;
  noSpeechMs?: number;
  maxDurationMs?: number;
  onSpeechStart?: () => void;
}

function isIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/i.test(ua);
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOS;
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Uint8Array | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: BlobPart[] = [];
  private cancelled = false;

  async open(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone is not available in this browser.');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.audioCtx = new Ctx();
    try {
      await this.audioCtx.resume();
    } catch {
      /* ignore */
    }
    const src = this.audioCtx.createMediaStreamSource(this.stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    const ab = new ArrayBuffer(this.analyser.frequencyBinCount);
    this.analyserData = new Uint8Array(ab);
  }

  close(): void {
    this.cancelled = true;
    try {
      this.mediaRecorder?.stop();
    } catch {
      /* ignore */
    }
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audioCtx?.close().catch(() => {});
    this.audioCtx = null;
    this.analyser = null;
    this.analyserData = null;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /**
   * While assistant audio plays, poll mic level and fire once when the user
   * speaks clearly for a short hold (reduces false triggers from speaker bleed).
   */
  watchBargeIn(
    onInterrupt: () => void,
    opts?: {
      /** RMS threshold — slightly higher than listenUntilSilence during playback */
      threshold?: number;
      /** How long level must stay above threshold */
      holdMs?: number;
      /** Ignore mic spikes at the very start of TTS (setup / bleed) */
      warmupMs?: number;
      pollMs?: number;
    }
  ): () => void {
    const threshold = opts?.threshold ?? 0.052;
    const holdMs = opts?.holdMs ?? 280;
    const warmupMs = opts?.warmupMs ?? 450;
    const pollMs = opts?.pollMs ?? 50;

    let sustainedStart: number | null = null;
    let fired = false;
    const startedAt = performance.now();

    const id = window.setInterval(() => {
      if (fired || !this.analyser || !this.analyserData) return;
      const now = performance.now();
      if (now - startedAt < warmupMs) return;

      const level = this.rms();
      if (level >= threshold) {
        if (sustainedStart === null) sustainedStart = now;
        else if (now - sustainedStart >= holdMs) {
          fired = true;
          window.clearInterval(id);
          onInterrupt();
        }
      } else {
        sustainedStart = null;
      }
    }, pollMs);

    return () => {
      window.clearInterval(id);
    };
  }

  private rms(): number {
    if (!this.analyser || !this.analyserData) return 0;
    this.analyser.getByteTimeDomainData(this.analyserData as Uint8Array<ArrayBuffer>);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      const x = (this.analyserData[i] - 128) / 128;
      sum += x * x;
    }
    return Math.sqrt(sum / this.analyserData.length);
  }

  async listenUntilSilence(opts: ListenOptions = {}): Promise<ListenResult> {
    if (!this.stream) await this.open();
    if (!this.stream) throw new Error('Mic unavailable');

    const speechThreshold = opts.speechThreshold ?? 0.035;
    const silenceThreshold = opts.silenceThreshold ?? 0.02;
    const silenceMs = opts.silenceMs ?? 1100;
    const noSpeechMs = opts.noSpeechMs ?? 8000;
    const maxDurationMs = opts.maxDurationMs ?? 30000;

    const mime = pickMime();
    this.chunks = [];
    this.cancelled = false;
    this.mediaRecorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // timeslice helps some WebKit builds flush recorded data reliably
    this.mediaRecorder.start(250);

    const startedAt = performance.now();
    let speechStartedAt: number | null = null;
    let lastLoudAt: number = startedAt;

    return new Promise<ListenResult>((resolve) => {
      let reason: ListenReason = 'speech-end';
      const interval = setInterval(() => {
        if (this.cancelled) {
          reason = 'cancelled';
          finalize();
          return;
        }
        const now = performance.now();
        const level = this.rms();
        if (level >= speechThreshold) {
          if (speechStartedAt === null) {
            speechStartedAt = now;
            opts.onSpeechStart?.();
          }
          lastLoudAt = now;
        } else if (level >= silenceThreshold && speechStartedAt !== null) {
          lastLoudAt = now;
        }

        if (speechStartedAt === null && now - startedAt >= noSpeechMs) {
          reason = 'no-speech';
          finalize();
          return;
        }
        if (speechStartedAt !== null && now - lastLoudAt >= silenceMs) {
          reason = 'speech-end';
          finalize();
          return;
        }
        if (now - startedAt >= maxDurationMs) {
          reason = 'max-duration';
          finalize();
          return;
        }
      }, 80);

      const finalize = () => {
        clearInterval(interval);
        const mr = this.mediaRecorder;
        if (!mr) {
          resolve({ blob: null, reason });
          return;
        }
        mr.onstop = () => {
          const type = mr.mimeType || 'audio/webm';
          const usable = reason === 'speech-end' || reason === 'max-duration';
          const blob = usable && this.chunks.length ? new Blob(this.chunks, { type }) : null;
          this.mediaRecorder = null;
          this.chunks = [];
          resolve({ blob, reason });
        };
        try {
          mr.stop();
        } catch {
          this.mediaRecorder = null;
          this.chunks = [];
          resolve({ blob: null, reason });
        }
      };
    });
  }
}

function pickMime(): string | null {
  const webkitFirst = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus'
  ];
  const defaultOrder = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4'
  ];
  const candidates = isIOSLike() ? webkitFirst : defaultOrder;
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return null;
}

let currentAudio: HTMLAudioElement | null = null;

export function stopPlayback(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function abortSignalPromise(signal: AbortSignal | undefined): Promise<void> | null {
  if (!signal) return null;
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        stopPlayback();
        resolve();
      },
      { once: true }
    );
  });
}

/** iOS WebKit often leaves synthesis “paused” until resume() after a tap. */
async function speakWithBrowserSynth(text: string, signal?: AbortSignal): Promise<void> {
  if (!text.trim() || signal?.aborted) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const syn = window.speechSynthesis;
  syn.cancel();
  if (isIOSLike()) {
    try {
      syn.resume();
    } catch {
      /* ignore */
    }
  }

  const synDone = new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const done = () => resolve();
    u.onend = done;
    u.onerror = done;
    syn.speak(u);
  });
  const abortWait = abortSignalPromise(signal);
  if (abortWait !== null) await Promise.race([abortWait, synDone]);
  else await synDone;
}

export async function speak(text: string, signal?: AbortSignal): Promise<void> {
  if (!text.trim()) return;
  if (signal?.aborted) return;

  stopPlayback();

  const abortWait = abortSignalPromise(signal);

  try {
    const ttsPayload = wsRequest<{ audio: string; mime: string }>('tts', { text });
    const result =
      abortWait !== null
        ? await Promise.race([
            ttsPayload,
            abortWait.then(() => null as { audio: string; mime: string } | null)
          ])
        : await ttsPayload;
    if (signal?.aborted || result === null) return;

    const blob = base64ToBlob(result.audio, result.mime);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.setAttribute('playsinline', 'true');
    audio.preload = 'auto';
    currentAudio = audio;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      URL.revokeObjectURL(url);
      if (currentAudio === audio) currentAudio = null;
    };

    const waitEnd = new Promise<void>((resolve) => {
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        resolve();
      };
    });

    try {
      await audio.play();
    } catch {
      cleanup();
      await speakWithBrowserSynth(text, signal);
      return;
    }

    if (abortWait !== null) await Promise.race([abortWait, waitEnd]);
    else await waitEnd;
  } catch (err) {
    if (signal?.aborted) return;
    console.warn('[tts] falling back to browser speech:', err);
    await speakWithBrowserSynth(text, signal);
  }
}

export async function speakWithBargeIn(recorder: VoiceRecorder, text: string): Promise<void> {
  const ac = new AbortController();
  const stopWatch = recorder.watchBargeIn(() => ac.abort());
  try {
    await speak(text, ac.signal);
  } finally {
    stopWatch();
  }
}

export async function transcribe(audio: Blob): Promise<string> {
  const base64 = await blobToBase64(audio);
  const data = await wsRequest<{ transcript: string }>('stt', {
    audio: base64,
    mime: audio.type
  });
  return data.transcript;
}
