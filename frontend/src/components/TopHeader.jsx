import React, { useState, useEffect, useRef } from 'react';
import { useRepo } from '@/context/RepoContext';
import { Loader2, RefreshCw, Github, CheckCircle2 } from 'lucide-react';
import { formatRelativeTime, parseBackendDate } from '@/lib/utils';

const TopHeader = () => {
    const { repos, selectedRepo, selectRepo, syncRepo, syncing, lastSynced } = useRepo();
    const [inputValue, setInputValue] = useState('');

    // Re-render once a minute so "Xm ago" / "Xh ago" stays live without the
    // label freezing on a stale value.
    const [, setTick] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 60000);
        return () => clearInterval(id);
    }, []);

    // Briefly show a "100% Linked" confirmation when the selected repo finishes syncing.
    const [justCompleted, setJustCompleted] = useState(false);
    const prevStatusRef = useRef(selectedRepo?.sync_status);
    useEffect(() => {
        const prev = prevStatusRef.current;
        const curr = selectedRepo?.sync_status;
        if ((prev === 'syncing' || prev === 'queued') && curr === 'completed') {
            setJustCompleted(true);
            const t = setTimeout(() => setJustCompleted(false), 4000);
            prevStatusRef.current = curr;
            return () => clearTimeout(t);
        }
        prevStatusRef.current = curr;
    }, [selectedRepo?.sync_status]);

    const handleSyncSubmit = async (e) => {
        e.preventDefault();
        if (!inputValue.includes('/')) return;
        const [owner, name] = inputValue.split('/');
        await syncRepo(owner, name);
        setInputValue('');
    };

    return (
        <header className="h-16 bg-background border-b flex items-center justify-between px-8 sticky top-0 z-20">
            {/* Title */}
            <h1 className="text-lg font-semibold text-foreground tracking-tight">
                Contributor Health Dashboard
            </h1>

            {/* Repo Context & Actions */}
            <div className="flex items-center gap-6">

                {/* Sync Status / Repo Selector */}
                <div className="flex items-center gap-3">
                    {/* Quick Select existing */}
                    {repos.length > 0 && (
                        <select
                            value={selectedRepo?.id || ''}
                            onChange={(e) => selectRepo(e.target.value)}
                            className="text-sm bg-transparent border-none focus:ring-0 font-medium text-foreground cursor-pointer"
                        >
                            {repos.map(r => (
                                <option key={r.id} value={r.id}>{r.full_name}</option>
                            ))}
                        </select>
                    )}

                    {/* Sync New */}
                    <form onSubmit={handleSyncSubmit} className="flex items-center bg-secondary/50 rounded-md px-3 py-1.5 ring-1 ring-border">
                        <Github className="w-3.5 h-3.5 text-muted-foreground mr-2" />
                        <input
                            type="text"
                            placeholder="owner/repo"
                            className="bg-transparent border-none text-sm w-32 focus:outline-none placeholder:text-muted-foreground/50"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                        />
                        <button
                            type="submit"
                            disabled={syncing || !inputValue}
                            className="ml-2 hover:text-primary transition-colors disabled:opacity-50"
                        >
                            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                        </button>
                    </form>
                </div>

                {/* Sync Status Display */}
                {(selectedRepo?.sync_status === 'syncing' || selectedRepo?.sync_status === 'queued') ? (
                    (() => {
                        const total = selectedRepo.sync_total_items || 0;
                        const current = selectedRepo.sync_item_count || 0;
                        // While counts are still being resolved (total unknown), show indeterminate state
                        const indeterminate = selectedRepo.sync_status === 'queued' || total === 0;
                        const rawPct = indeterminate ? 0 : Math.round((current / total) * 100);
                        // Clamp to 99% while still syncing so it never reads 100% prematurely.
                        const pct = indeterminate ? 0 : Math.min(99, Math.max(0, rawPct));

                        const stageLabel = selectedRepo.sync_status === 'queued'
                            ? 'Queued...'
                            : indeterminate
                                ? 'Preparing...'
                                : `Linking ${Math.min(current, total)}/${total}`;

                        return (
                            <div className="flex flex-col w-48 gap-1 border-l pl-6">
                                <div className="flex justify-between text-xs text-muted-foreground">
                                    <span>{stageLabel}</span>
                                    <span className="font-medium text-foreground">
                                        {indeterminate ? '...' : `${pct}%`}
                                    </span>
                                </div>
                                <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                                    {indeterminate ? (
                                        <div className="h-full w-1/3 bg-primary/70 rounded-full animate-pulse" />
                                    ) : (
                                        <div
                                            className="h-full bg-primary transition-all duration-500"
                                            style={{ width: `${pct}%` }}
                                        />
                                    )}
                                </div>
                                <div className="text-[10px] text-muted-foreground text-right">
                                    {(() => {
                                        if (indeterminate) return "Calculating...";
                                        const syncStart = parseBackendDate(selectedRepo.last_synced_at);
                                        const elapsed = (Date.now() - (syncStart ? syncStart.getTime() : Date.now())) / 1000; // seconds
                                        if (current === 0 || elapsed < 2) return "Calculating...";

                                        const rate = current / elapsed; // items per second
                                        const remaining = Math.max(0, total - current);
                                        const estSeconds = remaining / rate;

                                        if (estSeconds < 60) return `${Math.ceil(estSeconds)}s remaining`;
                                        return `${Math.ceil(estSeconds / 60)}m remaining`;
                                    })()}
                                </div>
                            </div>
                        );
                    })()
                ) : selectedRepo?.sync_status === 'failed' ? (
                    <div className="text-xs text-red-500 flex items-center gap-1.5 border-l pl-6">
                        <div className="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                        <span>Sync failed — try again</span>
                    </div>
                ) : justCompleted ? (
                    <div className="flex flex-col w-48 gap-1 border-l pl-6">
                        <div className="flex justify-between text-xs">
                            <span className="text-emerald-600 font-medium">100% Linked</span>
                            <span className="font-medium text-emerald-600">100%</span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: '100%' }} />
                        </div>
                        <div className="text-[10px] text-emerald-600 flex items-center gap-1 justify-end">
                            <CheckCircle2 className="w-3 h-3" /> Sync complete
                        </div>
                    </div>
                ) : (
                    lastSynced && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 border-l pl-6">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                            <span>Last updated: {formatRelativeTime(lastSynced)}</span>
                        </div>
                    )
                )}
            </div>
        </header>
    );
};

export default TopHeader;
