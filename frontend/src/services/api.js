import axios from 'axios';

// Use environment variable for production, fallback to localhost for development
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';


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

    getActivityTimeline: async (id, days = 365) => {
        const response = await api.get(`/repositories/${id}/activity-timeline?days=${days}`);
        return response.data;
    },

    getLeaderboard: async (id, days = 365) => {
        const response = await api.get(`/repositories/${id}/leaderboard?days=${days}`);
        return response.data;
    },

    getReviewerLoad: async (id, days = 365) => {
        const response = await api.get(`/repositories/${id}/reviewer-load?days=${days}`);
        return response.data;
    },

    getNewcomerFunnel: async (id, days = 365) => {
        const response = await api.get(`/repositories/${id}/newcomer-funnel?days=${days}`);
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

    getPRReviewHealth: async (repoFullName, days = 90) => {
        const response = await api.get(`/health/pr-review?repo=${repoFullName}&days=${days}`);
        return response.data;
    },

    generateNudge: async (prTitle, authorName, daysWaiting) => {
        const response = await api.post('/nudge/generate', {
            pr_title: prTitle,
            author_name: authorName,
            days_waiting: daysWaiting
        });
        return response.data;
    },

    // Issues Analytics Endpoints (6 new endpoints)
    getIssueTriageLoad: async (id, days = 90) => {
        const response = await api.get(`/repositories/${id}/issue-triage-load?days=${days}`);
        return response.data;
    },

    getIssueWorkloadBalance: async (id) => {
        const response = await api.get(`/repositories/${id}/issue-workload-balance`);
        return response.data;
    },

    getIssueTrends: async (id, days = 90) => {
        const response = await api.get(`/repositories/${id}/issue-trends?days=${days}`);
        return response.data;
    },

    getFirstTimerIssueQueue: async (id) => {
        const response = await api.get(`/repositories/${id}/first-timer-issue-queue`);
        return response.data;
    },

    getZombieIssues: async (id) => {
        const response = await api.get(`/repositories/${id}/zombie-issues`);
        return response.data;
    },

    getIssueCategoryBreakdown: async (id) => {
        const response = await api.get(`/repositories/${id}/issue-category-breakdown`);
        return response.data;
    },

    // Bulk Operations Stubs
    bulkMarkIssuesStale: async (id, issueNumbers, reason = "") => {
        const response = await api.post(`/repositories/${id}/issues/bulk-mark-stale`, {
            issue_numbers: issueNumbers,
            reason
        });
        return response.data;
    },

    bulkCloseIssues: async (id, issueNumbers, reason = "") => {
        const response = await api.post(`/repositories/${id}/issues/bulk-close`, {
            issue_numbers: issueNumbers,
            reason
        });
        return response.data;
    }
};

export default api;
