import { ok } from '@golemcloud/golem-ts-sdk';
import { appendFileSync, readFileSync } from 'node:fs';
import { knife } from './knife-definition.js';

knife.implement({
  knife: async ({ target }) => {
    // This append deliberately has no application-level deduplication.
    appendFileSync(target, 'cut\n');
    console.log('PARCEL_CUT_IN_FLIGHT');

    // Keep the tool call in progress so the runner can crash its owner here.
    await new Promise<void>((resolve) => setTimeout(resolve, 30_000));

    const cuts = readFileSync(target, 'utf8').split('\n').filter(Boolean).length;
    return ok({ target, cuts });
  },
});
