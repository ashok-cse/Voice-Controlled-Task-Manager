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
  let taskDrawerOpen = $state(false);
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
    taskDrawerOpen = false;
    showConversation = false;
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

        const data = await wsRequest<AgentCommandResponse>('agent:command', {
          transcript,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        });

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
  <main
    class="relative mx-auto flex min-h-[100dvh] max-w-[1200px] flex-col lg:min-h-screen"
  >
    <div aria-hidden="true" class="pointer-events-none fixed inset-0 -z-[1] overflow-hidden lg:absolute lg:inset-0">
      <div
        class="absolute left-1/2 top-[2%] h-[min(420px,75vw)] w-[min(420px,95vw)] -translate-x-1/2 rounded-full bg-gradient-to-br from-accent/30 via-accent-glow/20 to-transparent blur-[76px]"
      ></div>
      <div
        class="absolute -right-[14%] top-[42%] h-[260px] w-[260px] rounded-full bg-accent-glow/[0.13] blur-[68px]"
      ></div>
      <div
        class="absolute -left-[12%] bottom-[18%] h-[280px] w-[280px] rounded-full bg-accent-warm/[0.12] blur-[72px]"
      ></div>
    </div>

    <header
      class="sticky top-0 z-30 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-200/65 bg-bg/88 px-4 py-3 backdrop-blur-md sm:gap-3 sm:py-4 lg:relative lg:z-10 lg:border-0 lg:bg-transparent lg:p-10 lg:backdrop-blur-none"
    >
      <div class="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div
          class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-glow shadow-glow sm:h-10 sm:w-10"
        >
          <svg viewBox="0 0 24 24" class="h-4 w-4 text-white sm:h-5 sm:w-5" fill="currentColor">
            <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
            <path
              d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z"
            />
          </svg>
        </div>
        <div class="min-w-0">
          <div class="truncate text-base font-semibold tracking-tight sm:text-lg">
            Voice-Controlled Tasks
          </div>
          <span class="truncate text-[11px] text-ink-mute sm:text-xs">{user.email}</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
        {#if handsFree}
          <span class="pill hidden bg-accent/10 text-accent sm:inline-flex">Hands-free</span>
        {/if}
        <button type="button" onclick={signOut} class="btn-ghost whitespace-nowrap text-xs">
          Sign out
        </button>
      </div>
    </header>

    <div
      class="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-28 pt-1 lg:flex-row lg:items-stretch lg:gap-10 lg:px-10 lg:pb-14 lg:pt-0"
    >
      <aside
        class="hidden shrink-0 flex-col gap-3 overflow-hidden lg:sticky lg:flex lg:w-[300px] lg:min-h-0 lg:self-start lg:top-28 lg:max-h-[calc(100dvh-9rem)]"
        id="desktop-task-sidebar"
      >
        <div class="flex shrink-0 items-center justify-between gap-3">
          <h2 class="text-sm uppercase tracking-wider text-ink-mute">Tasks</h2>
          <span class="text-xs text-ink-dim">Hands-free</span>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pr-1">
          <TaskList {tasks} {highlightIds} />
        </div>
        <div class="glass shrink-0 border-t border-slate-200/70 p-5 text-sm text-ink-mute space-y-2">
          <div class="text-ink font-medium">Try saying</div>
          <div>• "Create a task for syncing with the product manager at 10 AM."</div>
          <div>
            • "Create three tasks for tomorrow morning. Gym at 7, team sync at 9, and LinkedIn post at
            11."
          </div>
          <div>• "What are my evening tasks?"</div>
          <div>• "Change the LinkedIn task to 6 PM."</div>
          <div>• "Delete the LinkedIn task."</div>
        </div>
      </aside>

      <section class="flex min-h-0 flex-1 flex-col gap-4 lg:min-w-0 lg:gap-6">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onclick={() => (showConversation = !showConversation)}
            aria-expanded={showConversation}
            class="pill w-full justify-center gap-2 border border-slate-200/90 bg-bg/90 px-4 py-2 text-sm font-medium text-ink shadow-sm hover:border-accent/30 hover:bg-bg-card sm:w-auto sm:justify-start"
          >
            <svg
              viewBox="0 0 24 24"
              class="h-3.5 w-3.5 shrink-0 transition-transform {showConversation ? 'rotate-90' : ''}"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {#if showConversation}
              Hide conversation
            {:else}
              Show conversation
              {#if messages.length > 0}
                <span
                  class="pill bg-bg-soft font-normal tabular-nums normal-case tracking-normal text-ink-dim"
                  >{messages.length}</span
                >
              {/if}
            {/if}
          </button>
          {#if handsFree || pendingMessage}
            <div
              class="hidden flex-wrap items-center justify-end gap-2 text-xs text-ink-mute lg:flex"
            >
              {#if pendingMessage}
                <span class="pill bg-accent-warm/15 text-accent-warm">Awaiting confirmation</span>
              {/if}
              {#if handsFree}
                <span class="pill bg-accent/10 text-accent">Hands-free on</span>
              {/if}
            </div>
          {/if}
        </div>

        {#if showConversation}
          <Transcript {messages} {liveUser} {liveAssistant} />
        {/if}

        <div class="glass flex shrink-0 flex-col items-center px-6 py-7 sm:p-8">
          <VoiceOrb state={voiceState} {handsFree} onToggle={toggleMic} />
          {#if pendingMessage}
            <div class="mt-6 max-w-lg text-center text-sm text-accent-warm">
              {pendingMessage}<br />
              <span class="text-ink-mute">Say “yes” to confirm or “no” to cancel.</span>
            </div>
          {/if}
          {#if voiceState === 'speaking'}
            <div class="mt-4 text-xs text-ink-dim">Speak anytime to interrupt</div>
          {/if}
          {#if errorMsg}
            <div class="mt-6 text-center text-sm text-accent-warm">{errorMsg}</div>
          {/if}
        </div>
      </section>
    </div>

    <div
      class="fixed inset-x-0 bottom-0 z-30 pb-[env(safe-area-inset-bottom,0)] pt-3 lg:hidden"
    >
      <div
        class="mx-auto flex max-w-xl justify-center px-4 bg-gradient-to-t from-bg via-bg/95 to-transparent pb-4 pt-1"
      >
        <button
          type="button"
          onclick={() => (taskDrawerOpen = true)}
          class="pill bg-bg-card px-8 py-2.5 text-sm font-medium text-ink shadow-card ring-1 ring-slate-200/90 hover:bg-bg-soft hover:ring-accent/25"
          aria-expanded={taskDrawerOpen}
          aria-haspopup="dialog"
        >
          Task list
        </button>
      </div>
    </div>

    {#if taskDrawerOpen}
      <div
        class="fixed inset-0 z-50 lg:hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-sheet-title"
      >
        <button
          type="button"
          onclick={() => (taskDrawerOpen = false)}
          class="absolute inset-0 bg-ink/[0.2] backdrop-blur-[2px]"
          aria-label="Dismiss task list"
        ></button>
        <div
          class="absolute inset-x-0 bottom-0 flex max-h-[min(92dvh,860px)] flex-col rounded-t-3xl border border-slate-200 bg-bg-card shadow-card"
        >
          <div class="pointer-events-none flex justify-center pb-3 pt-2">
            <span class="h-1.5 w-10 rounded-full bg-slate-300/85"></span>
          </div>
          <div class="flex shrink-0 items-center justify-between px-6 pb-2">
            <h2 id="task-sheet-title" class="text-base font-semibold text-ink">Task list</h2>
            <button
              type="button"
              onclick={() => (taskDrawerOpen = false)}
              class="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-bg-soft text-ink hover:border-accent/30"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
              </svg>
            </button>
          </div>
          <div class="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
            <TaskList {tasks} {highlightIds} />
          </div>
          <div class="border-t border-slate-200/80 px-6 py-5 text-sm text-ink-mute space-y-2">
            <div class="text-ink font-medium">Try saying</div>
            <div>• "Create a task for syncing with the product manager at 10 AM."</div>
            <div>
              • "Create three tasks for tomorrow morning: gym, team sync, and LinkedIn post."
            </div>
          </div>
        </div>
      </div>
    {/if}
  </main>
{/if}
