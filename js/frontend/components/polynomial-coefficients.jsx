/** @jsxImportSource preact */
import { useEffect } from 'preact/hooks';
import { mutateState } from '../../store/state.js';
import { useAppState } from '../state-hooks.js';
import { requestDomainRedraw } from '../../rendering/redraw-scheduler.js';
import { animations, animationSpeed, setAnimationSpeed, stopAnimations, toggleAnimation } from '../animation-controller.js';

const SPEEDS = ['0.01', '0.1', '0.5', '1', '2'];

function CoefficientControl({ index, part, value }) {
    const label = part === 're' ? 'Re' : 'Im';
    const idPart = part === 're' ? 'Re' : 'Im';
    const sliderId = `poly_coeff_${idPart}_${index}_slider`;
    const speedId = `speed_poly_coeff_${idPart}_${index}_selector`;
    const animating = Boolean(animations.value[sliderId]?.animating);

    const update = event => {
        const nextValue = Number.parseFloat(event.currentTarget.value);
        mutateState('polynomialCoeffs', coefficients => {
            coefficients[index][part] = nextValue;
        }, `polynomialCoeffs.${index}.${part}`);
        requestDomainRedraw();
    };

    return (
        <div class="control-group">
            <label for={sliderId}>
                {label}(a<sub>{index}</sub>): <output id={`poly_coeff_${idPart}_${index}_value_display`} class="slider-value-output">{Number(value).toFixed(1)}</output>
            </label>
            <div class="slider-container">
                <input type="range" id={sliderId} min="-5" max="5" step="0.1"
                    value={value} onInput={update} />
                <button id={`play_poly_coeff_${idPart}_${index}_btn`} type="button"
                    class={animating ? 'active' : ''}
                    onClick={() => toggleAnimation({
                        id: sliderId, value: Number(value), min: -5, max: 5, step: .1, speedId,
                        update: next => mutateState('polynomialCoeffs', coefficients => {
                            coefficients[index][part] = next;
                        }, `polynomialCoeffs.${index}.${part}`)
                    })}>
                    {animating ? 'Pause' : 'Play'}
                </button>
                <select id={speedId} class="animation-speed-selector" value={String(animationSpeed(speedId))}
                    onChange={event => setAnimationSpeed(speedId, event.currentTarget.value)}>
                    {SPEEDS.map(value => <option value={value}>{value}x</option>)}
                </select>
            </div>
        </div>
    );
}

export function PolynomialCoefficients() {
    const degree = useAppState('polynomialN');
    const coefficients = useAppState('polynomialCoeffs');

    useEffect(() => () => stopAnimations('poly_coeff_'), [degree]);

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
