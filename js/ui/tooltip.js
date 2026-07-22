import { createSafeMarkupFragment } from './dom-components.js';

let globalTooltipElement = null;

export function initializeTooltips() {
    globalTooltipElement = document.getElementById('tooltip');
    if (!globalTooltipElement) {
        console.warn("Tooltip element with ID 'tooltip' not found.");
        return;
    }

    const tooltipTriggers = document.querySelectorAll('[data-tooltip]');

    tooltipTriggers.forEach(trigger => {
        trigger.addEventListener('mouseover', (event) => {
            const tooltipText = trigger.getAttribute('data-tooltip');
            if (tooltipText) {
                
                showDynamicTooltip(tooltipText, event.pageX, event.pageY, true, trigger);
            }
        });

        trigger.addEventListener('mousemove', (event) => {
            
            if (globalTooltipElement.style.display === 'block' &&
                globalTooltipElement.dataset.isStatic === "true" &&
                globalTooltipElement.dataset.targetElementId === trigger.id) {
                moveTooltip(event.pageX, event.pageY);
            }
        });

        trigger.addEventListener('mouseout', (event) => {
            
            if (globalTooltipElement.dataset.isStatic === "true" &&
                globalTooltipElement.dataset.targetElementId === trigger.id) {
                
                
                
                
                hideDynamicTooltip();
            }
        });
    });
}

export function moveTooltip(pageX, pageY) {
    if (!globalTooltipElement) return;

    let x = pageX + 15; 
    let y = pageY + 15; 

    
    const tooltipWidth = globalTooltipElement.offsetWidth;
    const tooltipHeight = globalTooltipElement.offsetHeight;

    if (globalTooltipElement.style.display === 'block' && tooltipWidth > 0 && tooltipHeight > 0) {
        
        if (x + tooltipWidth + 20 > window.innerWidth) {
            x = pageX - tooltipWidth - 15; 
        }
        
        if (y + tooltipHeight + 20 > window.innerHeight) {
            y = pageY - tooltipHeight - 15; 
        }
    } else {
        
        
        const estimatedWidth = 200;
        const estimatedHeight = 100;
        if (x + estimatedWidth > window.innerWidth) {
            x = pageX - estimatedWidth - 15;
        }
        if (y + estimatedHeight > window.innerHeight) {
            y = pageY - estimatedHeight - 15;
        }
    }

    
    x = Math.max(0, x);
    y = Math.max(0, y);

    globalTooltipElement.style.left = x + 'px';
    globalTooltipElement.style.top = y + 'px';
}

/**
 * Shows a tooltip with specified HTML content at given screen coordinates.
 * @param {string} htmlContent - The HTML content to display in the tooltip.
 * @param {number} pageX - The mouse X coordinate on the page.
 * @param {number} pageY - The mouse Y coordinate on the page.
 * @param {boolean} isStatic - If true, this tooltip is for a static HTML element [data-tooltip].
 * @param {HTMLElement} targetElement - The element triggering the tooltip (optional, for static).
 */
export function showDynamicTooltip(htmlContent, pageX, pageY, isStatic = false, targetElement = null) {
    if (!globalTooltipElement) return;
    globalTooltipElement.replaceChildren(createSafeMarkupFragment(htmlContent));
    globalTooltipElement.style.display = 'block'; 
    globalTooltipElement.dataset.isStatic = isStatic ? "true" : "false";

    if (isStatic && targetElement) {
        
        
        if (!targetElement.id) {
            
            
        }
        globalTooltipElement.dataset.targetElementId = targetElement.id;
    } else {
        delete globalTooltipElement.dataset.targetElementId;
    }
    moveTooltip(pageX, pageY); 
}

/**
 * Hides the dynamic tooltip.
 */
export function hideDynamicTooltip() {
    if (!globalTooltipElement) return;

    
    
    if (globalTooltipElement.dataset.isStatic === "true") {
        globalTooltipElement.style.display = 'none';
        
        
    } else { 
        globalTooltipElement.style.display = 'none';
        delete globalTooltipElement.dataset.isStatic; 
        delete globalTooltipElement.dataset.targetElementId; 
    }
}
