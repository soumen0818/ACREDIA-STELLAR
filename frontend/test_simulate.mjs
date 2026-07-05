import {
    rpc,
    TransactionBuilder,
    Networks,
    Contract,
    Account,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    xdr,
    scValToNative,
} from '@stellar/stellar-sdk';

async function main() {
    const server = new rpc.Server('https://soroban-testnet.stellar.org');
    const contractId = 'CARWFW27MJ3OJADAUAHI3TDFHIL62YMLVEKTUTMSNXOMH7JJTNZKC3DK';
    const sourceAddress = 'GAMI3XDDII72W23RADNPPAZ2GYEZ2MTYXLETOU36R4ISXMQ7IURFEKFP';

    const sourceAccount = new Account(sourceAddress, '0');
    const contract = new Contract(contractId);

    const txBuilder = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: Networks.TESTNET,
    })
        .addOperation(contract.call('get_owner'))
        .setTimeout(0);

    try {
        const sim = await server.simulateTransaction(txBuilder.build());
        // eslint-disable-next-line no-undef, no-console
        console.log('SIM:', JSON.stringify(sim, null, 2));
        if (sim.result && sim.result.retval) {
            // eslint-disable-next-line no-undef, no-console
            console.log('PARSED ALREADY:', scValToNative(sim.result.retval));
        } else if (sim.results && sim.results.length > 0) {
            // eslint-disable-next-line no-undef, no-console
            console.log('RESULTS ARRAY DETECTED!');
        }
    } catch (e) {
        // eslint-disable-next-line no-undef
        console.error('ERROR:', e);
    }
}
main();
