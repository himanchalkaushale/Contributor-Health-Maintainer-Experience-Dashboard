import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Users, GitPullRequest, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const Navbar = () => {
    const links = [
        { to: "/", label: "Overview", icon: LayoutDashboard },
        { to: "/contributors", label: "Contributors", icon: Users },
        { to: "/bottlenecks", label: "Bottlenecks", icon: GitPullRequest },
        { to: "/issues", label: "Issues", icon: AlertCircle },
    ];

    return (
        <nav className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
            <div className="container mx-auto px-4 h-16 flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold text-xl">
                    <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
                        cd
                    </div>
                    <span>Contributor Dashboard</span>
                </div>

                <div className="flex items-center gap-1">
                    {links.map(({ to, label, icon: Icon }) => (
                        <NavLink
                            key={to}
                            to={to}
                            className={({ isActive }) => cn(
                                "flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary text-primary-foreground"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )}
                        >
                            <Icon className="w-4 h-4" />
                            <span className="hidden sm:inline">{label}</span>
                        </NavLink>
                    ))}
                </div>
            </div>
        </nav>
    );
};

export default Navbar;
