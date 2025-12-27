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

                {/* Sync Time */}
                {lastSynced && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 border-l pl-6">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                        Last updated: {Math.floor((new Date() - lastSynced) / 60000)} min ago
                    </div>
                )}
            </div>
        </header>
    );
};

export default TopHeader;
