/** @jsxImportSource preact */
import { useEffect, useRef } from 'preact/hooks';
import { context, getStateSignal, mutateState } from '../../store/state.js';
import { requestRedrawAll } from '../../rendering/redraw-scheduler.js';
import { toggleAnimation } from '../../ui/animation.js';

const SPEEDS = ['0.01', '0.1', '0.5', '1', '2'];

function CoefficientControl({ index, part, value }) {
    const slider = useRef(null);
    const button = useRef(null);
    const speed = useRef(null);
    const label = part === 're' ? 'Re' : 'Im';
    const idPart = part === 're' ? 'Re' : 'Im';
    const sliderId = `poly_coeff_${idPart}_${index}_slider`;

    const update = event => {
        const nextValue = Number.parseFloat(event.currentTarget.value);
        mutateState('polynomialCoeffs', coefficients => {
            coefficients[index][part] = nextValue;
        }, `polynomialCoeffs.${index}.${part}`);
        context.domainColoringDirty = true;
        requestRedrawAll();
    };

    return (
        <div class="control-group">
            <label for={sliderId}>{label}(a<sub>{index}</sub>):</label>
            <output id={`poly_coeff_${idPart}_${index}_value_display`} class="slider-value-output">
                {Number(value).toFixed(1)}
            </output>
            <div class="slider-container">
                <input ref={slider} type="range" id={sliderId} min="-5" max="5" step="0.1"
                    value={value} onInput={update} />
                <button ref={button} id={`play_poly_coeff_${idPart}_${index}_btn`} type="button"
                    onClick={() => toggleAnimation(slider.current, '', button.current, speed.current, true, index, part)}>
                    Play
                </button>
                <select ref={speed} id={`speed_poly_coeff_${idPart}_${index}_selector`}
                    class="animation-speed-selector" value="1">
                    {SPEEDS.map(value => <option value={value}>{value}x</option>)}
                </select>
            </div>
        </div>
    );
}

export function PolynomialCoefficients() {
    const degree = getStateSignal('polynomialN').value;
    const coefficients = getStateSignal('polynomialCoeffs').value;

    useEffect(() => () => {
        Object.entries(context.animationStates).forEach(([key, animation]) => {
            if (!key.startsWith('poly_coeff_')) return;
            if (animation.frameId) cancelAnimationFrame(animation.frameId);
            delete context.animationStates[key];
        });
    }, [degree]);

    return Array.from({ length: degree + 1 }, (_, index) => {
        const coefficient = coefficients[index] || { re: 0, im: 0 };
        return (
            <div class="polynomial-coeff-row" key={index}>
                <CoefficientControl index={index} part="re" value={coefficient.re} />
                <CoefficientControl index={index} part="im" value={coefficient.im} />
            </div>
        );
    });
}
