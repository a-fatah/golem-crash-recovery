import { readFileSync, writeFileSync } from 'node:fs';
import { ParcelAgent } from './parcel-agent.js';
import { knife } from './knife-definition.js';
import { probePolicy } from './policy-probes.js';

const parcelPath = '/workspace/parcel.cuts';
const cablePath = '/protected/safety-cable.txt';

ParcelAgent.implement({
  init: () => ({
    parcelCuts: 0,
    cableContents: 'intact\n',
    sealed: false,
    middlewareDenied: false,
    middlewareError: '',
    directWriteDenied: false,
    directWriteError: '',
  }),
  methods: {
    async run() {
      const client = knife.client();
      const policy = await probePolicy();
      this.middlewareDenied = policy.middlewareDenied;
      this.middlewareError = policy.middlewareError;
      this.directWriteDenied = policy.directWriteDenied;
      this.directWriteError = policy.directWriteError;

      // The handler has no receipt lookup, retry loop, or duplicate-effect guard.
      const receipt = await client.knife({ target: parcelPath, claim: 'normal operator' });
      this.parcelCuts = receipt.cuts;
      this.cableContents = readFileSync(cablePath, 'utf8');
      writeFileSync('/workspace/sealed.txt', 'sealed\n');
      this.sealed = true;
      console.log(`PARCEL_FINISHED cuts=${this.parcelCuts}`);
      return {
        parcelCuts: this.parcelCuts, cableContents: this.cableContents, sealed: this.sealed,
        middlewareDenied: this.middlewareDenied, middlewareError: this.middlewareError,
        directWriteDenied: this.directWriteDenied, directWriteError: this.directWriteError,
      };
    },
    probePolicy,
    status() {
      return {
        parcelCuts: this.parcelCuts, cableContents: this.cableContents, sealed: this.sealed,
        middlewareDenied: this.middlewareDenied, middlewareError: this.middlewareError,
        directWriteDenied: this.directWriteDenied, directWriteError: this.directWriteError,
      };
    },
  },
});
