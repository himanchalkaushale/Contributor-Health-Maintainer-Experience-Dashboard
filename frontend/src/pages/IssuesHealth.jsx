import React, { useEffect, useState, useMemo } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { formatDuration } from '@/lib/utils';
import { useHashScroll } from '@/lib/scroll';
import SummaryCard from '@/components/SummaryCard';
import {
    Loader2, AlertCircle, Clock, AlertTriangle, CheckCircle2, History, List,
    Users, Layers, TrendingUp, BarChart3, Ghost, Tag, MessageCircle,
    Zap, RefreshCw, UserCheck
} from 'lucide-react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts';

const CATEGORY_COLORS = {
    bug: '#ef4444',
    enhancement: '#3b82f6',
    question: '#f59e0b',
    other: '#64748b',
    unlabeled: '#9ca3af',
};

const IssuesHealth = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [triageLoad, setTriageLoad] = useState(null);
    const [workloadBalance, setWorkloadBalance] = useState(null);
    const [trends, setTrends] = useState(null);
    const [firstTimerQueue, setFirstTimerQueue] = useState(null);
    const [zombieIssues, setZombieIssues] = useState(null);
    const [categoryBreakdown, setCategoryBreakdown] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedZombies, setSelectedZombies] = useState(new Set());

    const isSyncing = selectedRepo && (selectedRepo.sync_status === 'syncing' || selectedRepo.sync_status === 'queued');

    useEffect(() => {
        if (!selectedRepo) return;
        let cancelled = false;

        const fetchAll = async (silent = false) => {
            if (!silent) setLoading(true);
            setError(null);
            try {
                const [
                    base, triage, workload, trendData, firstTimer, zombie, category
                ] = await Promise.allSettled([
                    repoService.getIssuesHealth(selectedRepo.id),
                    repoService.getIssueTriageLoad(selectedRepo.id),
                    repoService.getIssueWorkloadBalance(selectedRepo.id),
                    repoService.getIssueTrends(selectedRepo.id),
                    repoService.getFirstTimerIssueQueue(selectedRepo.id),
                    repoService.getZombieIssues(selectedRepo.id),
                    repoService.getIssueCategoryBreakdown(selectedRepo.id),
                ]);
                if (cancelled) return;

                if (base.status === 'fulfilled') setData(base.value);
                if (triage.status === 'fulfilled') setTriageLoad(triage.value);
                if (workload.status === 'fulfilled') setWorkloadBalance(workload.value);
                if (trendData.status === 'fulfilled') setTrends(trendData.value);
                if (firstTimer.status === 'fulfilled') setFirstTimerQueue(firstTimer.value);
                if (zombie.status === 'fulfilled') setZombieIssues(zombie.value);
                if (category.status === 'fulfilled') setCategoryBreakdown(category.value);

                if (base.status === 'rejected' && triage.status === 'rejected') {
                    setError('Failed to fetch issues analytics.');
                }
            } catch {
                if (!cancelled) setError('Failed to fetch issues analytics.');
            } finally {
                if (!cancelled && !silent) setLoading(false);
            }
        };

        fetchAll();
        const refreshMs = isSyncing ? 5000 : 5 * 60 * 1000;
        const interval = setInterval(() => fetchAll(true), refreshMs);
        return () => { cancelled = true; clearInterval(interval); };
    }, [selectedRepo?.id, selectedRepo?.sync_status, isSyncing]);

    // Pie chart data for category breakdown
    const categoryPieData = useMemo(() => {
        if (!categoryBreakdown) return [];
        return [
            { name: 'Bug', value: categoryBreakdown.bug?.count || 0, key: 'bug' },
            { name: 'Enhancement', value: categoryBreakdown.enhancement?.count || 0, key: 'enhancement' },
            { name: 'Question', value: categoryBreakdown.question?.count || 0, key: 'question' },
            { name: 'Other', value: categoryBreakdown.other?.count || 0, key: 'other' },
            { name: 'Unlabeled', value: categoryBreakdown.unlabeled?.count || 0, key: 'unlabeled' },
        ].filter(d => d.value > 0);
    }, [categoryBreakdown]);

    // Toggle zombie selection
    const toggleZombie = (number) => {
        setSelectedZombies(prev => {
            const next = new Set(prev);
            if (next.has(number)) next.delete(number);
            else next.add(number);
            return next;
        });
    };

    // Bulk actions
    const markSelectedStale = async () => {
        if (selectedZombies.size === 0) return;
        const result = await repoService.bulkMarkIssuesStale(selectedRepo.id, Array.from(selectedZombies));
        alert(result.message);
        setSelectedZombies(new Set());
    };

    const closeSelected = async () => {
        if (selectedZombies.size === 0) return;
        const result = await repoService.bulkCloseIssues(selectedRepo.id, Array.from(selectedZombies));
        alert(result.message);
        setSelectedZombies(new Set());
    };

    // Scroll to a hashed section once the relevant async data has rendered.
    useHashScroll([data, triageLoad, workloadBalance, trends, firstTimerQueue, zombieIssues, categoryBreakdown]);

    if (!selectedRepo) {
        return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    }
    if (loading && !data) {
        return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading issues analytics...</div>;
    }
    if (error && !data) {
        return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    }
    if (!data) {
        return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">No issues data yet. Sync this repository.</div>;
    }

    const { summary, unanswered_issues } = data;

    return (
        <div className="space-y-6 animate-in fade-in duration-500 pb-10">
            {isSyncing && (
                <div className="flex items-center gap-2 text-sm bg-blue-500/10 text-blue-600 border border-blue-500/20 rounded-lg px-4 py-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sync in progress — analytics show partial data and will refresh automatically.
                </div>
            )}

            {/* Row 1: Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <SummaryCard rounded="xl" title="Open Issues" value={summary?.open_issues || 0} icon={List} desc="Total backlog" color="text-blue-500" targetId="category-breakdown" />
                <SummaryCard rounded="xl" title="Unanswered" value={summary?.unanswered || 0} icon={MessageCircle} desc="No maintainer response" color={summary?.unanswered > 10 ? "text-red-500" : "text-yellow-500"} targetId="unanswered-issues" />
                <SummaryCard rounded="xl" title="Median Response" value={formatDuration(summary?.median_first_response_hours)} icon={Clock} desc="Target: 2d" color={summary?.median_first_response_hours > 48 ? "text-red-500" : "text-emerald-500"} targetId="response-trends" />
                <SummaryCard rounded="xl" title="First-Timer Backlog" value={firstTimerQueue?.total_count || 0} icon={Users} desc="New contributors waiting" color="text-purple-500" targetId="first-timer-queue" />
                <SummaryCard rounded="xl" title="Zombie Issues" value={zombieIssues?.total_count || 0} icon={Ghost} desc="Abandoned after response" color="text-orange-500" targetId="zombie-issues" />
            </div>

            {/* Row 1.5: Unanswered Issues */}
            <div id="unanswered-issues" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                <div className="flex items-center gap-2 mb-4">
                    <MessageCircle className="w-4 h-4 text-yellow-500" />
                    <h3 className="font-semibold text-foreground">Unanswered Issues</h3>
                    <span className="text-xs text-muted-foreground">Open issues with no maintainer response</span>
                    {unanswered_issues?.length > 0 && (
                        <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full ml-auto">
                            {unanswered_issues.length} shown
                        </span>
                    )}
                </div>
                {unanswered_issues?.length > 0 ? (
                    <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium sticky top-0">
                                <tr>
                                    <th className="px-4 py-2">Issue</th>
                                    <th className="px-4 py-2">Author</th>
                                    <th className="px-4 py-2">Age</th>
                                    <th className="px-4 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {unanswered_issues.map((issue) => (
                                    <tr key={issue.number} className="hover:bg-muted/30">
                                        <td className="px-4 py-2">
                                            <a href={issue.html_url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[280px]" title={issue.title}>
                                                #{issue.number} {issue.title}
                                            </a>
                                        </td>
                                        <td className="px-4 py-2 text-muted-foreground">{issue.author}</td>
                                        <td className="px-4 py-2 text-muted-foreground">{issue.age_days}d</td>
                                        <td className="px-4 py-2">
                                            <span className={`text-xs px-2 py-0.5 rounded ${issue.status === 'critical' ? 'bg-red-100 text-red-600' : issue.status === 'warning' ? 'bg-yellow-100 text-yellow-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                {issue.status}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <EmptyState label="No unanswered issues — every open issue has a maintainer response." />
                )}
            </div>

            {/* Row 2: Triage Team Load + Category Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Triage Team Load - 2/3 width */}
                <div id="triage-load" className="lg:col-span-2 bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center gap-2 mb-4">
                        <UserCheck className="w-4 h-4 text-primary" />
                        <h3 className="font-semibold text-foreground">Triage Team Load</h3>
                        <span className="text-xs text-muted-foreground">Who responds to issues</span>
                    </div>
                    {triageLoad?.maintainers?.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                    <tr>
                                        <th className="px-4 py-2">Maintainer</th>
                                        <th className="px-4 py-2">Triage Count</th>
                                        <th className="px-4 py-2">Avg Response</th>
                                        <th className="px-4 py-2">Unassigned Queue</th>
                                        <th className="px-4 py-2">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {triageLoad.maintainers.map((m, i) => (
                                        <tr key={i} className="hover:bg-muted/30">
                                            <td className="px-4 py-3 flex items-center gap-2">
                                                <img src={m.avatar_url} alt={m.login} className="w-6 h-6 rounded-full" />
                                                {m.login}
                                            </td>
                                            <td className="px-4 py-3 font-medium">{m.triage_count}</td>
                                            <td className="px-4 py-3 text-muted-foreground">{formatDuration(m.avg_response_hours)}</td>
                                            <td className="px-4 py-3">{m.unassigned_queue}</td>
                                            <td className="px-4 py-3">
                                                <StatusBadge status={m.status} />
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <EmptyState label="No triage activity recorded yet." />
                    )}
                </div>

                {/* Category Breakdown - 1/3 width */}
                <div id="category-breakdown" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center gap-2 mb-4">
                        <Tag className="w-4 h-4 text-primary" />
                        <h3 className="font-semibold text-foreground">By Category</h3>
                    </div>
                    {categoryPieData.length > 0 ? (
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie
                                    data={categoryPieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={2}
                                    dataKey="value"
                                >
                                    {categoryPieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.key]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                            </PieChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyState label="No categorized issues." />
                    )}
                    <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                        {categoryPieData.map((cat) => (
                            <div key={cat.key} className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[cat.key] }} />
                                <span className="text-muted-foreground">{cat.name}:</span>
                                <span className="font-medium">{cat.value}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Row 3: Response Time Trends + First-Timer Fast Lane */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Trends - 2/3 width */}
                <div id="response-trends" className="lg:col-span-2 bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-primary" />
                            <h3 className="font-semibold text-foreground">Response Time Trends</h3>
                            {trends?.trend_direction && (
                                <TrendBadge direction={trends.trend_direction} />
                            )}
                        </div>
                        <div className="text-xs text-muted-foreground">Target SLA: 2d</div>
                    </div>
                    {trends?.timeline?.some(t => t.median_response_hours != null) ? (
                        <ResponsiveContainer width="100%" height={280}>
                            <AreaChart data={trends.timeline} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorResponse" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0.05} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                                <XAxis dataKey="week" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                                <YAxis
                                    tick={{ fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                    tickFormatter={(v) => formatDuration(v)}
                                    width={56}
                                />
                                <Tooltip content={<TrendTooltip />} />
                                <Area
                                    type="monotone"
                                    dataKey="median_response_hours"
                                    name="Median Response"
                                    stroke="#6366f1"
                                    strokeWidth={2}
                                    fill="url(#colorResponse)"
                                    connectNulls
                                    activeDot={{ r: 4 }}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    ) : (
                        <EmptyState label="No response-time data in this window yet." />
                    )}
                </div>

                {/* First-Timer Fast Lane - 1/3 width */}
                <div id="first-timer-queue" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center gap-2 mb-4">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <h3 className="font-semibold text-foreground">First-Timer Fast Lane</h3>
                        {firstTimerQueue?.critical_count > 0 && (
                            <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full">{firstTimerQueue.critical_count} critical</span>
                        )}
                    </div>
                    {firstTimerQueue?.queue?.length > 0 ? (
                        <div className="space-y-3">
                            {firstTimerQueue.queue.slice(0, 5).map((issue) => (
                                <div key={issue.number} className="flex items-start gap-3 p-3 bg-secondary/20 rounded-lg">
                                    <img src={issue.author_avatar} alt={issue.author_login} className="w-8 h-8 rounded-full" />
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <a href={issue.html_url} target="_blank" rel="noreferrer" className="font-medium text-sm text-primary hover:underline truncate block">
                                                #{issue.number} {issue.title}
                                            </a>
                                        </div>
                                        <div className="flex items-center gap-2 mt-1 text-xs">
                                            <span className="text-muted-foreground">{issue.author_login}</span>
                                            <span className={`px-1.5 py-0.5 rounded ${issue.age_days > 3 ? 'bg-red-100 text-red-600' : 'bg-yellow-100 text-yellow-600'}`}>
                                                {issue.age_days}d
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {firstTimerQueue.queue.length > 5 && (
                                <div className="text-xs text-center text-muted-foreground pt-2">
                                    +{firstTimerQueue.queue.length - 5} more
                                </div>
                            )}
                        </div>
                    ) : (
                        <EmptyState label="No first-timer issues waiting!" />
                    )}
                </div>
            </div>

            {/* Row 4: Workload Balance + Zombie Issues */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Workload Balance */}
                <div id="workload-balance" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Layers className="w-4 h-4 text-primary" />
                            <h3 className="font-semibold text-foreground">Workload Balance</h3>
                        </div>
                        {workloadBalance?.rebalance_suggested && (
                            <span className="text-xs bg-yellow-100 text-yellow-600 px-2 py-0.5 rounded-full">Rebalance Suggested</span>
                        )}
                    </div>
                    <div className="text-sm text-muted-foreground mb-4">
                        {workloadBalance?.unassigned_count || 0} unassigned issues
                    </div>
                    {workloadBalance?.maintainers?.length > 0 ? (
                        <div className="space-y-3">
                            {workloadBalance.maintainers.map((m, i) => (
                                <div key={i} className="flex items-center gap-3">
                                    <img src={m.avatar_url} alt={m.login} className="w-8 h-8 rounded-full" />
                                    <div className="flex-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="font-medium text-sm">{m.login}</span>
                                            <span className={`text-xs px-2 py-0.5 rounded ${m.capacity === 'overloaded' ? 'bg-red-100 text-red-600' : m.capacity === 'busy' ? 'bg-yellow-100 text-yellow-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                                {m.capacity}
                                            </span>
                                        </div>
                                        <div className="w-full bg-secondary h-2 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${m.capacity === 'overloaded' ? 'bg-red-500' : m.capacity === 'busy' ? 'bg-yellow-500' : 'bg-emerald-500'}`}
                                                style={{ width: `${Math.min(m.assigned_count * 3, 100)}%` }}
                                            />
                                        </div>
                                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                                            <span>{m.assigned_count} assigned</span>
                                            <span>avg {m.avg_age_days}d</span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <EmptyState label="No assigned issues." />
                    )}
                </div>

                {/* Zombie Issues with Bulk Actions */}
                <div id="zombie-issues" className="bg-card border rounded-xl p-6 shadow-sm scroll-mt-24">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <Ghost className="w-4 h-4 text-orange-500" />
                            <h3 className="font-semibold text-foreground">Zombie Issues</h3>
                            <span className="text-xs text-muted-foreground">Responded but abandoned</span>
                        </div>
                        {selectedZombies.size > 0 && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={markSelectedStale}
                                    className="text-xs px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors"
                                >
                                    Mark Stale ({selectedZombies.size})
                                </button>
                                <button
                                    onClick={closeSelected}
                                    className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                                >
                                    Close ({selectedZombies.size})
                                </button>
                            </div>
                        )}
                    </div>
                    {zombieIssues?.zombie_issues?.length > 0 ? (
                        <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-secondary/30 text-muted-foreground font-medium sticky top-0">
                                    <tr>
                                        <th className="px-3 py-2 w-8">
                                            <input
                                                type="checkbox"
                                                checked={selectedZombies.size === zombieIssues.zombie_issues.length && zombieIssues.zombie_issues.length > 0}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        setSelectedZombies(new Set(zombieIssues.zombie_issues.map(z => z.number)));
                                                    } else {
                                                        setSelectedZombies(new Set());
                                                    }
                                                }}
                                                className="rounded"
                                            />
                                        </th>
                                        <th className="px-3 py-2">Issue</th>
                                        <th className="px-3 py-2">Staleness</th>
                                        <th className="px-3 py-2">Last Responder</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y">
                                    {zombieIssues.zombie_issues.map((issue) => (
                                        <tr key={issue.number} className="hover:bg-muted/30">
                                            <td className="px-3 py-2">
                                                <input
                                                    type="checkbox"
                                                    checked={selectedZombies.has(issue.number)}
                                                    onChange={() => toggleZombie(issue.number)}
                                                    className="rounded"
                                                />
                                            </td>
                                            <td className="px-3 py-2">
                                                <a href={issue.html_url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[200px]" title={issue.title}>
                                                    #{issue.number} {issue.title}
                                                </a>
                                            </td>
                                            <td className="px-3 py-2">
                                                <span className={`text-xs px-2 py-0.5 rounded ${issue.status === 'critical' ? 'bg-red-100 text-red-600' : issue.status === 'warning' ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-600'}`}>
                                                    {issue.days_since_response}d
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-muted-foreground text-xs">{issue.last_responder}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <EmptyState label="No zombie issues found!" />
                    )}
                    <div className="text-xs text-muted-foreground mt-3 border-t pt-3">
                        Bulk actions require GitHub App OAuth. These will return stub responses until configured.
                    </div>
                </div>
            </div>
        </div>
    );
};

const StatusBadge = ({ status }) => {
    const colors = {
        healthy: 'bg-emerald-100 text-emerald-600',
        warning: 'bg-yellow-100 text-yellow-600',
        critical: 'bg-red-100 text-red-600',
    };
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full ${colors[status] || colors.healthy}`}>
            {status}
        </span>
    );
};

const TrendBadge = ({ direction }) => {
    const configs = {
        slower: { text: 'Getting Slower', color: 'bg-red-100 text-red-600' },
        faster: { text: 'Getting Faster', color: 'bg-emerald-100 text-emerald-600' },
        stable: { text: 'Stable', color: 'bg-gray-100 text-gray-600' },
    };
    const config = configs[direction] || configs.stable;
    return (
        <span className={`text-xs px-2 py-0.5 rounded-full ${config.color}`}>
            {config.text}
        </span>
    );
};

const TrendTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const data = payload[0].payload;
    return (
        <div className="bg-popover border rounded-lg shadow-lg p-3 text-xs min-w-[180px]">
            <div className="font-semibold mb-2">{label}</div>
            <div className="flex justify-between items-center mb-1">
                <span className="text-muted-foreground">Median Response:</span>
                <span className="font-medium">{formatDuration(data?.median_response_hours)}</span>
            </div>
            <div className="flex justify-between items-center mb-1">
                <span className="text-muted-foreground">Total Responded:</span>
                <span className="font-medium">{data?.total_responded || 0}</span>
            </div>
            {data?.categories && (
                <div className="mt-2 pt-2 border-t">
                    <div className="text-muted-foreground mb-1">By Category:</div>
                    <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                        {Object.entries(data.categories).map(([cat, count]) => count > 0 && (
                            <div key={cat} className="flex justify-between">
                                <span className="capitalize">{cat}:</span>
                                <span>{count}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

const EmptyState = ({ label }) => (
    <div className="h-[150px] flex items-center justify-center text-muted-foreground text-sm">
        {label}
    </div>
);

export default IssuesHealth;
