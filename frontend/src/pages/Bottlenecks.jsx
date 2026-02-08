import React, { useEffect, useState } from 'react';
import { useRepo } from '@/context/RepoContext';
import { repoService } from '@/services/api';
import { Loader2, Clock, AlertTriangle, AlertCircle, GitPullRequest, ArrowRight, Info, CheckCircle2, MessageSquare, X, Sparkles } from 'lucide-react';

const Bottlenecks = () => {
    const { selectedRepo } = useRepo();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Nudge State
    const [nudgeModalOpen, setNudgeModalOpen] = useState(false);
    const [nudgeLoading, setNudgeLoading] = useState(false);
    const [nudgeContent, setNudgeContent] = useState("");
    const [selectedPR, setSelectedPR] = useState(null);

    useEffect(() => {
        if (!selectedRepo) return;
        const fetchData = async () => {
            setLoading(true);
            try {
                const res = await repoService.getPRBottlenecks(selectedRepo.id);
                setData(res);
            } catch (err) {
                console.error(err);
                setError("Failed to fetch bottleneck data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [selectedRepo]);

    const handleDraftNudge = async (pr) => {
        setSelectedPR(pr);
        setNudgeModalOpen(true);
        setNudgeLoading(true);
        try {
            const res = await repoService.generateNudge(pr.title, pr.author, pr.age_days);
            setNudgeContent(res.message);
        } catch (err) {
            console.error(err);
            setNudgeContent("Failed to generate nudge. Please check the backend logs.");
        } finally {
            setNudgeLoading(false);
        }
    };

    if (!selectedRepo) return <div className="flex justify-center items-center h-[50vh] text-muted-foreground">Select a repository first.</div>;
    if (loading && !data) return <div className="flex justify-center items-center h-[50vh] gap-3 text-muted-foreground"><Loader2 className="animate-spin" /> Analyzing bottlenecks...</div>;
    if (error) return <div className="flex justify-center items-center h-[50vh] text-destructive">{error}</div>;
    if (!data) return null;

    const { summary, stuck_prs, first_time_prs, review_flow } = data;

    return (
        <div className="space-y-8 animate-in fade-in duration-500 pb-10 relative">
            {/* 1. Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <SummaryCard
                    title="Stale PRs (> 7d)"
                    value={summary.waiting_over_7d}
                    icon={Clock}
                    desc="Waiting for maintainer review"
                    color={summary.waiting_over_7d > 5 ? "text-red-500" : "text-yellow-500"}
                />
                <SummaryCard
                    title="Unreviewed"
                    value={summary.unreviewed_prs}
                    icon={AlertCircle}
                    desc="Zero maintainer interaction"
                    color="text-red-500"
                />
                <SummaryCard
                    title="Median Review Time"
                    value={summary.median_review_hours === null ? "N/A" : `${summary.median_review_hours}h`}
                    icon={GitPullRequest}
                    desc="Time to first feedback"
                    color="text-primary"
                />
                <SummaryCard
                    title="New Contributor Risk"
                    value={first_time_prs.count}
                    icon={AlertTriangle}
                    desc="First-time PRs stuck > 7d"
                    color={first_time_prs.count > 0 ? "text-red-500" : "text-emerald-500"}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* 2. Stuck PRs Table */}
                <div className="lg:col-span-2 bg-card border rounded-lg shadow-sm overflow-hidden flex flex-col">
                    <div className="p-6 border-b">
                        <h3 className="font-semibold text-foreground">Stuck PRs (Actionable)</h3>
                        <p className="text-sm text-muted-foreground mt-1">PRs older than 7 days needing attention.</p>
                    </div>
                    <div className="overflow-x-auto flex-1">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-secondary/30 text-muted-foreground font-medium">
                                <tr>
                                    <th className="px-6 py-3">PR</th>
                                    <th className="px-6 py-3">Author</th>
                                    <th className="px-6 py-3">Age</th>
                                    <th className="px-6 py-3">Status</th>
                                    <th className="px-6 py-3">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {stuck_prs.map((pr) => (
                                    <tr key={pr.number} className="hover:bg-muted/30 transition-colors">
                                        <td className="px-6 py-4">
                                            <a href={pr.html_url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline block truncate max-w-[280px]" title={pr.title}>
                                                #{pr.number} {pr.title}
                                            </a>
                                        </td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.author}</td>
                                        <td className="px-6 py-4 text-muted-foreground">{pr.age_days} days</td>
                                        <td className="px-6 py-4">
                                            {pr.status === 'healthy' && <span className="text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Healthy</span>}
                                            {pr.status === 'warning' && <span className="text-yellow-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Warning</span>}
                                            {pr.status === 'critical' && <span className="text-red-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Critical</span>}
                                        </td>
                                        <td className="px-6 py-4">
                                            <button
                                                onClick={() => handleDraftNudge(pr)}
                                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-indigo-500 to-purple-600 rounded-md hover:from-indigo-600 hover:to-purple-700 transition-all shadow-sm"
                                            >
                                                <Sparkles className="w-3 h-3" />
                                                Draft Nudge
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                                {stuck_prs.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">No stuck PRs! Nice work. 🎉</td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="space-y-6">
                    {/* 3. Bottleneck Visualizer */}
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <div className="flex items-center gap-2 mb-6">
                            <h3 className="font-semibold text-foreground">Pipeline Bottlenecks</h3>
                            <div className="group relative">
                                <Info className="w-4 h-4 text-muted-foreground cursor-help" />
                                <div className="absolute right-0 w-64 bg-popover border text-popover-foreground text-xs p-2 rounded shadow-md hidden group-hover:block z-50">
                                    Shows where PRs are accumulating in the process.
                                </div>
                            </div>
                        </div>

                        <div className="relative space-y-8 pl-4 border-l-2 border-muted ml-3">
                            {/* Step 1 */}
                            <div className="relative">
                                <span className="absolute -left-[21px] top-1 w-4 h-4 rounded-full bg-red-500 ring-4 ring-background"></span>
                                <div className="mb-1 text-sm font-medium">Waiting for Review</div>
                                <div className="text-2xl font-bold text-foreground">{review_flow.waiting_for_review}</div>
                                <div className="text-xs text-muted-foreground">PRs with 0 reviews</div>
                            </div>
                            {/* Step 2 */}
                            <div className="relative">
                                <span className="absolute -left-[21px] top-1 w-4 h-4 rounded-full bg-blue-500 ring-4 ring-background"></span>
                                <div className="mb-1 text-sm font-medium">In Progress</div>
                                <div className="text-2xl font-bold text-foreground">{review_flow.waiting_for_merge}</div>
                                <div className="text-xs text-muted-foreground">Reviewed but not merged</div>
                            </div>
                            {/* Step 3 */}
                            <div className="relative">
                                <span className="absolute -left-[21px] top-1 w-4 h-4 rounded-full bg-emerald-500 ring-4 ring-background"></span>
                                <div className="mb-1 text-sm font-medium">Merged (Last 90d)</div>
                                <div className="text-2xl font-bold text-foreground">{review_flow.merged}</div>
                                <div className="text-xs text-muted-foreground">Completed PRs</div>
                            </div>
                        </div>
                    </div>

                    {/* 4. First Timers */}
                    <div className="bg-card border rounded-lg p-6 shadow-sm">
                        <h3 className="font-semibold text-foreground mb-4">First-Time Experience</h3>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Median Review Time</span>
                                <span className="font-bold">{first_time_prs.median_review_hours}h</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-sm text-muted-foreground">Stuck ({'>'} 7 days)</span>
                                <span className={`font-bold ${first_time_prs.count > 0 ? "text-red-500" : "text-emerald-500"}`}>{first_time_prs.count}</span>
                            </div>
                            <div className="p-3 bg-secondary/30 rounded text-xs text-muted-foreground italic">
                                "First-time contributors who wait {'>'} 48h are 50% less likely to return."
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Nudge Modal */}
            {nudgeModalOpen && (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
                    <div className="bg-card border rounded-lg shadow-lg w-full max-w-lg p-6 relative">
                        <button
                            onClick={() => setNudgeModalOpen(false)}
                            className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
                        >
                            <X className="w-5 h-5" />
                        </button>

                        <div className="flex items-center gap-2 mb-4">
                            <Sparkles className="w-5 h-5 text-purple-500" />
                            <h3 className="font-semibold text-lg">AI Smart Nudge</h3>
                        </div>

                        {nudgeLoading ? (
                            <div className="py-12 flex flex-col items-center gap-3 text-muted-foreground">
                                <Loader2 className="w-8 h-8 animate-spin text-purple-500" />
                                <p className="text-sm">Gemini is drafting a response...</p>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="bg-secondary/30 p-4 rounded-md border text-sm text-foreground/90 whitespace-pre-wrap font-mono">
                                    {nudgeContent}
                                </div>
                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(nudgeContent);
                                            // Optional toast here
                                        }}
                                        className="px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                                    >
                                        Copy to Clipboard
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const SummaryCard = ({ title, value, icon: Icon, desc, color }) => (
    <div className="bg-card p-5 rounded-lg border shadow-sm flex flex-col justify-between">
        <div>
            <div className="flex justify-between items-start mb-2">
                <span className="text-sm font-medium text-muted-foreground">{title}</span>
                <Icon className={`w-5 h-5 ${color} opacity-80`} />
            </div>
            <div className="text-2xl font-bold text-foreground">{value}</div>
            <div className="text-xs text-muted-foreground mt-1">{desc}</div>
        </div>
    </div>
);

export default Bottlenecks;
