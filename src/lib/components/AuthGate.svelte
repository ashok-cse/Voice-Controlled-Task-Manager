<script lang="ts">
  import { login, signup, type AuthUser } from '$lib/auth';

  interface Props {
    onAuth: (user: AuthUser) => void;
  }

  let { onAuth }: Props = $props();

  let mode = $state<'login' | 'signup'>('login');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    if (busy) return;
    error = '';
    busy = true;
    try {
      const user = mode === 'login' ? await login(email, password) : await signup(email, password);
      onAuth(user);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Something went wrong.';
    } finally {
      busy = false;
    }
  }

  function toggleMode() {
    mode = mode === 'login' ? 'signup' : 'login';
    error = '';
  }
</script>

<main class="min-h-screen grid place-items-center px-6">
  <div class="glass w-full max-w-sm p-8">
    <div class="flex items-center gap-3 mb-6">
      <div class="h-10 w-10 rounded-xl bg-gradient-to-br from-accent to-accent-glow grid place-items-center shadow-glow">
        <svg viewBox="0 0 24 24" class="h-5 w-5 text-white" fill="currentColor">
          <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3z" />
          <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 1 0 2 0v-3.08A7 7 0 0 0 19 11z" />
        </svg>
      </div>
      <div>
        <div class="text-lg font-semibold tracking-tight">VoiceTask Agent</div>
        <div class="text-xs text-ink-mute">
          {mode === 'login' ? 'Sign in to your account' : 'Create a new account'}
        </div>
      </div>
    </div>

    <form onsubmit={submit} class="space-y-4">
      <div>
        <label for="email" class="block text-xs uppercase tracking-wider text-ink-mute mb-1.5">Email</label>
        <input
          id="email"
          type="email"
          autocomplete="email"
          required
          bind:value={email}
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          placeholder="you@example.com"
        />
      </div>

      <div>
        <label for="password" class="block text-xs uppercase tracking-wider text-ink-mute mb-1.5">Password</label>
        <input
          id="password"
          type="password"
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
          minlength={6}
          bind:value={password}
          class="w-full px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent transition"
          placeholder="At least 6 characters"
        />
      </div>

      {#if error}
        <div class="text-sm text-accent-warm">{error}</div>
      {/if}

      <button
        type="submit"
        disabled={busy}
        class="w-full py-2.5 rounded-xl bg-gradient-to-br from-accent to-accent-glow text-white font-medium shadow-glow disabled:opacity-60 transition"
      >
        {busy ? '…' : mode === 'login' ? 'Sign in' : 'Create account'}
      </button>
    </form>

    <button
      type="button"
      onclick={toggleMode}
      class="mt-5 w-full text-sm text-ink-mute hover:text-accent transition"
    >
      {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
    </button>
  </div>
</main>
