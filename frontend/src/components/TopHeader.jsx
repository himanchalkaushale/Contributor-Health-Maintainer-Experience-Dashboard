import React, { useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { Loader2, RefreshCw, Github } from 'lucide-react';

const TopHeader = () => {
    const { repos, selectedRepo, selectRepo, syncRepo, syncing, lastSynced } = useRepo();
    const [inputValue, setInputValue] = useState('');

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
                {selectedRepo?.sync_status === 'syncing' ? (
                    <div className="flex flex-col w-48 gap-1 border-l pl-6">
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Syncing...</span>
                            <span>{Math.round((selectedRepo.sync_item_count / (selectedRepo.sync_total_items || 1)) * 100)}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-500"
                                style={{ width: `${(selectedRepo.sync_item_count / (selectedRepo.sync_total_items || 1)) * 100}%` }}
                            />
                        </div>
                        <div className="text-[10px] text-muted-foreground text-right">
                            {(() => {
                                const total = selectedRepo.sync_total_items || 1;
                                const current = selectedRepo.sync_item_count || 0;
                                const elapsed = (new Date() - new Date(selectedRepo.last_synced_at)) / 1000; // seconds
                                if (current === 0 || elapsed < 2) return "Calculating...";

                                const rate = current / elapsed; // items per second
                                const remaining = total - current;
                                const estSeconds = remaining / rate;

                                if (estSeconds < 60) return `${Math.ceil(estSeconds)}s remaining`;
                                return `${Math.ceil(estSeconds / 60)}m remaining`;
                            })()}
                        </div>
                    </div>
                ) : (
                    lastSynced && (
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 border-l pl-6">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                            <span>Last updated: {Math.max(0, Math.floor((new Date() - lastSynced) / 60000))} min ago</span>
                        </div>
                    )
                )}
            </div>
        </header>
    );
};

export default TopHeader;
