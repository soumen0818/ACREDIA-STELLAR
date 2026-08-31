import {
    BarChart2,
    Building2,
    FileSpreadsheet,
    LayoutDashboard,
    List,
    Settings,
    ShieldCheck,
    Upload,
    Users,
    Wallet,
    type LucideIcon,
} from 'lucide-react';
import type { AppRole, RoleState } from '@/types';

export interface ConsoleNavItem {
    label: string;
    href: string;
    icon: LucideIcon;
    description: string;
    /**
     * Highlight only on an exact pathname match. Section roots need this —
     * without it `/dashboard` would stay active on `/dashboard/issued`.
     */
    exact?: boolean;
}

export interface ConsoleNav {
    /** Short badge rendered next to the wordmark, e.g. "Admin". */
    badge: string;
    /** Accessible name for the sidebar `<nav>` landmark. */
    navLabel: string;
    items: ConsoleNavItem[];
}

const ADMIN_NAV: ConsoleNav = {
    badge: 'Admin',
    navLabel: 'Admin navigation',
    items: [
        {
            label: 'Overview',
            href: '/admin',
            icon: LayoutDashboard,
            description: 'System statistics',
            exact: true,
        },
        {
            label: 'Institutions',
            href: '/admin/institutions',
            icon: Building2,
            description: 'Registered issuers',
        },
        {
            label: 'Authorize issuer',
            href: '/admin/authorize',
            icon: ShieldCheck,
            description: 'Grant issuing rights',
        },
        {
            // Stays inside the admin console — sending admins to
            // /dashboard/settings dropped them out of the sidebar layout.
            label: 'Settings',
            href: '/admin/settings',
            icon: Settings,
            description: 'Account settings',
        },
    ],
};

const INSTITUTION_NAV: ConsoleNav = {
    badge: 'Institution',
    navLabel: 'Institution navigation',
    items: [
        {
            label: 'Overview',
            href: '/dashboard',
            icon: LayoutDashboard,
            description: 'Account and status',
            exact: true,
        },
        {
            label: 'Issue credential',
            href: '/dashboard/issue',
            icon: Upload,
            description: 'Issue a single credential',
        },
        {
            label: 'Batch import',
            href: '/dashboard/batch-import',
            icon: FileSpreadsheet,
            description: 'Issue from a CSV file',
        },
        {
            label: 'Students',
            href: '/dashboard/students',
            icon: Users,
            description: 'Manage your roster',
        },
        {
            label: 'Issued credentials',
            href: '/dashboard/issued',
            icon: List,
            description: 'Browse and revoke',
        },
        {
            label: 'Analytics',
            href: '/dashboard/analytics',
            icon: BarChart2,
            description: 'Issuance and verification',
        },
        {
            label: 'Settings',
            href: '/dashboard/settings',
            icon: Settings,
            description: 'Account settings',
        },
    ],
};

const STUDENT_NAV: ConsoleNav = {
    badge: 'Student',
    navLabel: 'Student navigation',
    items: [
        {
            // Not in the original issue's table, but without a link to
            // `/dashboard` the student overview would be the one page in the
            // product with no matching sidebar entry.
            label: 'Overview',
            href: '/dashboard',
            icon: LayoutDashboard,
            description: 'Account summary',
            exact: true,
        },
        {
            label: 'My credentials',
            href: '/dashboard/credentials',
            icon: ShieldCheck,
            description: 'Credentials issued to you',
        },
        {
            label: 'Wallet',
            href: '/dashboard/wallet',
            icon: Wallet,
            description: 'Connected Stellar wallet',
        },
        {
            label: 'Settings',
            href: '/dashboard/settings',
            icon: Settings,
            description: 'Account settings',
        },
    ],
};

/**
 * Least-privileged sidebar for users whose role has not resolved yet, or
 * resolved to something the console has no map for. It exposes nothing that is
 * gated on a role.
 */
const FALLBACK_NAV: ConsoleNav = {
    badge: 'Account',
    navLabel: 'Account navigation',
    items: [
        {
            label: 'Overview',
            href: '/dashboard',
            icon: LayoutDashboard,
            description: 'Account summary',
            exact: true,
        },
        {
            label: 'Settings',
            href: '/dashboard/settings',
            icon: Settings,
            description: 'Account settings',
        },
    ],
};

export const CONSOLE_NAV: Record<AppRole, ConsoleNav> = {
    admin: ADMIN_NAV,
    institution: INSTITUTION_NAV,
    student: STUDENT_NAV,
};

/** Sidebar for a role that may still be `loading` / `unknown` / `unprovisioned`. */
export function getConsoleNav(role: RoleState): ConsoleNav {
    if (role === 'admin' || role === 'institution' || role === 'student') {
        return CONSOLE_NAV[role];
    }
    return FALLBACK_NAV;
}

/**
 * Whether a sidebar item represents the current page. Non-exact items stay
 * active on their own sub-routes (e.g. `/admin/institutions/:id`).
 */
export function isConsoleNavItemActive(pathname: string, item: ConsoleNavItem): boolean {
    if (item.exact) {
        return pathname === item.href;
    }
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
