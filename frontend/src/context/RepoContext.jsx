import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { repoService } from '@/services/api';
import { parseBackendDate } from '@/lib/utils';

const RepoContext = createContext();

export const useRepo = () => useContext(RepoContext);

export const RepoProvider = ({ children }) => {
    const [repos, setRepos] = useState([]);
    const [selectedRepoId, setSelectedRepoId] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);

    // Keep latest repos accessible inside interval callbacks without re-creating them.
    const reposRef = useRef(repos);
    useEffect(() => { reposRef.current = repos; }, [repos]);

    // selectedRepo is DERIVED from the live repos list so progress fields
    // (sync_status / sync_item_count / sync_total_items) always reflect the
    // latest poll, regardless of which page is mounted.
    const selectedRepo = useMemo(
        () => repos.find(r => r.id === selectedRepoId) || null,
        [repos, selectedRepoId]
    );

    const fetchRepos = useCallback(async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await repoService.getRepositories();
            setRepos(data);

            // Auto-select first repo if none selected yet.
            setSelectedRepoId(prev => {
                if (prev && data.some(r => r.id === prev)) return prev;
                return data.length > 0 ? data[0].id : null;
            });

            // Track last completed sync time for the "Last updated" label.
            // Pick the most recent across all repos, parsed as UTC (the backend
            // stores naive UTC datetimes).
            const newestSync = data
                .map(r => r.last_synced_at)
                .filter(Boolean)
                .map(parseBackendDate)
                .filter(d => d && !isNaN(d.getTime()))
                .sort((a, b) => a.getTime() - b.getTime())
                .pop();
            if (newestSync) setLastSynced(newestSync);

            return data;
        } catch (err) {
            console.error(err);
            return reposRef.current;
        } finally {
            if (!silent) setLoading(false);
        }
    }, []);

    // Initial load.
    useEffect(() => {
        fetchRepos();
    }, [fetchRepos]);

    // Global sync polling: runs whenever ANY repo is syncing/queued, and keeps
    // running across page navigation because this provider sits above the router.
    const anySyncing = repos.some(
        r => r.sync_status === 'syncing' || r.sync_status === 'queued'
    );

    useEffect(() => {
        if (!anySyncing) return;
        const interval = setInterval(() => {
            fetchRepos(true); // silent poll
        }, 2000);
        return () => clearInterval(interval);
    }, [anySyncing, fetchRepos]);

    const syncRepo = async (owner, name) => {
        try {
            setSyncing(true);
            const repo = await repoService.syncRepo(owner, name);

            // Merge the queued/syncing repo into the list immediately.
            setRepos(prev => {
                const exists = prev.some(r => r.id === repo.id);
                return exists ? prev.map(r => (r.id === repo.id ? repo : r)) : [...prev, repo];
            });
            setSelectedRepoId(repo.id);
            return repo;
        } catch (err) {
            throw err;
        } finally {
            setSyncing(false);
        }
    };

    const selectRepo = (repoId) => {
        setSelectedRepoId(parseInt(repoId));
    };

    return (
        <RepoContext.Provider value={{
            repos,
            selectedRepo,
            loading,
            syncing,
            lastSynced,
            syncRepo,
            selectRepo,
            refreshRepos: fetchRepos,
        }}>
            {children}
        </RepoContext.Provider>
    );
};
