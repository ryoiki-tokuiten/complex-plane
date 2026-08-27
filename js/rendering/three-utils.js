export function disposeThreeObject(object) {
    if (!object) return;

    const geometries = new Set();
    const materials = new Set();
    object.traverse(child => {
        if (child.geometry) geometries.add(child.geometry);
        if (Array.isArray(child.material)) {
            child.material.forEach(material => materials.add(material));
        } else if (child.material) {
            materials.add(child.material);
        }
    });

    geometries.forEach(geometry => geometry.dispose?.());
    materials.forEach(material => {
        material.map?.dispose?.();
        material.dispose?.();
    });
}

export function createCanvasTextSprite(THREE, text, options = {}) {
    const {
        color = 'rgba(236, 241, 255, 0.95)',
        fontSize = 52,
        weight = 700,
        fontFamily = '"STIX Two Math", "Cambria Math", "Inter", sans-serif',
        font = `${weight} ${fontSize}px ${fontFamily}`,
        shadowColor = 'rgba(0, 0, 0, 0.6)',
        shadowBlur = 12,
        scale = null,
        height = null,
        maxWidth = 2048,
        padding = 32
    } = options;

    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    measureCtx.font = font;
    const measured = measureCtx.measureText(text);
    const width = Math.min(maxWidth, Math.max(192, Math.ceil(measured.width + padding * 2)));
    const canvasHeight = Math.ceil(fontSize + padding * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = canvasHeight;
    const context = canvas.getContext('2d');
    context.font = font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.shadowColor = shadowColor;
    context.shadowBlur = shadowBlur;
    context.fillStyle = color;
    context.fillText(text, width / 2, canvasHeight / 2, width - padding);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    if (Array.isArray(scale)) {
        sprite.scale.set(...scale);
    } else if (typeof height === 'number') {
        sprite.scale.set(height * (width / canvasHeight), height, 1);
    } else {
        sprite.scale.set(1.35, 0.5, 1);
    }
    return sprite;
}
