<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";

  let { data, form } = $props();

  interface CollectJob {
    id: string;
    granularity: string;
    direction: string;
    progress: {
      status: "running" | "done" | "error";
      currentInstrument?: string;
      totalInstruments: number;
      completedInstruments: number;
      totalDayFiles: number;
      fetchedDayFiles: number;
      skippedDayFiles: number;
      errors: number;
      message: string;
    };
  }
  let collectJobs = $state<CollectJob[]>([]);
  let expandedGrans = $state<Set<string>>(new Set());
  let expandedGroups = $state<Set<string>>(new Set());

  // Poll collection jobs
  $effect(() => {
    const hasRunning = collectJobs.some((j) => j.progress.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/admin/collect");
        if (res.ok) {
          const d = await res.json();
          collectJobs = d.jobs;
          if (!d.jobs.some((j: CollectJob) => j.progress.status === "running")) {
            await invalidateAll();
          }
        }
      } catch { /* ignore */ }
    }, 2000);
    return () => clearInterval(interval);
  });

  function toggleGran(name: string) {
    if (expandedGrans.has(name)) {
      expandedGrans.delete(name);
    } else {
      expandedGrans.add(name);
    }
    expandedGrans = new Set(expandedGrans);
  }

  function toggleGroup(key: string) {
    if (expandedGroups.has(key)) {
      expandedGroups.delete(key);
    } else {
      expandedGroups.add(key);
    }
    expandedGroups = new Set(expandedGroups);
  }

  function getJobForKey(granularity: string, groupType?: string): CollectJob | undefined {
    return collectJobs.find((j) => j.granularity === granularity && j.progress.status === "running")
      ?? collectJobs.findLast((j: CollectJob) => j.granularity === granularity);
  }

  async function collectGroup(granularity: string, direction: "latest" | "previous", instruments: string[]) {
    try {
      const res = await fetch("/api/admin/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granularity, direction, instruments }),
      });
      if (res.ok) {
        const jobsRes = await fetch("/api/admin/collect");
        if (jobsRes.ok) collectJobs = (await jobsRes.json()).jobs;
      }
    } catch { /* ignore */ }
  }

  // Group stats for a granularity
  function groupStats(granularity: string, instruments: string[]) {
    const coverage = data.granularities.find((g: any) => g.name === granularity)?.coverage ?? {};
    let collected = 0;
    for (const inst of instruments) {
      if (coverage[inst]) collected++;
    }
    return { total: instruments.length, collected };
  }

  const groupOrder = ["CURRENCY", "METAL", "CFD"];
  const groupLabels: Record<string, string> = {
    CURRENCY: "Forex",
    METAL: "Metals",
    CFD: "CFDs & Indices",
  };
</script>

