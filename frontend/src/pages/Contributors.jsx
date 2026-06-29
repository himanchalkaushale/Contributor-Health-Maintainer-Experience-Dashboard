import React, { useEffect, useState, useMemo } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { formatDuration } from '@/lib/utils';
import { useHashScroll } from '@/lib/scroll';
import SummaryCard from '@/components/SummaryCard';
import {
    Loader2, Users, UserPlus, UserMinus, Activity, Clock, AlertTriangle,
    Info, GitPullRequest, GitMerge, MessageSquare, GitCommit, Star, RefreshCw,
    TrendingUp, BarChart3, Layers
} from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend
} from 'recharts';

const EVENT_COLORS = {
    pr_opened: '#6366f1',
    pr_merged: '#22c55e',
    pr_closed: '#ef4444',
    review_submitted: '#a855f7',
    issue_opened: '#f59e0b',
    issue_closed: '#14b8a6',
    issue_comment: '#3b82f6',
    commit: '#64748b',
};

const EVENT_LABELS = {
    pr_opened: 'PRs Opened',
    pr_merged: 'PRs Merged',
    pr_closed: 'PRs Closed',
    review_submitted: 'Reviews',
    issue_opened: 'Issues Opened',
    issue_closed: 'Issues Closed',
    issue_comment: 'Comments',
    commit: 'Commits',
};

