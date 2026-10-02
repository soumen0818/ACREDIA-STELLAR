import { config as loadEnv } from 'dotenv';
loadEnv({ quiet: true }); // Load .env if running directly
import { rpc } from '@stellar/stellar-sdk';
import { processEvent } from '../src/lib/indexerEvent';
import { createClient } from '@supabase/supabase-js';

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
const CONTRACT_ID = process.env.NEXT_PUBLIC_CREDENTIAL_NFT_CONTRACT_ID;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!RPC_URL || !CONTRACT_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Missing required environment variables');
    process.exit(1);
}

// Narrowed after the env guard above so nested closures see a definite string.
const contractId: string = CONTRACT_ID;

const server = new rpc.Server(RPC_URL);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
});

const EVENT_BATCH_SIZE = 1000;
const POLL_INTERVAL_MS = 5000;
const MAX_LEDGER_RANGE = 10000;

async function run() {
    console.log('Starting Acredia off-chain indexer...');

    while (true) {
        try {
            // Get latest network ledger
            const latestLedgerResponse = await server.getLatestLedger();
            const networkLatestLedger = latestLedgerResponse.sequence;

            // Get last synced ledger
            let { data: stateData, error: stateError } = await supabase
                .from('indexer_state')
                .select('last_ledger')
                .eq('id', 'main')
                .maybeSingle();
            if (stateError) throw stateError;

            if (!stateData) {
                // Initialize if not present, starting from current ledger
                const { error: initializeError } = await supabase
                    .from('indexer_state')
                    .insert({ id: 'main', last_ledger: networkLatestLedger });
                if (initializeError) throw initializeError;
                stateData = { last_ledger: networkLatestLedger };
            }

            let startLedger = stateData.last_ledger + 1;

            if (startLedger > networkLatestLedger) {
                // Up to date
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                continue;
            }

            // Fetch events in batches
            let endLedger = Math.min(startLedger + MAX_LEDGER_RANGE, networkLatestLedger);
            console.log(`Syncing ledgers ${startLedger} to ${endLedger}`);

            let cursor: string | undefined = undefined;
            let eventsProcessed = 0;
            let hasMore = true;
            let highestProcessedLedger = endLedger;

            while (hasMore) {
                const filters = [{ type: 'contract' as const, contractIds: [contractId] }];
                // The RPC accepts exactly one of startLedger / cursor — use the
                // cursor for pagination once we have one, else the start ledger.
                const eventsResponse = await server.getEvents(
                    cursor
                        ? { filters, limit: EVENT_BATCH_SIZE, cursor }
                        : { startLedger, filters, limit: EVENT_BATCH_SIZE },
                );

                const events = eventsResponse.events;
                for (const event of events) {
                    await processEvent(event, supabase);
                    highestProcessedLedger = Math.max(highestProcessedLedger, Number(event.ledger));
                    eventsProcessed++;
                }

                if (events.length > 0) {
                    // Resume the next page from the response-level cursor.
                    if (!eventsResponse.cursor || eventsResponse.cursor === cursor) {
                        throw new Error('RPC event pagination did not advance');
                    }
                    cursor = eventsResponse.cursor;
                } else {
                    hasMore = false;
                }
            }

            // Update state
            const { error: cursorError } = await supabase
                .from('indexer_state')
                .update({ last_ledger: highestProcessedLedger, updated_at: new Date().toISOString() })
                .eq('id', 'main');
            if (cursorError) throw cursorError;

            console.log(
                `Successfully processed ${eventsProcessed} events up to ledger ${highestProcessedLedger}`,
            );

            // Delay next iteration
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        } catch (error) {
            console.error('Indexer encountered an error:', error);
            // Wait before retrying on error
            await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        }
    }
}

run().catch(console.error);
