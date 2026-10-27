/** @jsxImportSource preact */
import { domainProcessing } from '../../rendering/domain-dynamics.js';

export function DomainRenderingIndicator() {
    return <div id="z_plane_rendering_indicator"
        class={`domain-rendering-indicator${domainProcessing.value ? '' : ' hidden'}`}>
        <span class="domain-rendering-indicator__dot" />
        <span>Rendering…</span>
    </div>;
}