const Contributors = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [timeline, setTimeline] = useState(null);
    const [leaderboard, setLeaderboard] = useState(null);
    const [reviewerLoad, setReviewerLoad] = useState(null);
    const [funnel, setFunnel] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [sortKey, setSortKey] = useState('total_contributions');

    // Activity chart controls
    const [chartType, setChartType] = useState('area'); // 'area' | 'bar'
    const [groupMode, setGroupMode] = useState('detailed'); // 'detailed' | 'category'
    const [hiddenSeries, setHiddenSeries] = useState({}); // { [seriesKey]: true }

    const isSyncing = selectedRepo && (selectedRepo.sync_status === 'syncing' || selectedRepo.sync_status === 'queued');

    useEffect(() => {
        if (!selectedRepo) return;
        let cancelled = false;

        const fetchAll = async (silent = false, lightweight = false) => {
            if (!silent) setLoading(true);
            setError(null);
            try {
                // While a sync is in progress, poll only the lightweight health
                // endpoint so the 5s cadence doesn't fan out to 4 expensive
                // 365-day analytics queries on every tick.
                const calls = lightweight
                    ? [await repoService.getContributorsHealth(selectedRepo.id).then(v => ({ status: 'fulfilled', value: v }))]
                    : await Promise.allSettled([
                        repoService.getContributorsHealth(selectedRepo.id),
                        repoService.getActivityTimeline(selectedRepo.id),
                        repoService.getLeaderboard(selectedRepo.id),
                        repoService.getReviewerLoad(selectedRepo.id),
                        repoService.getNewcomerFunnel(selectedRepo.id),
                    ]);
                const [health, tl, lb, rl, fn] = lightweight
                    ? [calls[0], undefined, undefined, undefined, undefined]
                    : calls;
                if (cancelled) return;
                if (health && health.status === 'fulfilled') setData(health.value);
                if (tl && tl.status === 'fulfilled') setTimeline(tl.value);
                if (lb && lb.status === 'fulfilled') setLeaderboard(lb.value);
                if (rl && rl.status === 'fulfilled') setReviewerLoad(rl.value);
                if (fn && fn.status === 'fulfilled') setFunnel(fn.value);
                if (health && health.status === 'rejected' && (!tl || tl.status === 'rejected')) {
                    setError('Failed to fetch contributor analytics.');
                }
            } catch {
                if (!cancelled) setError('Failed to fetch contributor analytics.');
            } finally {
                if (!cancelled && !silent) setLoading(false);
            }
        };

        // Initial full fetch.
        fetchAll(false, false);
        // Refresh quickly while syncing (health-only poll to fill in partial data),
        // otherwise poll the full analytics set every 5 min.
        const refreshMs = isSyncing ? 5000 : 5 * 60 * 1000;
        const interval = setInterval(() => fetchAll(true, isSyncing), refreshMs);
        return () => { cancelled = true; clearInterval(interval); };
    }, [selectedRepo?.id, selectedRepo?.sync_status, isSyncing]);

    const toggleSeries = (key) => setHiddenSeries(prev => ({ ...prev, [key]: !prev[key] }));

    // Build the series list + chart rows for the active grouping mode.
    // NOTE: all hooks must run before any early return (Rules of Hooks).
    const chart = useMemo(() => {
        const rows = timeline?.timeline || [];
        const detailedKeys = timeline?.event_types || [];

        if (groupMode === 'category') {
            const data = rows.map(r => ({
                period: r.period,
                'Pull Requests': (r.pr_opened || 0) + (r.pr_merged || 0) + (r.pr_closed || 0),
                Issues: (r.issue_opened || 0) + (r.issue_closed || 0),
                Reviews: r.review_submitted || 0,
                Comments: r.issue_comment || 0,
                Commits: r.commit || 0,
            }));
            const series = [
                { key: 'Pull Requests', color: '#6366f1' },
                { key: 'Issues', color: '#f59e0b' },
                { key: 'Reviews', color: '#a855f7' },
                { key: 'Comments', color: '#3b82f6' },
                { key: 'Commits', color: '#10b981' },
            ];
            return { data, series, formatPeriod };
        }

        const series = detailedKeys.map(et => ({
            key: et, label: EVENT_LABELS[et] || et, color: EVENT_COLORS[et],
        }));
        return { data: rows, series, formatPeriod };
    }, [timeline, groupMode]);

    // Totals + peak across visible series for the chart header stats.
    const chartStats = useMemo(() => {
        let total = 0;
        let peak = 0;
        let peakPeriod = null;
        for (const row of chart.data) {
            let rowSum = 0;
            for (const s of chart.series) {
                if (hiddenSeries[s.key]) continue;
                rowSum += row[s.key] ?? 0;
            }
            total += rowSum;
            if (rowSum > peak) { peak = rowSum; peakPeriod = row.period; }
        }
        return { total, peak, peakPeriod };
    }, [chart, hiddenSeries]);

    // Scroll to a hashed section once the relevant async data has rendered.
    useHashScroll([data, timeline, leaderboard, reviewerLoad, funnel]);

    if (!selectedRepo) {
        return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    }
    if (loading && !data) {
        return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading contributor analytics...</div>;
    }
    if (error && !data) {
        return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    }
    if (!data) {
        return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">No contributor data yet. Sync this repository to populate analytics.</div>;
    }

    const { summary, active_contributors } = data;

    const sortedLeaders = leaderboard?.leaderboard
        ? [...leaderboard.leaderboard].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0)).slice(0, 25)
        : [];

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">
            {isSyncing && (
                <div className="flex items-center gap-2 text-sm bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-lg px-4 py-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sync in progress — analytics show partial data and will refresh automatically.
                </div>
            )}

            {/* 1. Summary Cards */}
            <div id="active-contributors" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 scroll-mt-24">
                <SummaryCard title="New" value={summary.new} icon={UserPlus} desc="First activity < 30 days" color="text-emerald-500" targetId="newcomer-funnel" />
                <SummaryCard title="Returning" value={summary.returning} icon={Users} desc="Active now & before" color="text-blue-500" targetId="contributor-leaderboard" />
                <SummaryCard title="Active Total" value={summary.active} icon={Activity} desc="Activity in last 30d" color="text-primary" targetId="activity-timeline" />
                <SummaryCard title="Dormant" value={summary.dormant ?? 0} icon={Clock} desc="Last activity 30-45d (at-risk)" color="text-yellow-500" targetId="contributor-leaderboard" />
                <SummaryCard title="Churned" value={summary.churned} icon={UserMinus} desc="No activity > 45 days" color="text-red-500" targetId="contributor-leaderboard" />
            </div>

            {/* 2. Activity Timeline */}
            <div id="activity-timeline" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                    <div>
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <h3 className="font-semibold text-foreground">Contribution Activity</h3>
                            <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-full bg-secondary">
                                {timeline?.granularity === 'week' ? 'Weekly' : 'Monthly'}
                            </span>
                        </div>
                        <div className="flex items-center gap-5 mt-2 text-xs text-muted-foreground">
                            <span><span className="font-semibold text-foreground">{chartStats.total.toLocaleString()}</span> total events</span>
                            {chartStats.peakPeriod && (
                                <span>Peak <span className="font-semibold text-foreground">{chartStats.peak}</span> in {chart.formatPeriod(chartStats.peakPeriod)}</span>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {/* Group mode toggle */}
                        <ToggleGroup
                            value={groupMode}
                            onChange={setGroupMode}
                            options={[
                                { value: 'detailed', label: 'Detailed', icon: Layers },
                                { value: 'category', label: 'Grouped', icon: BarChart3 },
                            ]}
                        />
                        {/* Chart type toggle */}
                        <ToggleGroup
                            value={chartType}
                            onChange={setChartType}
                            options={[
                                { value: 'area', label: 'Area', icon: TrendingUp },
                                { value: 'bar', label: 'Bar', icon: BarChart3 },
                            ]}
                        />
                    </div>
                </div>

                {/* Interactive legend (click to toggle series) */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {chart.series.map(s => {
                        const off = hiddenSeries[s.key];
                        return (
                            <button
                                key={s.key}
                                onClick={() => toggleSeries(s.key)}
                                className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${off ? 'opacity-40 bg-transparent' : 'bg-secondary/40'}`}
                            >
                                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                                {s.label || s.key}
                            </button>
                        );
                    })}
                </div>

                {chart.data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={340}>
                        {chartType === 'area' ? (
                            <AreaChart data={chart.data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    {chart.series.map(s => (
                                        <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={s.color} stopOpacity={0.5} />
                                            <stop offset="95%" stopColor={s.color} stopOpacity={0.03} />
                                        </linearGradient>
                                    ))}
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="period" tickFormatter={chart.formatPeriod} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip content={<ActivityTooltip series={chart.series} formatPeriod={chart.formatPeriod} />} />
                                {chart.series.filter(s => !hiddenSeries[s.key]).map(s => (
                                    <Area
                                        key={s.key}
                                        type="monotone"
                                        dataKey={s.key}
                                        name={s.label || s.key}
                                        stackId="1"
                                        stroke={s.color}
                                        strokeWidth={2}
                                        fill={`url(#grad-${s.key})`}
                                        activeDot={{ r: 4 }}
                                    />
                                ))}
                            </AreaChart>
                        ) : (
                            <BarChart data={chart.data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="period" tickFormatter={chart.formatPeriod} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                                <Tooltip content={<ActivityTooltip series={chart.series} formatPeriod={chart.formatPeriod} />} cursor={{ fill: 'hsl(var(--secondary))', opacity: 0.4 }} />
                                {chart.series.filter(s => !hiddenSeries[s.key]).map(s => (
                                    <Bar key={s.key} dataKey={s.key} name={s.label || s.key} stackId="1" fill={s.color} radius={[2, 2, 0, 0]} />
                                ))}
                            </BarChart>
                        )}
                    </ResponsiveContainer>
                ) : (
                    <EmptyChart label="No activity recorded in this window." />
                )}
            </div>

            {/* 3. Newcomer Funnel */}
            {funnel && (
                <div id="newcomer-funnel" className="bg-card border rounded-lg p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="font-semibold text-foreground">First-Time Contributor Experience</h3>
                                <Tip text="How fast newcomers get a first response, whether their first PR merged, and if they came back." />
                            </div>
                            <p className="text-sm text-muted-foreground mt-1">Newcomer funnel and retention over the window.</p>
                        </div>
                        <SeverityBadge severity={funnel.severity} />
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
                        <Metric label="Newcomers" value={funnel.newcomers} />
                        <Metric label="Returned" value={`${funnel.returned} (${funnel.retention_rate}%)`} />
                        <Metric label="First PR Merged" value={`${funnel.first_pr_merged} (${funnel.merge_rate}%)`} />
                        <Metric label="Median 1st Response" value={formatDuration(funnel.median_first_response_hours)} />
                        <Metric label="Worst Response" value={formatDuration(funnel.worst_first_response_hours)} muted />
                        <Metric label="Median Time to Merge" value={formatDuration(funnel.median_time_to_merge_hours)} />
                    </div>
                </div>
            )}

            {/* 4. Reviewer Load */}
            {reviewerLoad && (
                <div id="reviewer-load" className="bg-card border rounded-lg p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center gap-2 mb-4">
                        <h3 className="font-semibold text-foreground">Reviewer Load & Responsiveness</h3>
                        <Tip text="Who carries the review burden and how quickly they respond." />
                    </div>
                    {reviewerLoad.reviewers && reviewerLoad.reviewers.length > 0 ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={reviewerLoad.reviewers.slice(0, 10)} layout="vertical" margin={{ left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                                    <XAxis type="number" tick={{ fontSize: 12 }} />
                                    <YAxis type="category" dataKey="login" width={100} tick={{ fontSize: 12 }} />
                                    <Tooltip />
                                    <Bar dataKey="reviews" name="Reviews" fill="#a855f7" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="text-muted-foreground font-medium border-b">
                                        <tr>
                                            <th className="py-2 px-2">Reviewer</th>
                                            <th className="py-2 px-2">Reviews</th>
                                            <th className="py-2 px-2">Share</th>
                                            <th className="py-2 px-2">Median Latency</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                        {reviewerLoad.reviewers.slice(0, 10).map((r, i) => (
                                            <tr key={i} className="hover:bg-muted/30">
                                                <td className="py-2 px-2 flex items-center gap-2 font-medium">
                                                    <img src={r.avatar_url} alt={r.login} className="w-5 h-5 rounded-full" />
                                                    {r.login}
                                                </td>
                                                <td className="py-2 px-2">{r.reviews}</td>
                                                <td className="py-2 px-2">{r.share_percent}%</td>
                                                <td className="py-2 px-2">{r.median_latency_hours != null ? formatDuration(r.median_latency_hours) : '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : (
                        <EmptyChart label="No review activity recorded." />
                    )}
                </div>
            )}

            {/* 5. Leaderboard */}
            <div id="contributor-leaderboard" className="bg-card border rounded-lg shadow-sm overflow-hidden scroll-mt-24">
                <div className="p-6 border-b flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                        <Star className="w-4 h-4 text-yellow-500" />
                        <h3 className="font-semibold text-foreground">Contributor Leaderboard</h3>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">Sort by:</span>
                        <select
                            value={sortKey}
                            onChange={(e) => setSortKey(e.target.value)}
                            className="border rounded px-2 py-1 bg-background"
                        >
                            <option value="total_contributions">Total</option>
                            <option value="prs_merged">PRs Merged</option>
                            <option value="prs_opened">PRs Opened</option>
                            <option value="reviews">Reviews</option>
                            <option value="comments">Comments</option>
                            <option value="commits">Commits</option>
                            <option value="tenure_days">Tenure</option>
                        </select>
                    </div>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-secondary/30 text-muted-foreground font-medium">
                            <tr>
                                <th className="px-4 py-3">#</th>
                                <th className="px-4 py-3">Contributor</th>
                                <th className="px-4 py-3"><GitPullRequest className="w-4 h-4 inline" /> Opened</th>
                                <th className="px-4 py-3"><GitMerge className="w-4 h-4 inline" /> Merged</th>
                                <th className="px-4 py-3">Reviews</th>
                                <th className="px-4 py-3"><MessageSquare className="w-4 h-4 inline" /> Comments</th>
                                <th className="px-4 py-3"><GitCommit className="w-4 h-4 inline" /> Commits</th>
                                <th className="px-4 py-3">Tenure</th>
                                <th className="px-4 py-3">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {sortedLeaders.map((c, i) => (
                                <tr key={i} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-4 py-3 text-muted-foreground">{i + 1}</td>
                                    <td className="px-4 py-3 flex items-center gap-2 font-medium text-foreground">
                                        <img src={c.avatar_url} alt={c.login} className="w-6 h-6 rounded-full" />
                                        <a href={c.html_url} target="_blank" rel="noreferrer" className="hover:underline">{c.login}</a>
                                    </td>
                                    <td className="px-4 py-3">{c.prs_opened}</td>
                                    <td className="px-4 py-3">{c.prs_merged}</td>
                                    <td className="px-4 py-3">{c.reviews}</td>
                                    <td className="px-4 py-3">{c.comments}</td>
                                    <td className="px-4 py-3">{c.commits}</td>
                                    <td className="px-4 py-3 text-muted-foreground">{c.tenure_days}d</td>
                                    <td className="px-4 py-3 font-semibold">{c.total_contributions}</td>
                                </tr>
                            ))}
                            {sortedLeaders.length === 0 && (
                                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">No contributor data found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 6. Active Contributors Table */}
            <div className="bg-card border rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b">
                    <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-foreground">Recently Active</h3>
                        <Tip text="Contributors with at least one activity in the last 30 days." />
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">Activity in the last 30 days.</p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-secondary/30 text-muted-foreground font-medium">
                            <tr>
                                <th className="px-6 py-3">Contributor</th>
                                <th className="px-6 py-3">Last Activity</th>
                                <th className="px-6 py-3">Latest Action</th>
                                <th className="px-6 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y">
                            {active_contributors.map((c, i) => (
                                <tr key={i} className="hover:bg-muted/30 transition-colors">
                                    <td className="px-6 py-4 flex items-center gap-3 font-medium text-foreground">
                                        <img src={c.avatar_url} alt={c.login} className="w-6 h-6 rounded-full" />
                                        {c.login}
                                    </td>
                                    <td className="px-6 py-4 text-muted-foreground">
                                        {new Date(c.last_activity_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c.activity_type.includes('pr') ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-700'}`}>
                                            {c.activity_type.replace('_', ' ')}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {c.status === 'healthy' && <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" title="Active recently"></div>}
                                        {c.status === 'warning' && <div className="w-2.5 h-2.5 rounded-full bg-yellow-500" title="No activity > 14 days"></div>}
                                        {c.status === 'critical' && <div className="w-2.5 h-2.5 rounded-full bg-red-500" title="No activity > 21 days"></div>}
                                    </td>
                                </tr>
                            ))}
                            {active_contributors.length === 0 && (
                                <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">No active contributors found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

// Format a bucket key ("2026-06" or "2026-06-15") into a short readable label.
function formatPeriod(period) {
    if (!period) return '';
    const parts = period.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (parts.length === 2) {
        const m = parseInt(parts[1], 10) - 1;
        return `${months[m] || ''} '${parts[0].slice(2)}`;
    }
    if (parts.length === 3) {
        const m = parseInt(parts[1], 10) - 1;
        return `${months[m] || ''} ${parseInt(parts[2], 10)}`;
    }
    return period;
}

const ActivityTooltip = ({ active, payload, label, formatPeriod }) => {
    if (!active || !payload || payload.length === 0) return null;
    const total = payload.reduce((sum, p) => sum + (p.value || 0), 0);
    return (
        <div className="bg-popover border border-border rounded-lg shadow-lg p-3 text-xs min-w-[150px]">
            <div className="font-semibold text-foreground mb-2">{formatPeriod ? formatPeriod(label) : label}</div>
            <div className="space-y-1">
                {payload.filter(p => p.value > 0).map((p) => (
                    <div key={p.dataKey} className="flex items-center justify-between gap-4">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color || p.fill }} />
                            {p.name}
                        </span>
                        <span className="font-medium text-foreground">{p.value}</span>
                    </div>
                ))}
            </div>
            <div className="flex items-center justify-between gap-4 mt-2 pt-2 border-t border-border">
                <span className="text-muted-foreground">Total</span>
                <span className="font-semibold text-foreground">{total}</span>
            </div>
        </div>
    );
};

const ToggleGroup = ({ value, onChange, options }) => (
    <div className="flex items-center bg-secondary/50 rounded-lg p-0.5 border border-border">
        {options.map(opt => {
            const Icon = opt.icon;
            const active = value === opt.value;
            return (
                <button
                    key={opt.value}
                    onClick={() => onChange(opt.value)}
                    className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors ${active ? 'bg-background shadow-sm text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    {opt.label}
                </button>
            );
        })}
    </div>
);

const Metric = ({ label, value, muted }) => (
    <div>
        <div className={`text-2xl font-bold tracking-tight ${muted ? 'text-muted-foreground/60' : 'text-foreground'}`}>{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
);

const SeverityBadge = ({ severity }) => (
    <div className={`px-3 py-1 rounded-full text-xs font-semibold border ${severity === 'healthy' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' :
        severity === 'warning' ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20' :
            'bg-red-500/10 text-red-600 border-red-500/20'}`}>
        {(severity || 'healthy').toUpperCase()}
    </div>
);

const Tip = ({ text }) => (
    <div className="group relative">
        <Info className="w-4 h-4 text-muted-foreground cursor-help" />
        <div className="absolute top-0 left-6 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
            {text}
        </div>
    </div>
);

const EmptyChart = ({ label }) => (
    <div className="h-[200px] flex items-center justify-center text-muted-foreground text-sm">{label}</div>
);

export default Contributors;