<div class="data-page">
  <h1>Historical Data</h1>

  {#if form?.success}
    <div class="success">{form.message}</div>
  {/if}
  {#if form?.error}
    <div class="error">{form.error}</div>
  {/if}

  <div class="info-bar">
    <div class="info-item">
      <span class="label">Instruments</span>
      <span class="value">{data.instrumentCount} cached</span>
      {#if data.instrumentsFetchedAt}
        <span class="muted">({data.instrumentsFetchedAt.slice(0, 10)})</span>
      {/if}
      <form method="POST" action="?/refreshInstruments" use:enhance={() => { return async ({ update }) => { await update(); await invalidateAll(); }; }} style="display:inline">
        <button type="submit" class="btn-sm btn-refresh">Refresh</button>
      </form>
    </div>
    {#if !data.hasApiKey}
      <p class="warn">No system API key configured. <a href="/admin">Set one in Admin</a>.</p>
    {/if}
  </div>

  {#each data.granularities as gran}
    {@const hasData = Object.keys(gran.coverage).length > 0}
    {@const job = getJobForKey(gran.name)}
    <div class="gran-section" class:has-data={hasData}>
      <button class="gran-header" onclick={() => toggleGran(gran.name)}>
        <span class="gran-name">{gran.name}</span>
        <span class="gran-summary">
          {#if job?.progress.status === "running"}
            <span class="collecting">
              {job.progress.currentInstrument ?? "Starting"}
              — {job.progress.fetchedDayFiles}/{job.progress.totalDayFiles}
            </span>
          {:else if hasData}
            {Object.keys(gran.coverage).length} instruments collected
          {:else}
            No data
          {/if}
        </span>
        <span class="expand-icon">{expandedGrans.has(gran.name) ? "−" : "+"}</span>
      </button>

      {#if expandedGrans.has(gran.name)}
        <div class="gran-body">
          {#each groupOrder as groupType}
            {@const instruments = data.groups[groupType] ?? []}
            {#if instruments.length > 0}
              {@const instNames = instruments.map((i: any) => i.name)}
              {@const stats = groupStats(gran.name, instNames)}
              {@const groupKey = `${gran.name}-${groupType}`}
              <div class="group-row">
                <button class="group-header" onclick={() => toggleGroup(groupKey)}>
                  <span class="group-name">{groupLabels[groupType] ?? groupType}</span>
                  <span class="group-stats">
                    {stats.collected}/{stats.total} collected
                  </span>
                  <span class="expand-icon">{expandedGroups.has(groupKey) ? "−" : "+"}</span>
                </button>
                <div class="group-actions">
                  {#if data.hasApiKey && (!job || job.progress.status !== "running")}
                    <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", instNames)}>
                      Fetch Latest
                    </button>
                    <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", instNames)}>
                      Fetch Previous
                    </button>
                  {/if}
                </div>

                {#if expandedGroups.has(groupKey)}
                  <table class="inst-table">
                    <thead>
                      <tr>
                        <th>Instrument</th>
                        <th>Days</th>
                        <th>Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each instruments as inst}
                        {@const cov = gran.coverage[inst.name]}
                        <tr class:no-data={!cov}>
                          <td class="inst-name">{inst.displayName} <span class="muted">({inst.name})</span></td>
                          <td>{cov?.days ?? "—"}</td>
                          <td class="date">{cov ? `${cov.earliest} to ${cov.latest}` : "—"}</td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                {/if}
              </div>
            {/if}
          {/each}

          <!-- Show any groups not in groupOrder -->
          {#each Object.keys(data.groups).filter(g => !groupOrder.includes(g)) as groupType}
            {@const instruments = data.groups[groupType]}
            {@const instNames = instruments.map((i: any) => i.name)}
            {@const stats = groupStats(gran.name, instNames)}
            {@const groupKey = `${gran.name}-${groupType}`}
            <div class="group-row">
              <button class="group-header" onclick={() => toggleGroup(groupKey)}>
                <span class="group-name">{groupType}</span>
                <span class="group-stats">{stats.collected}/{stats.total} collected</span>
                <span class="expand-icon">{expandedGroups.has(groupKey) ? "−" : "+"}</span>
              </button>
              <div class="group-actions">
                {#if data.hasApiKey && (!job || job.progress.status !== "running")}
                  <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", instNames)}>
                    Fetch Latest
                  </button>
                  <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", instNames)}>
                    Fetch Previous
                  </button>
                {/if}
              </div>
              {#if expandedGroups.has(groupKey)}
                <table class="inst-table">
                  <thead>
                    <tr><th>Instrument</th><th>Days</th><th>Range</th></tr>
                  </thead>
                  <tbody>
                    {#each instruments as inst}
                      {@const cov = gran.coverage[inst.name]}
                      <tr class:no-data={!cov}>
                        <td class="inst-name">{inst.displayName} <span class="muted">({inst.name})</span></td>
                        <td>{cov?.days ?? "—"}</td>
                        <td class="date">{cov ? `${cov.earliest} to ${cov.latest}` : "—"}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .data-page h1 {
    font-size: 1.4em;
    margin-bottom: 16px;
  }
  .success {
    background: #0d2818; color: #3fb950;
    padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 16px;
  }
  .error {
    background: #5d1a1a; color: #f85149;
    padding: 8px 12px; border-radius: 4px; font-size: 0.85em; margin-bottom: 16px;
  }
  .warn { color: #d29922; font-size: 0.85em; }
  .info-bar {
    background: #161b22; border: 1px solid #21262d; border-radius: 6px;
    padding: 12px 16px; margin-bottom: 20px;
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  }
  .info-item { display: flex; align-items: center; gap: 8px; font-size: 0.9em; }
  .info-item .label { color: #8b949e; }
  .muted { color: #484f58; font-size: 0.85em; }
  .btn-sm {
    padding: 3px 8px; border-radius: 3px; font-size: 0.8em;
    cursor: pointer; border: 1px solid;
  }
  .btn-refresh { background: transparent; color: #58a6ff; border-color: #30363d; }
  .btn-refresh:hover { border-color: #58a6ff; }
  .btn-collect { background: transparent; color: #58a6ff; border-color: #30363d; white-space: nowrap; }
  .btn-collect:hover { border-color: #58a6ff; }
  .gran-section {
    border: 1px solid #21262d; border-radius: 6px; margin-bottom: 8px;
    overflow: hidden;
  }
  .gran-section.has-data { border-color: #30363d; }
  .gran-header {
    display: flex; align-items: center; gap: 12px;
    width: 100%; padding: 10px 16px; background: #0d1117;
    border: none; color: #c9d1d9; cursor: pointer; text-align: left;
    font-size: 0.9em;
  }
  .gran-header:hover { background: #161b22; }
  .gran-name { font-weight: 700; font-family: monospace; min-width: 40px; }
  .gran-summary { flex: 1; color: #8b949e; font-size: 0.85em; }
  .expand-icon { color: #484f58; font-size: 1.1em; }
  .collecting { color: #d29922; }
  .gran-body { padding: 8px 16px 16px; }
  .group-row {
    margin-bottom: 8px;
  }
  .group-header {
    display: flex; align-items: center; gap: 12px;
    width: 100%; padding: 6px 0; background: none;
    border: none; border-bottom: 1px solid #21262d;
    color: #c9d1d9; cursor: pointer; text-align: left;
    font-size: 0.88em;
  }
  .group-name { font-weight: 600; color: #58a6ff; }
  .group-stats { flex: 1; color: #8b949e; font-size: 0.85em; }
  .group-actions {
    display: flex; gap: 4px; padding: 6px 0;
  }
  .inst-table {
    width: 100%; border-collapse: collapse; font-size: 0.82em;
    margin-top: 4px;
  }
  .inst-table th {
    text-align: left; padding: 4px 8px; color: #8b949e;
    border-bottom: 1px solid #21262d;
  }
  .inst-table td {
    padding: 4px 8px; border-bottom: 1px solid #161b22;
  }
  .inst-table tr:hover td { background: #161b22; }
  .inst-name { font-weight: 500; }
  .no-data td { color: #484f58; }
  .date { color: #8b949e; font-size: 0.9em; }
</style>
