import { mountReader } from './vendor/anallia/document.js';
import { createCustomReader } from './custom-content.js';

const params = new URLSearchParams(location.search);
const examples = params.get('example') === 'custom' ? null : await import('./vendor/anallia/examples.js');
const definition = examples === null ? createCustomReader()
  : params.get('example') === 'tower' ? { ...examples.createTideAtlas(), entry: 'light-entry' } : examples.createTideAtlas();
const reader = mountReader(document.getElementById('scene'), definition, {
  renderer: params.get('renderer') === 'webgl' ? 'webgl' : 'svg', settings: { sound: false, background: 'none' },
});
window.addEventListener('pagehide', event => { if (!event.persisted) reader.destroy(); });
