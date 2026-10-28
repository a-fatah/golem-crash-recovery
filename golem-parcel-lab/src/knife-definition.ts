import { toolDefinition } from '@golemcloud/golem-ts-sdk';
import { z } from 'zod/v4';

export const knife = toolDefinition('knife', { requiresFilesystem: true })
  .version('1.0.0')
  .body((body) =>
    body
      .positional('target', z.string())
      .positional('claim', z.string())
      .returns(z.object({ target: z.string(), cuts: z.number() })),
  );
