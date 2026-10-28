import { connectMissionEmbed } from './mission-embed-controller.js';

const disconnect = connectMissionEmbed({ documentObject: document, windowObject: window, ResizeObserverClass: ResizeObserver });
window.addEventListener('pagehide', event => { if (!event.persisted) disconnect(); });
