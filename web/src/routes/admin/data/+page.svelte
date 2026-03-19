<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";

  let { data, form } = $props();

  interface CollectJob {
    id: string;
    granularity: string;
    direction: string;
    label?: string;
    instruments?: string[];
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

  // Fetch jobs on mount, then poll while any are running
  async function fetchJobs() {
    try {
      const res = await fetch("/api/admin/collect");
      if (res.ok) {
        const d = await res.json();
        collectJobs = d.jobs;
      }
    } catch { /* ignore */ }
  }

  import { onMount } from "svelte";
  onMount(() => { fetchJobs(); });

  $effect(() => {
    const hasRunning = collectJobs.some((j) => j.progress.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(async () => {
      await fetchJobs();
      if (!collectJobs.some((j) => j.progress.status === "running")) {
        await invalidateAll();
      }
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

  function getJobForGran(granularity: string): CollectJob | undefined {
    return collectJobs.find((j) => j.granularity === granularity && j.progress.status === "running")
      ?? collectJobs.findLast((j: CollectJob) => j.granularity === granularity);
  }

  function isGroupBusy(granularity: string, instNames: string[]): boolean {
    return collectJobs.some((j) => {
      if (j.granularity !== granularity || j.progress.status !== "running") return false;
      if (!j.instruments) return true; // no instrument info — assume overlap
      const jobSet = new Set(j.instruments);
      return instNames.some((i) => jobSet.has(i));
    });
  }

  async function collectGroup(granularity: string, direction: "latest" | "previous", instruments: string[], label?: string) {
    const range = fetchRange(granularity, direction, instruments);
    const fullLabel = label ? `${label} (${range})` : (instruments.length === 1 ? `${instruments[0]} (${range})` : `${instruments.length} instruments (${range})`);
    try {
      const res = await fetch("/api/admin/collect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granularity, direction, instruments, label: fullLabel }),
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

  const GRAN_SECONDS: Record<string, number> = {
    S5: 5, S10: 10, S15: 15, S30: 30,
    M1: 60, M2: 120, M4: 240, M5: 300,
    M10: 600, M15: 900, M30: 1800,
    H1: 3600, H2: 7200, H3: 10800, H4: 14400,
    H6: 21600, H8: 28800, H12: 43200,
    D: 86400, W: 604800,
  };

  function getBatchDays(gran: string): number {
    const s = GRAN_SECONDS[gran] ?? 60;
    if (s <= 60) return 7;
    if (s <= 1800) return 30;
    if (s <= 43200) return 90;
    return 365;
  }

  function fetchRange(granularity: string, direction: "latest" | "previous", instruments: string[]): string {
    const coverage = data.granularities.find((g: any) => g.name === granularity)?.coverage ?? {};
    let earliest: string | null = null;
    let latest: string | null = null;
    for (const inst of instruments) {
      const cov = coverage[inst];
      if (!cov) continue;
      if (!earliest || cov.earliest < earliest) earliest = cov.earliest;
      if (!latest || cov.latest > latest) latest = cov.latest;
    }
    const batchDays = getBatchDays(granularity);
    const ms = batchDays * 86_400_000;
    let from: Date, to: Date;
    if (direction === "latest") {
      to = new Date();
      from = latest ? new Date(new Date(latest).getTime() - 86_400_000) : new Date(Date.now() - ms);
    } else {
      if (earliest) {
        to = new Date(earliest);
        from = new Date(to.getTime() - ms);
      } else {
        to = new Date();
        from = new Date(Date.now() - ms);
      }
    }
    return `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
  }

  const groupOrder = ["MAJORS", "CROSSES", "EXOTICS", "METAL", "CFD"];
  const groupLabels: Record<string, string> = {
    MAJORS: "Forex — Majors",
    CROSSES: "Forex — Crosses",
    EXOTICS: "Forex — Exotics",
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

  {#if collectJobs.some((j) => j.progress.status === "running")}
    <div class="active-jobs">
      <h3>Active Collections</h3>
      {#each collectJobs.filter((j) => j.progress.status === "running") as job}
        {@const instCount = job.instruments?.length ?? job.progress.totalInstruments}
        <div class="job-row">
          <span class="job-gran">{job.granularity}</span>
          <span class="job-dir">{job.direction}</span>
          <span class="job-scope">{job.label ?? `${instCount} instruments`}</span>
          <span class="job-current">{job.progress.currentInstrument ?? "Starting..."}</span>
          <span class="job-progress">{job.progress.completedInstruments}/{instCount} done — {job.progress.fetchedDayFiles} files</span>
          {#if job.progress.errors > 0}
            <span class="job-errors">{job.progress.errors} errors</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  {#each data.granularities as gran}
    {@const hasData = Object.keys(gran.coverage).length > 0}
    {@const job = getJobForGran(gran.name)}
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
                <div class="group-top">
                <button class="group-header" onclick={() => toggleGroup(groupKey)}>
                  <span class="group-name">{groupLabels[groupType] ?? groupType}</span>
                  <span class="group-stats">
                    {stats.collected}/{stats.total} collected
                  </span>
                  <span class="expand-icon">{expandedGroups.has(groupKey) ? "−" : "+"}</span>
                </button>
                <div class="group-actions" onclick={(e) => e.stopPropagation()}>
                  {#if data.hasApiKey && !isGroupBusy(gran.name, instNames)}
                    <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", instNames, groupLabels[groupType] ?? groupType)}
                      title={fetchRange(gran.name, "latest", instNames)}>
                      Fetch Latest <span class="range-hint">{fetchRange(gran.name, "latest", instNames)}</span>
                    </button>
                    <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", instNames, groupLabels[groupType] ?? groupType)}
                      title={fetchRange(gran.name, "previous", instNames)}>
                      Fetch Previous <span class="range-hint">{fetchRange(gran.name, "previous", instNames)}</span>
                    </button>
                  {/if}
                </div>
                </div>

                {#if expandedGroups.has(groupKey)}
                  <table class="inst-table">
                    <thead>
                      <tr>
                        <th>Instrument</th>
                        <th>Days</th>
                        <th>Range</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each instruments as inst}
                        {@const cov = gran.coverage[inst.name]}
                        <tr class:no-data={!cov}>
                          <td class="inst-name">{inst.displayName} <span class="muted">({inst.name})</span></td>
                          <td>{cov?.days ?? "—"}</td>
                          <td class="date">{cov ? `${cov.earliest} to ${cov.latest}` : "—"}</td>
                          <td class="inst-actions">
                            {#if data.hasApiKey && !isGroupBusy(gran.name, [inst.name])}
                              <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", [inst.name])} title={fetchRange(gran.name, "latest", [inst.name])}>Latest <span class="range-hint">{fetchRange(gran.name, "latest", [inst.name])}</span></button>
                              <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", [inst.name])} title={fetchRange(gran.name, "previous", [inst.name])}>Previous <span class="range-hint">{fetchRange(gran.name, "previous", [inst.name])}</span></button>
                            {/if}
                          </td>
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
              <div class="group-top">
              <button class="group-header" onclick={() => toggleGroup(groupKey)}>
                <span class="group-name">{groupType}</span>
                <span class="group-stats">{stats.collected}/{stats.total} collected</span>
                <span class="expand-icon">{expandedGroups.has(groupKey) ? "−" : "+"}</span>
              </button>
              <div class="group-actions" onclick={(e) => e.stopPropagation()}>
                {#if data.hasApiKey && !isGroupBusy(gran.name, instNames)}
                  <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", instNames, groupType)}
                    title={fetchRange(gran.name, "latest", instNames)}>
                    Fetch Latest <span class="range-hint">{fetchRange(gran.name, "latest", instNames)}</span>
                  </button>
                  <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", instNames, groupType)}
                    title={fetchRange(gran.name, "previous", instNames)}>
                    Fetch Previous <span class="range-hint">{fetchRange(gran.name, "previous", instNames)}</span>
                  </button>
                {/if}
              </div>
              </div>
              {#if expandedGroups.has(groupKey)}
                <table class="inst-table">
                  <thead>
                    <tr><th>Instrument</th><th>Days</th><th>Range</th><th></th></tr>
                  </thead>
                  <tbody>
                    {#each instruments as inst}
                      {@const cov = gran.coverage[inst.name]}
                      <tr class:no-data={!cov}>
                        <td class="inst-name">{inst.displayName} <span class="muted">({inst.name})</span></td>
                        <td>{cov?.days ?? "—"}</td>
                        <td class="date">{cov ? `${cov.earliest} to ${cov.latest}` : "—"}</td>
                        <td class="inst-actions">
                          {#if data.hasApiKey && !isGroupBusy(gran.name, [inst.name])}
                            <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "latest", [inst.name])}>Latest</button>
                            <button class="btn-sm btn-collect" onclick={() => collectGroup(gran.name, "previous", [inst.name])}>Previous</button>
                          {/if}
                        </td>
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
  .active-jobs {
    background: #161b22; border: 1px solid #d29922; border-radius: 6px;
    padding: 12px 16px; margin-bottom: 16px;
  }
  .active-jobs h3 { font-size: 0.85em; color: #d29922; margin: 0 0 8px; }
  .job-row {
    display: flex; gap: 12px; align-items: center; font-size: 0.85em;
    padding: 4px 0; border-bottom: 1px solid #21262d;
  }
  .job-row:last-child { border-bottom: none; }
  .job-gran { font-weight: 700; font-family: monospace; min-width: 30px; }
  .job-dir { color: #8b949e; min-width: 60px; }
  .job-scope { color: #c9d1d9; font-weight: 600; min-width: 100px; }
  .job-current { color: #d29922; min-width: 80px; }
  .job-progress { color: #8b949e; }
  .job-errors { color: #f85149; }
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
  .range-hint { color: #484f58; font-size: 0.9em; margin-left: 4px; }
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
  .group-top {
    display: flex; align-items: center; gap: 0;
    border-bottom: 1px solid #21262d;
  }
  .group-header {
    display: flex; align-items: center; gap: 12px;
    flex: 1; padding: 6px 0; background: none;
    border: none;
    color: #c9d1d9; cursor: pointer; text-align: left;
    font-size: 0.88em;
  }
  .group-name { font-weight: 600; color: #58a6ff; }
  .group-stats { flex: 1; color: #8b949e; font-size: 0.85em; }
  .group-actions {
    display: flex; gap: 4px; align-items: center;
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
  .inst-actions { display: flex; gap: 4px; justify-content: flex-end; }
  .date { color: #8b949e; font-size: 0.9em; }
</style>
