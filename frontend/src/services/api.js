import axios from 'axios';

const API_URL = 'http://localhost:8000/api';

const api = axios.create({
    baseURL: API_URL,
    headers: {
        'Content-Type': 'application/json',
    },
});

export const repoService = {
    syncRepo: async (owner, name) => {
        const response = await api.post('/repositories/sync', { owner, name });
        return response.data;
    },

    getRepoSignals: async (id) => {
        const response = await api.get(`/repositories/${id}/signals`);
        return response.data;
    },

    getRepoOverview: async (id) => {
        const response = await api.get(`/repositories/${id}/overview`);
        return response.data;
    },

    getContributorsHealth: async (id) => {
        const response = await api.get(`/repositories/${id}/contributors-health`);
        return response.data;
    },

    deleteRepo: async (id) => {
        const response = await api.delete(`/repositories/${id}`);
        return response.data;
    },

    getRepositories: async () => {
        const response = await api.get('/repositories');
        return response.data;
    },

    getPRBottlenecks: async (id) => {
        const response = await api.get(`/repositories/${id}/pr-bottlenecks`);
        return response.data;
    },

    getIssuesHealth: async (id) => {
        const response = await api.get(`/repositories/${id}/issues-health`);
        return response.data;
    },

    getPRReviewHealth: async (repoFullName) => {
        const response = await api.get(`/health/pr-review?repo=${repoFullName}`);
        return response.data;
    },

    generateNudge: async (prTitle, authorName, daysWaiting) => {
        const response = await api.post('/nudge/generate', {
            pr_title: prTitle,
            author_name: authorName,
            days_waiting: daysWaiting
        });
        return response.data;
    }
};

export default api;
