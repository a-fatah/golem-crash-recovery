import { ToolInvokeError } from '@golemcloud/golem-ts-sdk';
import { knife } from './knife-definition.js';

export const knifePolicy = knife.middleware({
  name: 'knife-policy',
  implementation: {
    knife: async (args, { underlying }) => {
      if (args.target !== '/workspace/parcel.cuts') {
        throw new ToolInvokeError({
          tag: 'constraint-violation',
          val: `Knife policy denies target: ${args.target}`,
        });
      }

      return underlying.knife(args);
    },
  },
});
