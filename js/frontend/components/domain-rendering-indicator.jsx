/** @jsxImportSource preact */
import { domainStatus } from '../../rendering/domain-dynamics.js';

export function DomainRenderingIndicator() {
    const status = domainStatus.value;
    const visible = status.state === 'rendering' || status.state === 'failed';
    return <div id="z_plane_rendering_indicator"
        role="status" title={status.message ?? ''}
        class={`domain-rendering-indicator${visible ? '' : ' hidden'}`}>
        {status.state === 'rendering' && <span class="domain-rendering-indicator__dot" />}
        <span>{status.state === 'failed' ? 'Render incomplete: ' + status.message : 'Rendering…'}</span>
    </div>;
}
