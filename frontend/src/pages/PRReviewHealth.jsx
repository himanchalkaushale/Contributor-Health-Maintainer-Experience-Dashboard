import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { formatDuration } from '@/lib/utils';
import { scrollToSection, useHashScroll } from '@/lib/scroll';
import SummaryCard from '@/components/SummaryCard';
import {
    Loader2, AlertTriangle, Clock, List, AlertCircle, CheckCircle2, Info,
    GitMerge, MessageSquare, Timer,
    Download, X, ChevronDown,
} from 'lucide-react';
import ReviewTrendChart from '@/components/charts/ReviewTrendChart';
import WaitDistributionChart from '@/components/charts/WaitDistributionChart';
import ReviewFunnel from '@/components/charts/ReviewFunnel';

// ── CSV export helper ─────────────────────────────────────────────────────────
// Neutralize CSV formula injection: a leading =, +, -, @, tab or CR in a cell
// can cause spreadsheet apps (Excel/Sheets) to evaluate the cell as a formula.
const sanitizeCSVCell = (value) => {
    let s = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(s)) {
        s = `'${s}`;
    }
    return s.replace(/"/g, '""');
};

const exportCSV = (rows, repoName) => {
    const headers = ['Number', 'Title', 'Author', 'Age (days)', 'Status', 'Reviewed', 'URL'];
    const csvContent = [
        headers.join(','),
        ...rows.map((pr) =>
            [
                pr.number,
                `"${sanitizeCSVCell(pr.title || '')}"`,
                `"${sanitizeCSVCell(pr.author)}"`,
                pr.age_days,
                pr.status,
                pr.is_unreviewed ? 'No' : 'Yes',
                `"${sanitizeCSVCell(pr.html_url)}"`,
            ].join(',')
        ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pr-queue-${repoName.replace('/', '-')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
};

// ── Main Page ─────────────────────────────────────────────────────────────────
const PRReviewHealth = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [days, setDays] = useState(90);

    // Attention-queue filter state
    const [filterAuthor, setFilterAuthor] = useState('');
    const [filterAgeBucket, setFilterAgeBucket] = useState('all');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterReviewed, setFilterReviewed] = useState('all');

    // Nudge modal state
    const [nudgeLoading, setNudgeLoading] = useState({});
    const [nudgeTexts, setNudgeTexts] = useState({});
    const [nudgeOpen, setNudgeOpen] = useState(null);

    const fetchData = useCallback(async () => {
        if (!selectedRepo) return;
        setLoading(true);
        setError(null);
        try {
            const repoName = `${selectedRepo.owner}/${selectedRepo.name}`;
            const res = await repoService.getPRReviewHealth(repoName, days);
            setData(res);
        } catch (err) {
            console.error(err);
            setError('Failed to fetch PR review health data.');
        } finally {
            setLoading(false);
        }
    }, [selectedRepo, days]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useHashScroll([data]);

    const handleNudge = async (pr) => {
        if (nudgeTexts[pr.number]) {
            setNudgeOpen(pr.number);
            return;
        }
        setNudgeLoading((prev) => ({ ...prev, [pr.number]: true }));
        try {
            const result = await repoService.generateNudge(pr.title, pr.author, pr.age_days);
            setNudgeTexts((prev) => ({ ...prev, [pr.number]: result.nudge || result.message || JSON.stringify(result) }));
            setNudgeOpen(pr.number);
        } catch {
            setNudgeTexts((prev) => ({ ...prev, [pr.number]: 'Failed to generate nudge. Please try again.' }));
            setNudgeOpen(pr.number);
        } finally {
            setNudgeLoading((prev) => ({ ...prev, [pr.number]: false }));
        }
    };

    // ── Authors for filter dropdown (memoized — recomputes only when the
    // queue changes, not on every render/filter keystroke). ──
    const attention_queue = useMemo(() => data?.attention_queue || [], [data]);
    const allAuthors = useMemo(
        () => [...new Set(attention_queue.map((pr) => pr.author))].sort(),
        [attention_queue]
    );

    // ── Client-side filtered queue (memoized) ──
    const filteredQueue = useMemo(() => attention_queue.filter((pr) => {
        if (filterAuthor && pr.author !== filterAuthor) return false;
        if (filterStatus !== 'all' && pr.status !== filterStatus) return false;
        if (filterReviewed === 'unreviewed' && !pr.is_unreviewed) return false;
        if (filterReviewed === 'reviewed' && pr.is_unreviewed) return false;
        if (filterAgeBucket !== 'all') {
            const d = pr.age_days;
            if (filterAgeBucket === '0_7' && !(d <= 7)) return false;
            if (filterAgeBucket === '7_14' && !(d > 7 && d <= 14)) return false;
            if (filterAgeBucket === '14_plus' && !(d > 14)) return false;
        }
        return true;
    }), [attention_queue, filterAuthor, filterStatus, filterReviewed, filterAgeBucket]);

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Loading review health...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, kpis, trends, wait_distribution, funnel, alerts } = data;
    const repoFullName = `${selectedRepo.owner}/${selectedRepo.name}`;

    const hasCriticalAlert = alerts && alerts.critical_count > 0;
    const hasWarningAlert = alerts && alerts.warning_count > 0;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10">

            {/* 1. Header + period selector */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-semibold text-foreground">PR Review Health</h2>
                    <p className="text-sm text-muted-foreground">Review pipeline metrics for {repoFullName}</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Period:</span>
                    {[30, 90, 180, 365].map((d) => (
                        <button
                            key={d}
                            type="button"
                            onClick={() => setDays(d)}
                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors border ${
                                days === d
                                    ? 'bg-primary text-primary-foreground border-primary'
                                    : 'bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground'
                            }`}
                        >
                            {d}d
                        </button>
                    ))}
                    {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                </div>
            </div>

            {/* 2. Stale-PR alert banner */}
            {(hasCriticalAlert || hasWarningAlert) && (
                <div
                    className={`flex items-start gap-3 p-4 rounded-lg border ${
                        hasCriticalAlert
                            ? 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800'
                            : 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800'
                    }`}
                >
                    <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${hasCriticalAlert ? 'text-red-500' : 'text-yellow-500'}`} />
                    <div className="flex-1 min-w-0">
                        <p className={`font-medium text-sm ${hasCriticalAlert ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'}`}>
                            {hasCriticalAlert
                                ? `${alerts.critical_count} critical stale PR${alerts.critical_count !== 1 ? 's' : ''} — unreviewed for over 14 days`
                                : `${alerts.warning_count} PR${alerts.warning_count !== 1 ? 's' : ''} unreviewed for over 7 days`}
                            {alerts.warning_count > 0 && hasCriticalAlert && `, and ${alerts.warning_count} warning`}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            PR#{(alerts.stale_pr_numbers || []).slice(0, 5).join(', #')}
                            {alerts.stale_pr_numbers && alerts.stale_pr_numbers.length > 5 && ` and ${alerts.stale_pr_numbers.length - 5} more`}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground ml-auto"
                        onClick={() => scrollToSection('attention-queue')}
                    >
                        <span className="text-xs underline">View queue</span>
                    </button>
                </div>
            )}

            {/* 3. KPI Cards (7 cards) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Open PRs"
                    value={summary.open_prs}
                    icon={List}
                    desc="Total backlog"
                    color="text-blue-500"
                    targetId="attention-queue"
                />
                <SummaryCard
                    title="Unreviewed PRs"
                    value={summary.unreviewed_prs}
                    icon={AlertTriangle}
                    desc="Zero maintainer interaction"
                    color={summary.unreviewed_prs > 5 ? 'text-red-500' : summary.unreviewed_prs > 2 ? 'text-yellow-500' : 'text-emerald-500'}
                    tooltip="Open PRs with no maintainer reviews. High risk for contributor drop-off."
                    targetId="attention-queue"
                    redValueFor="Unreviewed PRs"
                />
                <SummaryCard
                    title="Waiting > 7 Days"
                    value={summary.waiting_over_7d}
                    icon={Clock}
                    desc="Stale candidates"
                    color={summary.waiting_over_7d > 5 ? 'text-red-500' : 'text-yellow-500'}
                    targetId="attention-queue"
                />
                <SummaryCard
                    title="Median Review Time"
                    value={formatDuration(summary.median_review_hours)}
                    icon={Clock}
                    desc={summary.median_review_hours === null ? 'No data in period' : `First response speed (${days}d)`}
                    color={summary.median_review_hours === null ? 'text-muted-foreground' : summary.median_review_hours > 72 ? 'text-red-500' : 'text-emerald-500'}
                    targetId="review-flow"
                />
                {/* New KPI cards */}
                <SummaryCard
                    title="Time to Merge"
                    value={kpis?.time_to_merge_median_hours != null ? formatDuration(kpis.time_to_merge_median_hours) : '—'}
                    icon={GitMerge}
                    desc={kpis?.time_to_merge_median_hours != null ? `Median (${days}d)` : 'No merged PRs in period'}
                    color={kpis?.time_to_merge_median_hours == null ? 'text-muted-foreground' : kpis.time_to_merge_median_hours > 168 ? 'text-red-500' : 'text-emerald-500'}
                    delta={kpis?.time_to_merge_delta_pct}
                    lowerIsBetter
                    tooltip="Median time from PR creation to merge. Compared to prior period."
                />
                <SummaryCard
                    title="Review Cycle Time"
                    value={kpis?.review_cycle_time_median_hours != null ? formatDuration(kpis.review_cycle_time_median_hours) : '—'}
                    icon={Timer}
                    desc={kpis?.review_cycle_time_median_hours != null ? `First review → close (${days}d)` : 'No data in period'}
                    color={kpis?.review_cycle_time_median_hours == null ? 'text-muted-foreground' : kpis.review_cycle_time_median_hours > 48 ? 'text-red-500' : 'text-emerald-500'}
                    delta={kpis?.review_cycle_time_delta_pct}
                    lowerIsBetter
                    tooltip="Time from first review to PR close/merge."
                />
                <SummaryCard
                    title="Comment Density"
                    value={kpis?.comment_density != null ? kpis.comment_density.toFixed(1) : '—'}
                    icon={MessageSquare}
                    desc={kpis?.comment_density != null ? `Avg per PR (${kpis.comment_density_source === 'comment_table' ? 'comments' : 'reviews'})` : 'No data in period'}
                    color={kpis?.comment_density == null ? 'text-muted-foreground' : kpis.comment_density >= 2 ? 'text-emerald-500' : 'text-yellow-500'}
                    delta={kpis?.comment_density_delta_pct}
                    lowerIsBetter={false}
                    tooltip="Average comments/reviews per PR. Higher = more engagement."
                />
            </div>

            {/* 4. Charts row: trend + distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-card border rounded-lg p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <h3 className="font-semibold text-foreground">Review Trends</h3>
                        <div className="group relative ml-auto">
                            <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                            <div className="absolute right-0 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                Weekly time-to-merge and review cycle time (hours) overlaid on merged PR count.
                            </div>
                        </div>
                    </div>
                    <ReviewTrendChart data={trends} />
                </div>
                <div className="bg-card border rounded-lg p-6 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                        <h3 className="font-semibold text-foreground">Wait-Time Distribution</h3>
                        <div className="group relative ml-auto">
                            <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                            <div className="absolute right-0 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                How long PRs waited for their first review — open unreviewed PRs (current wait) plus closed PRs in the window.
                            </div>
                        </div>
                    </div>
                    <WaitDistributionChart data={wait_distribution} />
                </div>
            </div>

            {/* 5. Main content: Attention Queue + ReviewFunnel */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Attention Queue */}
                <div id="attention-queue" className="lg:col-span-2 bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col scroll-mt-24">
                    <div className="p-6 border-b">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <h3 className="font-semibold text-foreground">Critical PR Attention Queue</h3>
                                <p className="text-sm text-muted-foreground mt-1">
                                    Prioritized by risk: <span className="text-red-500 font-medium">Unreviewed</span> items first.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => exportCSV(filteredQueue, repoFullName)}
                                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2.5 py-1.5 hover:border-primary/40 transition-colors"
                            >
                                <Download className="w-3.5 h-3.5" />
                                Export CSV
                            </button>
                        </div>

                        {/* Filters */}
                        <div className="flex flex-wrap gap-2 mt-3">
                            {/* Author filter */}
                            <div className="relative">
                                <select
                                    value={filterAuthor}
                                    onChange={(e) => setFilterAuthor(e.target.value)}
                                    className="appearance-none text-xs bg-secondary border border-border rounded px-2.5 py-1.5 pr-7 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="">All Authors</option>
                                    {allAuthors.map((a) => (
                                        <option key={a} value={a}>{a}</option>
                                    ))}
                                </select>
                                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                            {/* Age bucket filter */}
                            <div className="relative">
                                <select
                                    value={filterAgeBucket}
                                    onChange={(e) => setFilterAgeBucket(e.target.value)}
                                    className="appearance-none text-xs bg-secondary border border-border rounded px-2.5 py-1.5 pr-7 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="all">All Ages</option>
                                    <option value="0_7">0–7 days</option>
                                    <option value="7_14">7–14 days</option>
                                    <option value="14_plus">14+ days</option>
                                </select>
                                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                            {/* Status filter */}
                            <div className="relative">
                                <select
                                    value={filterStatus}
                                    onChange={(e) => setFilterStatus(e.target.value)}
                                    className="appearance-none text-xs bg-secondary border border-border rounded px-2.5 py-1.5 pr-7 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="all">All Statuses</option>
                                    <option value="critical">Critical</option>
                                    <option value="warning">Warning</option>
                                    <option value="healthy">Healthy</option>
                                </select>
                                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                            {/* Reviewed toggle */}
                            <div className="relative">
                                <select
                                    value={filterReviewed}
                                    onChange={(e) => setFilterReviewed(e.target.value)}
                                    className="appearance-none text-xs bg-secondary border border-border rounded px-2.5 py-1.5 pr-7 text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                                >
                                    <option value="all">All PRs</option>
                                    <option value="unreviewed">Unreviewed only</option>
                                    <option value="reviewed">Reviewed only</option>
                                </select>
                                <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                            </div>
                            {/* Clear filters */}
                            {(filterAuthor || filterAgeBucket !== 'all' || filterStatus !== 'all' || filterReviewed !== 'all') && (
                                <button
                                    type="button"
                                    onClick={() => { setFilterAuthor(''); setFilterAgeBucket('all'); setFilterStatus('all'); setFilterReviewed('all'); }}
                                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <X className="w-3 h-3" /> Clear
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                <tr>
                                    <th className="px-4 py-3">PR</th>
                                    <th className="px-4 py-3">Author</th>
                                    <th className="px-4 py-3">Age</th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Links</th>
                                    <th className="px-4 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {filteredQueue.map((pr) => (
                                    <React.Fragment key={pr.number}>
                                        <tr className="hover:bg-muted/30 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-start gap-2">
                                                    {pr.is_unreviewed && (
                                                        <span className="bg-red-100 text-red-700 text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide flex-shrink-0 mt-0.5">
                                                            Unreviewed
                                                        </span>
                                                    )}
                                                    <a
                                                        href={pr.html_url}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="font-medium text-primary hover:underline block truncate max-w-[180px]"
                                                        title={pr.title}
                                                    >
                                                        #{pr.number} {pr.title}
                                                    </a>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-muted-foreground">{pr.author}</td>
                                            <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{pr.age_days}d</td>
                                            <td className="px-4 py-3">
                                                {pr.status === 'healthy' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</span>}
                                                {pr.status === 'warning' && <span className="text-yellow-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Warning</span>}
                                                {pr.status === 'critical' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Critical</span>}
                                            </td>
                                            <td className="px-4 py-3">
                                                <div className="flex flex-col gap-0.5">
                                                    <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Overview</a>
                                                    <a href={pr.files_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary hover:underline">Files</a>
                                                    <a href={pr.reviews_url} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-primary hover:underline">Reviews</a>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3">
                                                <button
                                                    type="button"
                                                    onClick={() => handleNudge(pr)}
                                                    disabled={nudgeLoading[pr.number]}
                                                    className="flex items-center gap-1 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded px-2 py-1 text-foreground transition-colors disabled:opacity-50"
                                                >
                                                    {nudgeLoading[pr.number] ? (
                                                        <Loader2 className="w-3 h-3 animate-spin" />
                                                    ) : (
                                                        <MessageSquare className="w-3 h-3" />
                                                    )}
                                                    Draft Nudge
                                                </button>
                                            </td>
                                        </tr>
                                        {/* Nudge inline panel */}
                                        {nudgeOpen === pr.number && nudgeTexts[pr.number] && (
                                            <tr className="bg-muted/20">
                                                <td colSpan={6} className="px-4 py-3">
                                                    <div className="flex items-start gap-2">
                                                        <div className="flex-1 text-sm text-foreground bg-card border rounded p-3 whitespace-pre-wrap">
                                                            {nudgeTexts[pr.number]}
                                                        </div>
                                                        <div className="flex flex-col gap-1 flex-shrink-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => navigator.clipboard.writeText(nudgeTexts[pr.number])}
                                                                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
                                                            >
                                                                Copy
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => setNudgeOpen(null)}
                                                                className="text-xs text-muted-foreground hover:text-foreground border border-border rounded px-2 py-1"
                                                            >
                                                                Close
                                                            </button>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                                {filteredQueue.length === 0 && (
                                    <tr>
                                        <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
                                            {attention_queue.length === 0
                                                ? 'All caught up! Zero critical PRs. 🎉'
                                                : 'No PRs match the current filters.'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Review Funnel + Review Flow */}
                <div className="space-y-6">
                    {/* Review-stage Funnel */}
                    <div id="review-flow" className="bg-card border rounded-lg p-6 shadow-sm scroll-mt-24">
                        <div className="flex items-center gap-2 mb-4">
                            <h3 className="font-semibold text-foreground">Review-Stage Funnel</h3>
                            <div className="group relative ml-auto">
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                                <div className="absolute right-0 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                    Shows where current open PRs sit in the pipeline, plus merged count in the window.
                                </div>
                            </div>
                        </div>
                        <ReviewFunnel data={funnel} />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PRReviewHealth;
