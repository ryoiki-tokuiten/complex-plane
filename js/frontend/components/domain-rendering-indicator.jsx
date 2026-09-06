/** @jsxImportSource preact */
import { domainProcessing, domainError } from '../../rendering/domain-dynamics.js';

export function DomainRenderingIndicator() {
    return <div id="z_plane_rendering_indicator"
        class={`domain-rendering-indicator${domainProcessing.value || domainError.value ? '' : ' hidden'}`}>
        {domainProcessing.value && !domainError.value && <span class="domain-rendering-indicator__dot" />}
        <span role={domainError.value ? 'alert' : undefined}>{domainError.value || 'Rendering…'}</span>
    </div>;
}
