<script lang="ts">
  import type { Task } from '$lib/types';

  interface Props {
    tasks: Task[];
    highlightIds?: string[];
  }

  let { tasks, highlightIds = [] }: Props = $props();

  function formatWhen(iso: string | null): string {
    if (!iso) return 'No time set';
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const datePart = sameDay
      ? 'Today'
      : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    return `${datePart} · ${timePart}`;
  }

  function priorityClass(p: Task['priority']): string {
    return p === 'high'
      ? 'bg-accent-warm/15 text-accent-warm'
      : p === 'low'
      ? 'bg-bg-soft text-ink-mute'
      : 'bg-accent/10 text-accent';
  }
</script>

<div class="space-y-3">
  {#if tasks.length === 0}
    <div class="glass p-6 text-center text-ink-mute text-sm">
      Your task list is empty. Try saying<br />
      <span class="text-ink"><em>"Create a task for posting on LinkedIn at 5 PM."</em></span>
    </div>
  {:else}
    {#each tasks as t (t.id)}
      <div
        class="glass p-4 flex items-center justify-between gap-4 transition
               {highlightIds.includes(t.id) ? 'ring-2 ring-accent/60 shadow-glow' : ''}
               {t.status === 'completed' ? 'opacity-60' : ''}"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <span class="pill {priorityClass(t.priority)}">{t.priority}</span>
            {#if t.status === 'completed'}
              <span class="pill bg-emerald-100 text-emerald-700">done</span>
            {/if}
          </div>
          <div
            class="mt-1 font-medium text-ink truncate
                   {t.status === 'completed' ? 'line-through' : ''}"
          >
            {t.title}
          </div>
          <div class="text-xs text-ink-mute mt-1">{formatWhen(t.scheduledAt)}</div>
        </div>
      </div>
    {/each}
  {/if}
</div>
