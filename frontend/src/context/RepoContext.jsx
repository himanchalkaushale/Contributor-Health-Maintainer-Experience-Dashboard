import React, { createContext, useContext, useState, useEffect } from 'react';
import { repoService } from '@/services/api';

const RepoContext = createContext();

export const useRepo = () => useContext(RepoContext);

export const RepoProvider = ({ children }) => {
    const [repos, setRepos] = useState([]);
    const [selectedRepo, setSelectedRepo] = useState(null);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [lastSynced, setLastSynced] = useState(null);

    // Polling for sync status
    useEffect(() => {
        const syncingRepo = repos.find(r => r.sync_status === 'syncing' || r.sync_status === 'queued');
        let interval;
        if (syncingRepo) {
            interval = setInterval(() => {
                fetchRepos(true); // silent fetch
            }, 2000);
        }
        return () => clearInterval(interval);
    }, [repos]);

    const fetchRepos = async (silent = false) => {
        try {
            if (!silent) setLoading(true);
            const data = await repoService.getRepositories();

            // Preserve selection and merge data if needed, but replacing is fine for now
            // Just ensure we don't lose the selection object reference if possible, 
            // but actually we store selectedRepo separately.
            // We should update selectedRepo if it's the one being synced to get the new stats

            setRepos(prev => {
                // Determine if we need to update selectedRepo
                if (selectedRepo) {
                    const updatedSelected = data.find(r => r.id === selectedRepo.id);
                    if (updatedSelected) {
                        // Only update if stats changed to avoid excessive re-renders?
                        // Actually we want re-renders for progress
                        if (JSON.stringify(updatedSelected) !== JSON.stringify(selectedRepo)) {
                            setSelectedRepo(updatedSelected);
                        }
                    }
                }
                return data;
            });

            if (data.length > 0 && !selectedRepo && !silent) {
                setSelectedRepo(data[0]);
            }
        } catch (err) {
            console.error(err);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    const syncRepo = async (owner, name) => {
        try {
            setSyncing(true);
            // This returns the 'queued' repo object
            const repo = await repoService.syncRepo(owner, name);

            // Update immediately
            setRepos(prev => {
                const exists = prev.find(r => r.id === repo.id);
                if (exists) return prev.map(r => r.id === repo.id ? repo : r);
                return [...prev, repo];
            });

            setSelectedRepo(repo);
            return repo;
        } catch (err) {
            throw err;
        } finally {
            setSyncing(false);
        }
    };

    const selectRepo = (repoId) => {
        const repo = repos.find(r => r.id === parseInt(repoId));
        if (repo) setSelectedRepo(repo);
    };

    return (
        <RepoContext.Provider value={{
            repos,
            selectedRepo,
            loading,
            syncing,
            lastSynced,
            syncRepo,
            selectRepo
        }}>
            {children}
        </RepoContext.Provider>
    );
};
