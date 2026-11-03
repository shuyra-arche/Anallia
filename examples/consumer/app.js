import { mountEmbeddedReader } from './vendor/anallia/embedded.js';
import { createTideAtlas } from './vendor/anallia/examples.js';

const definitions = { shore: createTideAtlas, tower: () => ({ ...createTideAtlas(), entry: 'light-entry' }) };
const handles = new Map();
const renderer = new URLSearchParams(location.search).get('renderer') === 'webgl' ? 'webgl' : 'svg';
const mount = id => {
  const reader = mountEmbeddedReader(document.getElementById(id), definitions[id](), {
    frameUrl: new URL('./vendor/anallia/reader-frame.html', document.baseURI),
    renderer, settings: { sound: false, background: 'none' },
  });
  handles.set(id, reader);
  reader.ready.catch(error => {
    if (handles.get(id) === reader) document.getElementById('status').textContent = String(error);
  });
};
for (const id of Object.keys(definitions)) {
  mount(id);
  const button = document.getElementById(`toggle-${id}`);
  button.addEventListener('click', () => {
    const reader = handles.get(id);
    if (reader) { reader.destroy(); handles.delete(id); } else mount(id);
    const action = handles.has(id) ? '关闭' : '重新打开';
    button.textContent = action;
    button.setAttribute('aria-label', action + (id === 'shore' ? '岸边读本' : '塔上读本'));
  });
}
window.addEventListener('pagehide', event => {
  if (!event.persisted) { for (const reader of handles.values()) reader.destroy(); handles.clear(); }
});
