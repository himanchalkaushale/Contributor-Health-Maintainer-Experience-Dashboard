import React, { useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
    LayoutDashboard,
    Users,
    GitPullRequest,
    AlertCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

const Sidebar = () => {
    const navItems = [
        { to: "/", label: "Dashboard", icon: LayoutDashboard },
        { to: "/contributors", label: "Contributors", icon: Users },
        { to: "/pr-review-health", label: "PR Review Health", icon: GitPullRequest },
        { to: "/issues", label: "Issues", icon: AlertCircle },
    ];

    return (
        <aside className="w-64 bg-background border-r h-screen fixed left-0 top-0 flex flex-col z-30">
            {/* Sidebar Header */}
            <div className="h-16 flex items-center px-6 border-b">
                <span className="font-bold text-lg tracking-tight">OpenSource<span className="text-primary">Health</span></span>
            </div>

            <div className="flex-1 py-6 px-4 space-y-2">
                {navItems.map((item) => (
                    <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => cn(
                            "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                            isActive
                                ? "bg-secondary text-foreground"
                                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                        )}
                    >
                        <item.icon className="w-4 h-4" />
                        {item.label}
                    </NavLink>
                ))}
            </div>

            <div className="p-4 border-t text-xs text-muted-foreground">
                <p>Self-hosted & Read-only</p>
                <p>v1.0.0</p>
            </div>
        </aside>
    );
};

export default Sidebar;
