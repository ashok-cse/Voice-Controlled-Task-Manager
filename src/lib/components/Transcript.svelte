<script lang="ts">
  import { tick } from 'svelte';
  import type { ConversationMessage } from '$lib/types';

  interface Props {
    messages: ConversationMessage[];
    liveUser?: string;
    liveAssistant?: string;
  }

  let { messages, liveUser = '', liveAssistant = '' }: Props = $props();
  let scrollEl = $state<HTMLElement | undefined>();

  $effect(() => {
    void messages.length;
    void liveUser;
    void liveAssistant;
    queueMicrotask(async () => {
      await tick();
      scrollEl?.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    });
  });
</script>

<div
  bind:this={scrollEl}
  class="glass p-3 sm:p-4 min-h-[120px] max-h-[min(38vh,320px)] lg:max-h-[min(52vh,520px)] overflow-y-auto space-y-2.5 sm:space-y-3"
  id="transcript-scroll"
>
  {#if messages.length === 0 && !liveUser && !liveAssistant}
    <div class="text-ink-mute text-sm text-center py-6">
      Conversation will appear here as you speak.
    </div>
  {/if}

  {#each messages as m (m.id)}
    <div class="flex {m.role === 'user' ? 'justify-end' : 'justify-start'}">
      <div
        class="max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed
               {m.role === 'user'
                 ? 'bg-accent text-white'
                 : 'bg-bg-soft text-ink border border-slate-200'}"
      >
        {m.text}
      </div>
    </div>
  {/each}

  {#if liveUser}
    <div class="flex justify-end">
      <div class="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-accent/10 text-accent italic border border-accent/20">
        {liveUser}
      </div>
    </div>
  {/if}

  {#if liveAssistant}
    <div class="flex justify-start">
      <div class="max-w-[80%] rounded-2xl px-4 py-2 text-sm bg-bg-soft text-ink-mute italic border border-slate-200">
        {liveAssistant}
      </div>
    </div>
  {/if}
</div>
