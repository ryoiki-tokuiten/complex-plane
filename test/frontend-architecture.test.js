import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(project, path), 'utf8');
const sources = directory => readdirSync(resolve(project, directory), { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sources(path) : /\.[jt]sx?$/.test(path) ? [read(path)] : [];
});

test('Preact owns the UI and signals own its updates', () => {
    for (const obsolete of [
        'js/frontend/controllers/ui-sync-controller.js',
        'js/ui/control-registry.js',
        'js/ui/event-listeners.js',
        'js/ui/ui-updates.js',
        'js/ui/dom-components.js'
    ]) assert.equal(existsSync(resolve(project, obsolete)), false);

    assert.match(read('index.html'), /<div id="app"><\/div>/);
    const frontend = sources('js/frontend').join('\n');
    assert.match(read('js/frontend/ui-element.jsx'), /computed\(buildViewModel\)/);
    assert.doesNotMatch(frontend, /document\.getElementById|document\.querySelector|document\.createElement|\.innerHTML\s*=/);

    const panelLayout = read('js/ui/panel-layout-manager.js');
    assert.match(panelLayout, /signal\(\{\}\)/);
    assert.doesNotMatch(panelLayout, /document\.|MutationObserver|querySelector|classList|\.style\./);

    const references = read('js/utils/dom-utils.js');
    assert.doesNotMatch(references, /getElementById|querySelector|registerControls|interactionsBound/);

    for (const runtime of [
        'js/rendering/application-renderer.js',
        'js/rendering/manifold-transformation-animation.js',
        'js/rendering/transformation-graph.js'
    ]) assert.doesNotMatch(read(runtime), /document\.getElementById|document\.querySelector/);
});
