import type { ReactNode } from 'react';
import { SiteNavbar } from '@/components/marketing/SiteNavbar';
import { SiteFooter } from '@/components/marketing/SiteFooter';

export default function LegalLayout({ children }: { children: ReactNode }) {
    return (
        <div className="flex min-h-dvh flex-col">
            <SiteNavbar />
            <main className="flex-1">{children}</main>
            <SiteFooter />
        </div>
    );
}
