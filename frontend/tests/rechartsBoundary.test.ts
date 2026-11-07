import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * recharts is ~350 KB of JS. It is loaded only when a chart is shown
 * (review §4.1): one module imports it, and that module is reached only
 * through `next/dynamic` / `import()`. A static import anywhere would put the
 * library back in a page's initial JS without any test failing.
 */

const SRC = join(process.cwd(), 'src');
const CHART_MODULE = join(SRC, 'components', 'institution', 'MonthlyBarChart.tsx');

function walkTypeScriptFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) return walkTypeScriptFiles(full);
        return /\.tsx?$/.test(entry) ? [full] : [];
    });
}

const files = walkTypeScriptFiles(SRC);

describe('recharts loading boundary', () => {
    it('finds source files to check', () => {
        // A path typo would otherwise make every assertion below vacuous.
        expect(files.length).toBeGreaterThan(50);
        expect(files).toContain(CHART_MODULE);
    });

    it('confines recharts to MonthlyBarChart', () => {
        const importers = files
            .filter((file) => /(?:from|import)\s*\(?\s*['"]recharts(?:\/[^'"]*)?['"]/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));

        expect(importers).toEqual([relative(SRC, CHART_MODULE)]);
    });

    it('reaches MonthlyBarChart only through a dynamic import', () => {
        const staticImporters = files
            .filter((file) => /(?:import|export)[^'";()]*\sfrom\s+['"][^'"]*\/MonthlyBarChart['"]/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));
        const dynamicImporters = files
            .filter((file) => /import\(\s*['"][^'"]*\/MonthlyBarChart['"]\s*\)/.test(readFileSync(file, 'utf8')))
            .map((file) => relative(SRC, file));

        expect(staticImporters).toEqual([]);
        expect(dynamicImporters).toEqual(['components/institution/InstitutionAnalytics.tsx']);
    });
});
