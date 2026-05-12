<script lang="ts">
  import { onMount } from 'svelte';
  import VoiceOrb from '$lib/components/VoiceOrb.svelte';
  import TaskList from '$lib/components/TaskList.svelte';
  import Transcript from '$lib/components/Transcript.svelte';
  import AuthGate from '$lib/components/AuthGate.svelte';
  import { VoiceRecorder, speakWithBargeIn, stopPlayback, transcribe, type VoiceState } from '$lib/voice/voiceClient';
  import { wsRequest } from '$lib/voice/wsClient';
  import { currentUser, logout, type AuthUser } from '$lib/auth';
  import type { AgentCommandResponse, ConversationMessage, Task } from '$lib/types';

  let voiceState = $state<VoiceState>('idle');
  let handsFree = $state(false);
  let tasks = $state<Task[]>([]);
  let messages = $state<ConversationMessage[]>([]);
  let liveUser = $state('');
  let liveAssistant = $state('');
  let errorMsg = $state('');
  let highlightIds = $state<string[]>([]);
  let pendingMessage = $state<string | null>(null);

  let user = $state<AuthUser | null>(null);
  let authChecked = $state(false);

  let recorder = new VoiceRecorder();
  let awaitingConfirmation = false;
  let showConversation = $state(false);

  onMount(async () => {
    user = await currentUser();
    authChecked = true;
    if (user) await refresh();
  });

  async function onAuth(authedUser: AuthUser) {
    user = authedUser;
    await refresh();
  }

  async function signOut() {
    if (handsFree) stopHandsFree();
    await logout();
    user = null;
    tasks = [];
    messages = [];
  }

  async function refresh() {
    try {
      const data = await wsRequest<{ tasks: Task[]; messages: ConversationMessage[] }>('tasks:list');
      tasks = data.tasks;
      messages = data.messages;
    } catch (err) {
      console.error('Failed to load:', err);
    }
  }

  async function toggleMic() {
    if (handsFree) {
      stopHandsFree();
    } else {
      await startHandsFree();
    }
  }

  async function startHandsFree() {
    errorMsg = '';
    try {
      await recorder.open();
    } catch (err) {
      console.error(err);
      errorMsg = err instanceof Error ? err.message : 'Could not access microphone';
      voiceState = 'error';
      return;
    }
    handsFree = true;
    runLoop();
  }

  function stopHandsFree() {
    handsFree = false;
    recorder.cancel();
    stopPlayback();
    recorder.close();
    voiceState = 'idle';
    liveUser = '';
    liveAssistant = '';
  }

  async function runLoop() {
    while (handsFree) {
      voiceState = 'listening';
      liveUser = '';
      const noSpeechMs = awaitingConfirmation ? 6000 : 9000;
      let result;
      try {
        result = await recorder.listenUntilSilence({ noSpeechMs });
      } catch (err) {
        console.error(err);
        errorMsg = 'Microphone error. Tap the orb to try again.';
        handsFree = false;
        voiceState = 'error';
        return;
      }

      if (!handsFree) break;

      if (result.reason === 'no-speech') {
        // Quietly idle out after a couple of silent passes.
        handsFree = false;
        recorder.close();
        voiceState = 'idle';
        return;
      }
      if (result.reason === 'cancelled' || !result.blob) {
        continue;
      }

      voiceState = 'processing';
      try {
        const transcript = (await transcribe(result.blob)).trim();
        liveUser = transcript || '…';
        if (!transcript) {
          const fallback = "Sorry, I didn't catch that.";
          liveAssistant = fallback;
          voiceState = 'speaking';
          await speakWithBargeIn(recorder, fallback);
          continue;
        }

        const data = await wsRequest<AgentCommandResponse>('agent:command', { transcript });

        tasks = data.tasks;
        highlightIds = data.affectedTaskIds ?? [];
        pendingMessage = data.pendingConfirmation?.message ?? null;
        awaitingConfirmation = !!data.pendingConfirmation;
        liveAssistant = data.responseText;

        voiceState = 'speaking';
        await speakWithBargeIn(recorder, data.responseText);
        await refresh();

        setTimeout(() => {
          highlightIds = [];
        }, 2500);

        liveAssistant = '';
      } catch (err) {
        console.error(err);
        const fallback = 'Connection was interrupted. Please try again.';
        errorMsg = fallback;
        liveAssistant = fallback;
        voiceState = 'speaking';
        try {
          await speakWithBargeIn(recorder, fallback);
        } catch {
          /* ignore */
        }
        liveAssistant = '';
      }
    }
    voiceState = 'idle';
    liveUser = '';
    liveAssistant = '';
  }
