import type { ReactNode } from 'react';

interface BrandSectionHeaderProps {
    title: string;
    description: string;
    eyebrow?: string;
    align?: 'left' | 'center';
    children?: ReactNode;
}

export function BrandSectionHeader({
    title,
    description,
    eyebrow,
    align = 'center',
    children,
}: BrandSectionHeaderProps) {
    return (
        <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
            {eyebrow ? (
                <p className="mb-3 text-sm font-semibold uppercase tracking-[0.25em] text-teal-600">
                    {eyebrow}
                </p>
            ) : null}
            <h2 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                {title}
            </h2>
            <p className="mt-4 text-lg leading-8 text-slate-600">{description}</p>
            {children}
        </div>
    );
}
