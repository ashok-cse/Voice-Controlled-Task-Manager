<script lang="ts">
  import type { VoiceState } from '$lib/voice/voiceClient';

  interface Props {
    state: VoiceState;
    handsFree?: boolean;
    onToggle: () => void;
  }

  let { state, handsFree = false, onToggle }: Props = $props();

  const label = $derived(
    state === 'listening'
      ? 'Listening…'
      : state === 'processing'
      ? 'Thinking…'
      : state === 'speaking'
      ? 'Speaking…'
      : state === 'error'
      ? 'Tap to retry'
      : handsFree
      ? 'Tap to end'
      : 'Tap to start'
  );
</script>

<div class="flex flex-col items-center gap-4">
  <button
    type="button"
    class="relative h-40 w-40 rounded-full focus:outline-none focus:ring-4 focus:ring-accent/40"
    onclick={onToggle}
    aria-label="Toggle microphone"
  >
    {#if state === 'listening'}
      <span class="absolute inset-0 rounded-full bg-accent/30 animate-pulseRing"></span>
      <span class="absolute inset-0 rounded-full bg-accent/20 animate-pulseRing" style="animation-delay: 0.5s"></span>
    {/if}
    <span
      class="relative grid h-full w-full place-items-center rounded-full
             bg-gradient-to-br from-accent to-accent-glow
             shadow-glow transition-transform
             {state === 'speaking' ? 'animate-breathe' : ''}
             {state === 'idle' ? 'hover:scale-105' : ''}"
    >
      {#if state === 'listening'}
        <div class="flex items-end gap-1 h-10">
          {#each [0, 1, 2, 3, 4] as i}
            <span
              class="w-1.5 bg-white rounded-full animate-wave"
              style={`height: 100%; animation-delay: ${i * 0.12}s`}
            ></span>
          {/each}
        </div>
      {:else if state === 'processing'}
        <svg class="h-10 w-10 animate-spin text-white" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
          <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      {:else if state === 'speaking'}
        <svg class="h-10 w-10 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 10v4a1 1 0 0 0 1 1h3l4 4V5L7 9H4a1 1 0 0 0-1 1z" />
          <path d="M16 8a5 5 0 0 1 0 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
          <path d="M19 5a9 9 0 0 1 0 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none" />
        </svg>
      {:else}
        <svg class="h-12 w-12 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z" />
        </svg>
      {/if}
    </span>
  </button>
  <div class="text-sm text-ink-mute tracking-wide uppercase">{label}</div>
</div>
