/** @jsxImportSource preact */
import {
    ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Grip, Image, Maximize2,
    Minimize2, Minus, Palette, Plus, RotateCcw, X
} from 'lucide-preact';

const ICONS = {
    'arrow-down': ArrowDown,
    'arrow-left': ArrowLeft,
    'arrow-right': ArrowRight,
    'arrow-up': ArrowUp,
    grip: Grip,
    image: Image,
    'maximize-2': Maximize2,
    'minimize-2': Minimize2,
    minus: Minus,
    palette: Palette,
    plus: Plus,
    'rotate-ccw': RotateCcw,
    x: X
};

export function Icon({ name, ...props }) {
    const Component = ICONS[name];
    if (!Component) throw new Error(`Unknown icon: ${name}`);
    return <Component aria-hidden="true" {...props} />;
}
