/** @jsxImportSource preact */
import { render } from 'preact';
import { PolynomialCoefficients } from './components/polynomial-coefficients.jsx';
import { ComplexPointEditor } from './components/complex-point-editor.jsx';
import { AlgebraicTermEditor } from './components/algebraic-term-editor.jsx';
import { PaletteGuide } from './components/palette-guide.jsx';
import { ThemeModal } from './components/theme-modal.jsx';
import {
    DynamicExampleCount,
    DynamicExampleGallery,
    DynamicParameters,
    DynamicSequenceBindings,
    DynamicTermFactors
} from './components/dynamic-generated-controls.jsx';
import {
    ActiveDomainPaletteName,
    ActiveRealPlotsPaletteName,
    DomainPaletteOptions,
    RealPlotsPaletteOptions
} from './components/theme-and-palette-options.jsx';

const ISLANDS = [
    ['polynomial_coeffs_container', PolynomialCoefficients],
    ['taylor_complex_points_ui_container', ComplexPointEditor],
    ['algebraic_terms_list', AlgebraicTermEditor],
    ['frontend_modal_root', ThemeModal],
    ['domain_palette_circles', DomainPaletteOptions],
    ['real_plots_palette_circles', RealPlotsPaletteOptions],
    ['active_domain_palette_name', ActiveDomainPaletteName],
    ['active_real_plots_palette_name', ActiveRealPlotsPaletteName],
    ['dynamic_example_count', DynamicExampleCount],
    ['dynamic_example_gallery', DynamicExampleGallery],
    ['dynamic_term_factors', DynamicTermFactors],
    ['dynamic_sequence_bindings_list', DynamicSequenceBindings],
    ['dynamic_parameters_list', DynamicParameters]
];

const GUIDES = [
    ['domain_palette_circle_panel', 'domain'],
    ['real_plots_palette_circle_panel', 'real']
];

export function mountFrontend() {
    ISLANDS.forEach(([id, Component]) => {
        const container = document.getElementById(id);
        if (container) render(<Component />, container);
    });
    GUIDES.forEach(([id, type]) => {
        const container = document.getElementById(id);
        if (container) render(<PaletteGuide type={type} />, container);
    });
    window.lucide?.createIcons?.();
}
