import { state, context, mutateState } from '../store/state.js';
import { requestRedrawAll } from '../rendering/redraw-scheduler.js';

const { animationStates } = context;

export function toggleAnimation(sliderElement, stateUpdateFn, playButton, speedSelector, isPolyCoeff = false, polyCoeffIndex = -1, polyCoeffPart = '') {
    const sliderId = sliderElement.id;
    if (!animationStates[sliderId]) {
        animationStates[sliderId] = {
            animating: false,
            frameId: null,
            direction: 1, 
            currentAnimatedValue: parseFloat(sliderElement.value)
        };
    }
    let animState = animationStates[sliderId];

    if (animState.animating) {
        animState.animating = false;
        if (animState.frameId) cancelAnimationFrame(animState.frameId);
        playButton.textContent = 'Play';
        playButton.classList.remove('active');
    } else {
        animState.animating = true;
        animState.currentAnimatedValue = parseFloat(sliderElement.value); 
        const min = parseFloat(sliderElement.min);
        const max = parseFloat(sliderElement.max);

        
        if (animState.currentAnimatedValue >= max) animState.direction = -1;
        else if (animState.currentAnimatedValue <= min) animState.direction = 1;
        else animState.direction = animState.direction || 1; 

        playButton.textContent = 'Pause';
        playButton.classList.add('active');

        function animationLoop() {
            if (!animState.animating) return;

            let currentValue = animState.currentAnimatedValue;
            const stepSize = parseFloat(sliderElement.step);
            const currentMin = parseFloat(sliderElement.min); 
            const currentMax = parseFloat(sliderElement.max);
            const speedMultiplier = parseFloat(speedSelector.value);

            currentValue += stepSize * animState.direction * speedMultiplier;

            if (currentValue >= currentMax) {
                currentValue = currentMax;
                animState.direction = -1;
            } else if (currentValue <= currentMin) {
                currentValue = currentMin;
                animState.direction = 1;
            }
            animState.currentAnimatedValue = currentValue;

            const precision = sliderElement.step.includes('.') ? sliderElement.step.split('.')[1].length : 0;
            const displayValue = currentValue.toFixed(precision);
            sliderElement.value = displayValue; 
            const newNumericValue = parseFloat(displayValue); 

            if (isPolyCoeff) {
                if (state.polynomialCoeffs[polyCoeffIndex]) {
                    mutateState('polynomialCoeffs', coefficients => {
                        coefficients[polyCoeffIndex][polyCoeffPart] = newNumericValue;
                    }, `polynomialCoeffs.${polyCoeffIndex}.${polyCoeffPart}`);
                }
            } else {
                stateUpdateFn(newNumericValue); 
            }
            context.domainColoringDirty = true;
            requestRedrawAll(); 
            animState.frameId = requestAnimationFrame(animationLoop);
        }
        animationLoop();
    }
}
