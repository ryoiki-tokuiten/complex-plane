export function createElement(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    const { className, text, type, attrs, dataset } = props;

    if (className) node.className = className;
    if (type) node.type = type;
    if (text !== undefined) node.textContent = text;
    Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, value));
    Object.entries(dataset || {}).forEach(([key, value]) => {
        node.dataset[key] = value;
    });
    for (const child of Array.isArray(children) ? children : [children]) {
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
}

export function createSelect(options, value, onChange, className = '') {
    const select = createElement('select', { className });
    for (const option of options) {
        const optionValue = option.value ?? option.id;
        const item = createElement('option', { text: option.label });
        item.value = optionValue;
        item.selected = optionValue === value;
        select.appendChild(item);
    }
    select.value = value;
    select.addEventListener('change', onChange);
    return select;
}

const SAFE_MARKUP_ELEMENTS = new Set(['B', 'BR', 'CODE', 'I', 'STRONG', 'SUB', 'SUP', 'SPAN']);
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

export function createSafeMarkupFragment(markup) {
    const parsed = new DOMParser().parseFromString(String(markup), 'text/html');
    const fragment = document.createDocumentFragment();

    function appendSafeNode(source, parent) {
        if (source.nodeType === TEXT_NODE) {
            parent.appendChild(document.createTextNode(source.textContent || ''));
            return;
        }
        if (source.nodeType !== ELEMENT_NODE || !SAFE_MARKUP_ELEMENTS.has(source.tagName)) return;

        const element = document.createElement(source.tagName.toLowerCase());
        if (source.tagName === 'SPAN' && source.classList.contains('formula-note')) {
            element.className = 'formula-note';
        }
        source.childNodes.forEach(child => appendSafeNode(child, element));
        parent.appendChild(element);
    }

    parsed.body.childNodes.forEach(node => appendSafeNode(node, fragment));
    return fragment;
}

export const createFormulaFragment = createSafeMarkupFragment;
