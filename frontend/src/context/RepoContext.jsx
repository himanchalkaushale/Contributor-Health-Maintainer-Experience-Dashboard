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

    useEffect(() => {
        fetchRepos();
    }, []);

    const fetchRepos = async () => {
        try {
            setLoading(true);
            const data = await repoService.getRepositories();
            setRepos(data);
            if (data.length > 0 && !selectedRepo) {
                setSelectedRepo(data[0]);
                setLastSynced(new Date()); // Mock sync time for now or get from data
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const syncRepo = async (owner, name) => {
        try {
            setSyncing(true);
            const repo = await repoService.syncRepo(owner, name);

            // Update list or select new repo
            setRepos(prev => {
                const exists = prev.find(r => r.id === repo.id);
                if (exists) return prev.map(r => r.id === repo.id ? repo : r);
                return [...prev, repo];
            });

            setSelectedRepo(repo);
            setLastSynced(new Date());
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