</script>

<svelte:head>
  <title>VoiceTask Agent</title>
</svelte:head>

{#if !authChecked}
  <main class="min-h-screen grid place-items-center">
    <div class="text-ink-mute text-sm">Loading…</div>
  </main>
{:else if !user}
  <AuthGate {onAuth} />
{:else}
<main class="min-h-screen px-6 py-8 lg:py-12 max-w-7xl mx-auto">
  <header class="flex items-center justify-between mb-10">
    <div class="flex items-center gap-3">
      <div class="h-10 w-10 rounded-xl bg-gradient-to-br from-accent to-accent-glow grid place-items-center shadow-glow">
        <svg viewBox="0 0 24 24" class="h-5 w-5 text-white" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z" />
        </svg>
      </div>
      <div>
        <div class="text-lg font-semibold tracking-tight">Voice-Controlled Task Manager</div>
      </div>
    </div>
    <div class="flex items-center gap-2 text-xs text-ink-mute">
      {#if handsFree}
        <span class="pill bg-accent/10 text-accent">Hands-free on</span>
      {/if}
      {#if pendingMessage}
        <span class="pill bg-accent-warm/15 text-accent-warm">Awaiting confirmation</span>
      {/if}
      <span class="pill bg-bg-soft text-ink-mute">{tasks.filter((t) => t.status === 'pending').length} pending</span>
      <span class="pill bg-bg-soft text-ink-mute hidden sm:inline-flex">{user.email}</span>
      <button type="button" onclick={signOut} class="btn-ghost text-xs">Sign out</button>
    </div>
  </header>

  <section class="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-8 lg:gap-12">
    <div class="space-y-6">
      <div class="glass p-8 flex flex-col items-center">
        <VoiceOrb state={voiceState} {handsFree} onToggle={toggleMic} />
        {#if pendingMessage}
          <div class="mt-6 text-sm text-center text-accent-warm">
            {pendingMessage}<br />
            <span class="text-ink-mute">Say "yes" to confirm or "no" to cancel.</span>
          </div>
        {/if}
        {#if voiceState === 'speaking'}
          <div class="mt-4 text-xs text-center text-ink-dim">Speak anytime to interrupt</div>
        {/if}
        {#if errorMsg}
          <div class="mt-6 text-sm text-center text-accent-warm">{errorMsg}</div>
        {/if}
      </div>

      <div>
        <button
          type="button"
          onclick={() => (showConversation = !showConversation)}
          class="flex items-center gap-2 text-sm uppercase tracking-wider text-ink-mute hover:text-accent transition-colors mb-3"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-3.5 w-3.5 transition-transform {showConversation ? 'rotate-90' : ''}"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="9 18 15 12 9 6" />
          </svg>
          {showConversation ? 'Hide conversation' : 'Show conversation'}
          {#if !showConversation && messages.length > 0}
            <span class="pill bg-bg-soft text-ink-dim normal-case tracking-normal">{messages.length}</span>
          {/if}
        </button>
        {#if showConversation}
          <Transcript {messages} {liveUser} {liveAssistant} />
        {/if}
      </div>
    </div>

    <div>
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-sm uppercase tracking-wider text-ink-mute">Tasks</h2>
        <span class="text-xs text-ink-dim">Hands-free · just keep talking</span>
      </div>
      <TaskList {tasks} {highlightIds} />

      <div class="mt-8 glass p-5 text-sm text-ink-mute space-y-2">
        <div class="text-ink font-medium">Try saying:</div>
        <div>• "Create a task for syncing with the product manager at 10 AM."</div>
        <div>• "Create three tasks for tomorrow morning. Gym at 7, team sync at 9, and LinkedIn post at 11."</div>
        <div>• "What are my evening tasks?"</div>
        <div>• "Change the LinkedIn task to 6 PM."</div>
        <div>• "Delete the LinkedIn task."</div>
      </div>
    </div>
  </section>
</main>
{/if}
