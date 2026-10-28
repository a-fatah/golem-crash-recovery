const eventScenes = Object.freeze({
  'blocking-before': {
    eventKind: 'knife-denied-before', scene: 'working',
    courier: 'Cable request blocked · ribbon next',
    parcelCaption: 'Ribbon waiting to be cut',
    houseCaption: 'Cable off limits · knife request blocked',
    banner: 'The original cable request was blocked before the crash.',
  },
  cutting: {
    eventKind: 'effect-observed', scene: 'working',
    courier: 'Allowed knife call · waiting to return',
    parcelCaption: 'Cut marker observed · tool still unfinished',
    houseCaption: 'Cable off limits · untouched',
    banner: 'The append marker was observed. The tool has not returned at this event.',
  },
  falling: {
    eventKind: 'crash', scene: 'crashed',
    courier: 'Server offline · call unfinished',
    parcelCaption: 'Cut marker observed · not yet sealed',
    houseCaption: 'Cable off limits · rule still applies',
    banner: 'The server exited. Its unfinished call awaits recovery at this event.',
  },
  rising: {
    eventKind: 'restarted', scene: 'recovering',
    courier: 'Replacement server ready · recovering',
    parcelCaption: 'Original cut call · result pending at this event',
    houseCaption: 'Cable off limits · checks will repeat',
    banner: 'The replacement server is ready to recover the original invocation.',
  },
  sealing: {
    eventKind: 'replay', scene: 'recovering',
    courier: 'Recovered tool returned · parcel finished',
    parcelCaption: 'Parcel sealed · recovered call finished',
    houseCaption: 'Cable intact · fresh policy checks follow',
    banner: 'The recovered result reports a sealed parcel. Fresh policy checks follow.',
  },
  'blocking-after': {
    eventKind: 'knife-denied-after', scene: 'recovering',
    courier: 'Fresh cable request blocked · after recovery',
    parcelCaption: 'Parcel sealed · recovered call finished',
    houseCaption: 'Cable intact · fresh knife request blocked',
    banner: 'A fresh cable request was blocked again after recovery.',
  },
});

/** Captions describe the displayed event, even when runtime polling is further ahead. */
export function missionSceneCopy({ mission, cue = null }) {
  if (!mission) return null;
  if (!cue || (cue.stage === 'done' && cue.eventKind === 'complete')) {
    const { scene, courier, parcelCaption, houseCaption, banner } = mission;
    return { scene, courier, parcelCaption, houseCaption, banner };
  }
  const copy = Object.hasOwn(eventScenes, cue.stage) ? eventScenes[cue.stage] : null;
  if (!copy || copy.eventKind !== cue.eventKind) return null;
  return {
    scene: copy.scene, courier: copy.courier, parcelCaption: copy.parcelCaption,
    houseCaption: copy.houseCaption, banner: `Observed event #${cue.id} · ${copy.banner}`,
  };
}
