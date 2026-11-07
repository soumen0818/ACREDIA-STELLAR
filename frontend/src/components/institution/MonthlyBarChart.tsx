'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

/**
 * A count per month as a bar chart.
 *
 * The only module that imports recharts (~350 KB of JS). Load it with
 * `next/dynamic` and nothing else from here: any static import of this file,
 * even of a constant, would put recharts back in the importer's initial JS
 * (review §4.1). See InstitutionAnalytics.
 */
export function MonthlyBarChart({
    data,
    height,
}: {
    data: { month: string; count: number }[];
    height: number;
}) {
    return (
        <ResponsiveContainer width="100%" height={height}>
            <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
        </ResponsiveContainer>
    );
}
