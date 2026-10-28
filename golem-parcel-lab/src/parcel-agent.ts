import { defineAgent, method } from '@golemcloud/golem-ts-sdk';
import { z } from 'zod/v4';

export const PolicyProbeReport = z.object({
  middlewareDenied: z.boolean(),
  middlewareError: z.string(),
  directWriteDenied: z.boolean(),
  directWriteError: z.string(),
});

export const ParcelReport = PolicyProbeReport.extend({
  parcelCuts: z.number(),
  cableContents: z.string(),
  sealed: z.boolean(),
});

export const ParcelAgent = defineAgent({
  name: 'ParcelAgent',
  id: { name: z.string() },
  methods: {
    run: method({ input: {}, returns: ParcelReport }),
    status: method({ input: {}, returns: ParcelReport }),
    probePolicy: method({ input: {}, returns: PolicyProbeReport }),
  },
});
