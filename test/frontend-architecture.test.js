import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    hidePlaneContextMenu,
    openPlaneContextMenu,
    setPlaneContextMenuHandlers
} from '../js/frontend/plane-context-menu-state.js';
import {
    hideDynamicTooltip,
    moveStaticTooltip,
    showDynamicTooltip,
    subscribeTooltip
} from '../js/frontend/tooltip-state.js';

const project = resolve(import.meta.dirname, '..');

function sourceFiles(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? sourceFiles(path) : /\.[jt]sx?$/.test(entry.name) ? [path] : [];
    });
}

test('the frontend has one Preact shell and no legacy UI pipelines', () => {
    for (const path of [
        'js/ui/event-listeners.js',
        'js/ui/ui-updates.js',
        'js/ui/dom-components.js',
        'js/ui/grid-shape-controls.js',
        'js/ui/grid-density-controls.js',
        'js/ui/plane-context-menu.js',
        'js/ui/tooltip.js',
        'js/ui/animation.js',
        'js/ui/dynamic-plotting-state.js',
        'js/ui/theme-manager.js',
        'js/ui/polynomial-ui.js',
        'js/frontend/mount-frontend.jsx'
    ]) assert.equal(existsSync(resolve(project, path)), false, `${path} must stay deleted`);

    const html = readFileSync(resolve(project, 'index.html'), 'utf8');
    assert.match(html, /<div id="app"><\/div>/);
    assert.doesNotMatch(html, /id="(?:z_plane|controls_options|preloader|fullscreen_container)/);

    const frontendSource = sourceFiles(resolve(project, 'js/frontend'))
        .map(path => readFileSync(path, 'utf8'))
        .join('\n');
    assert.doesNotMatch(frontendSource, /document\.createElement|cloneNode\(|appendChild\(|\.innerHTML\s*=/);

    const manifoldRuntime = readFileSync(
        resolve(project, 'js/rendering/manifold-transformation-animation.js'),
        'utf8'
    );
    assert.doesNotMatch(manifoldRuntime,
        /createElement(?:NS)?|addEventListener|querySelector|textContent|replaceChildren|classList|sliderId|buttonId/);
    assert.match(frontendSource, /ManifoldTransformationControls/);

    for (const path of [
        'js/navigation-plane.js',
        'js/utils/raster-media.js',
        'js/rendering/application-renderer.js',
        'js/rendering/domain-dynamics.js',
        'js/rendering/draw-palette-preview.js'
    ]) {
        const source = readFileSync(resolve(project, path), 'utf8');
        assert.doesNotMatch(source, /textContent\s*=|classList\.(?:add|remove|toggle)|replaceChildren/,
            `${path} must not mutate Preact-owned UI`);
    }

    const riemannRenderer = readFileSync(resolve(project, 'js/rendering/webgl-riemann-surface.js'), 'utf8');
    assert.doesNotMatch(riemannRenderer, /createHud|renderer\.hud|document\.createElement\('div'\)/);

    const stylesheet = readFileSync(resolve(project, 'css/styles.css'), 'utf8');
    const imports = stylesheet.match(/@import/g) || [];
    assert.equal(imports.length, 10);
    assert.ok(stylesheet.length < 500, 'styles.css should remain an import manifest');
});

test('context-menu commands route through the Preact-owned controller', () => {
    const calls = [];
    const unregister = setPlaneContextMenuHandlers(
        (event, plane) => calls.push(['open', event, plane]),
        () => calls.push(['close'])
    );
    const event = { clientX: 12 };
    openPlaneContextMenu(event, 'w');
    hidePlaneContextMenu();
    assert.deepEqual(calls, [['open', event, 'w'], ['close']]);
    unregister();
    openPlaneContextMenu(event, 'z');
    assert.equal(calls.length, 2);
});

test('tooltip state publishes declarative show, move, and hide updates', () => {
    const updates = [];
    const target = {};
    const unsubscribe = subscribeTooltip(value => updates.push(value));
    showDynamicTooltip('z = 1', 10, 20, true, target);
    moveStaticTooltip(30, 40, target);
    hideDynamicTooltip(target);
    unsubscribe();

    assert.equal(updates.at(-3).visible, true);
    assert.deepEqual([updates.at(-2).x, updates.at(-2).y], [30, 40]);
    assert.equal(updates.at(-1).visible, false);
});
