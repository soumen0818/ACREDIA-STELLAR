import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudentOverview } from '../src/components/console/overview/StudentOverview';

/**
 * Review §3.3: the student dashboard used to write `students.wallet_address`
 * from the browser with whatever wallet was connected, with no proof of
 * ownership. A student's wallet is now recorded only by their institution
 * (roster API) or the signed /claim flow, both server-side.
 *
 * The database rejects the write regardless (tests/rls/, review §3.2); this
 * file stops client code from trying again, and checks the student-facing
 * copy no longer promises what the old write did.
 */

const SRC = join(process.cwd(), 'src');
const API_ROUTES = join(SRC, 'app', 'api');

// A write chained straight onto `.from('students')`, as every write in this
// codebase is written.
const STUDENTS_WRITE = /\.from\(\s*['"]students['"]\s*\)\s*\.(update|insert|upsert|delete)\s*\(/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sourceFiles(path);
        return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe('students table writes stay server-side', () => {
    it('the guard pattern recognises the write that was removed', () => {
        // Guards against this test passing vacuously after a refactor.
        const removed = `await supabase
                    .from('students')
                    .update({ wallet_address: studentWallet })`;
        expect(removed).toMatch(STUDENTS_WRITE);
        expect(`.from('students').select('id')`).not.toMatch(STUDENTS_WRITE);
    });

    it('no code outside src/app/api writes to students', () => {
        const offenders = sourceFiles(SRC)
            .filter((file) => !file.startsWith(API_ROUTES))
            .filter((file) => STUDENTS_WRITE.test(readFileSync(file, 'utf8')))
            .map((file) => relative(process.cwd(), file));

        expect(offenders).toEqual([]);
    });
});

describe('student overview copy', () => {
    // Rendered without providers: no user and no connected wallet, which is
    // exactly when the old prompt appeared.
    const html = renderToStaticMarkup(<StudentOverview />);

    it('does not claim a wallet is needed to view credentials', () => {
        expect(html).not.toContain('Connect your wallet to view your credentials');
    });

    it('does not promise students can change their own wallet', () => {
        expect(html).not.toContain('Connect or change the Stellar wallet');
        expect(html).toContain('To change that wallet, ask your institution.');
    });
});
