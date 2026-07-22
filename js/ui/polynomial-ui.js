import { state, context, mutateState } from '../store/state.js';
import { toggleAnimation } from './animation.js';
import { requestRedrawAll } from '../rendering/redraw-scheduler.js';

const { controls, polynomialCoeffUIElements, animationStates } = context;

export function initializePolynomialCoeffs(n, preserveExisting = false) {
    const oldCoeffs = preserveExisting ? [...state.polynomialCoeffs] : [];
    state.polynomialCoeffs = [];
    for (let i = 0; i <= n; i++) {
        if (preserveExisting && i < oldCoeffs.length && oldCoeffs[i] !== undefined) {
            state.polynomialCoeffs.push(oldCoeffs[i]);
        } else {
            
            
            if (n === 0) { 
                state.polynomialCoeffs.push({ re: (i === 0 ? 1 : 0), im: 0 });
            } else if (n === 1) { 
                state.polynomialCoeffs.push({ re: (i === 1 ? 1 : 0), im: 0 });
            } else { 
                 
                state.polynomialCoeffs.push({ re: (i === n || (i === 0 && n > 1)) ? 1 : 0, im: 0 });
            }
        }
    }
}

export function generatePolynomialCoeffSliders() {
    if (!controls.polynomialCoeffsContainer) return;
    controls.polynomialCoeffsContainer.innerHTML = ''; 
    polynomialCoeffUIElements.length = 0; 

    
    Object.keys(animationStates).forEach(key => {
        if (key.startsWith('poly_coeff_')) {
            if (animationStates[key].frameId) cancelAnimationFrame(animationStates[key].frameId);
            delete animationStates[key];
        }
    });

    for (let k = 0; k <= state.polynomialN; ++k) {
        const coeff = state.polynomialCoeffs[k] || { re: 0, im: 0 };
        const uiCache = {};

        const row = document.createElement('div');
        row.className = 'polynomial-coeff-row'; 

        
        const reCol = document.createElement('div');
        reCol.className = 'control-group'; 
        const reLabel = document.createElement('label');
        reLabel.htmlFor = `poly_coeff_Re_${k}_slider`;
        
        reLabel.innerHTML = `Re(a<sub>${k}</sub>):`;
        const reOutput = document.createElement('output');
        reOutput.id = `poly_coeff_Re_${k}_value_display`;
        reOutput.className = 'slider-value-output'; 
        reOutput.textContent = coeff.re.toFixed(1);
        uiCache.reDisplay = reOutput;

        const reSliderContainer = document.createElement('div');
        reSliderContainer.className = 'slider-container'; 
        const reSlider = document.createElement('input');
        reSlider.type = 'range';
        reSlider.id = `poly_coeff_Re_${k}_slider`; 
        
        reSlider.min = "-5"; reSlider.max = "5"; reSlider.step = "0.1"; reSlider.value = coeff.re;
        uiCache.reSlider = reSlider;

        const rePlayBtn = document.createElement('button');
        rePlayBtn.id = `play_poly_coeff_Re_${k}_btn`;
        
        rePlayBtn.textContent = 'Play';
        uiCache.rePlayBtn = rePlayBtn;

        const reSpeedSel = document.createElement('select');
        reSpeedSel.id = `speed_poly_coeff_Re_${k}_selector`;
        reSpeedSel.className = 'animation-speed-selector'; 
        ['0.01', '0.1', '0.5', '1', '2'].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = `${val}x`;
            if (val === '1') opt.selected = true;
            reSpeedSel.appendChild(opt);
        });
        uiCache.reSpeedSel = reSpeedSel;
        reSliderContainer.append(reSlider, rePlayBtn, reSpeedSel);
        reCol.append(reLabel, reOutput, reSliderContainer);
        row.appendChild(reCol);

        
        const imCol = document.createElement('div');
        imCol.className = 'control-group'; 
        const imLabel = document.createElement('label');
        imLabel.htmlFor = `poly_coeff_Im_${k}_slider`;
        
        imLabel.innerHTML = `Im(a<sub>${k}</sub>):`;
        const imOutput = document.createElement('output');
        imOutput.id = `poly_coeff_Im_${k}_value_display`;
        imOutput.className = 'slider-value-output'; 
        imOutput.textContent = coeff.im.toFixed(1);
        uiCache.imDisplay = imOutput;

        const imSliderContainer = document.createElement('div');
        imSliderContainer.className = 'slider-container'; 
        const imSlider = document.createElement('input');
        imSlider.type = 'range';
        imSlider.id = `poly_coeff_Im_${k}_slider`; 
        imSlider.min = "-5"; imSlider.max = "5"; imSlider.step = "0.1"; imSlider.value = coeff.im;
        uiCache.imSlider = imSlider;

        const imPlayBtn = document.createElement('button');
        imPlayBtn.id = `play_poly_coeff_Im_${k}_btn`;
        
        imPlayBtn.textContent = 'Play';
        uiCache.imPlayBtn = imPlayBtn;

        const imSpeedSel = document.createElement('select');
        imSpeedSel.id = `speed_poly_coeff_Im_${k}_selector`;
        imSpeedSel.className = 'animation-speed-selector'; 
        ['0.01', '0.1', '0.5', '1', '2'].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val; opt.textContent = `${val}x`;
            if (val === '1') opt.selected = true;
            imSpeedSel.appendChild(opt);
        });
        uiCache.imSpeedSel = imSpeedSel;
        imSliderContainer.append(imSlider, imPlayBtn, imSpeedSel);
        imCol.append(imLabel, imOutput, imSliderContainer);
        row.appendChild(imCol);

        controls.polynomialCoeffsContainer.appendChild(row);
        polynomialCoeffUIElements[k] = uiCache; 

        
        reSlider.addEventListener('input', () => {
            mutateState('polynomialCoeffs', coefficients => {
                coefficients[k].re = parseFloat(reSlider.value);
            }, `polynomialCoeffs.${k}.re`);
            context.domainColoringDirty = true;
            requestRedrawAll(); 
        });
        rePlayBtn.addEventListener('click', () => toggleAnimation(reSlider, '', rePlayBtn, reSpeedSel, true, k, 're'));

        imSlider.addEventListener('input', () => {
            mutateState('polynomialCoeffs', coefficients => {
                coefficients[k].im = parseFloat(imSlider.value);
            }, `polynomialCoeffs.${k}.im`);
            context.domainColoringDirty = true;
            requestRedrawAll(); 
        });
        imPlayBtn.addEventListener('click', () => toggleAnimation(imSlider, '', imPlayBtn, imSpeedSel, true, k, 'im'));
    }
}

export function updatePolynomialCoeffDisplays() {
    if (!state.polynomialCoeffs) return;
    for (let k = 0; k <= state.polynomialN; ++k) {
        if (state.polynomialCoeffs[k] && polynomialCoeffUIElements[k]) {
            const ui = polynomialCoeffUIElements[k];
            if (ui.reDisplay) ui.reDisplay.textContent = state.polynomialCoeffs[k].re.toFixed(1);
            if (ui.imDisplay) ui.imDisplay.textContent = state.polynomialCoeffs[k].im.toFixed(1);
        }
    }
}
