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

export function clearThreeGroup(group) {
    while (group.children.length) {
        const child = group.children[0];
        group.remove(child);
        disposeThreeObject(child);
    }
}

export function scaleSignedOutput(value, outputScale, halfExtent, invalidValue = NaN) {
    if (!Number.isFinite(value)) return invalidValue;
    const ratio = value / Math.max(1e-10, outputScale);
    const magnitude = Math.abs(ratio);
    return (magnitude <= 1
        ? ratio
        : Math.sign(ratio) * (1 + Math.tanh((magnitude - 1) * 0.55) * 0.18)) * halfExtent;
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

export function addCanvasTextSprite(THREE, group, text, position, options) {
    const sprite = createCanvasTextSprite(THREE, text, options);
    sprite.position.copy(position);
    group.add(sprite);
    return sprite;
}

export function appendPolylineSegments(target, points) {
    let previous = null;
    points.forEach(point => {
        if (point && previous) target.push([previous, point]);
        previous = point;
    });
}

export function addThreeLineSegments(THREE, group, segments, options = {}) {
    if (!segments.length) return null;
    const { color = 0xffffff, opacity = 1, vertexColors = null, depthWrite = opacity >= 0.85 } = options;
    const positions = new Float32Array(segments.length * 6);
    const colors = vertexColors ? new Float32Array(segments.length * 6) : null;
    segments.forEach(([start, end], index) => {
        const offset = index * 6;
        positions.set([start.x, start.y, start.z, end.x, end.y, end.z], offset);
        if (colors) {
            const [startColor, endColor = startColor] = vertexColors[index];
            colors.set([startColor.r, startColor.g, startColor.b, endColor.r, endColor.g, endColor.b], offset);
        }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (colors) geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.LineBasicMaterial({
        color: colors ? 0xffffff : color,
        vertexColors: Boolean(colors),
        transparent: opacity < 1,
        opacity,
        depthWrite
    });
    const lines = new THREE.LineSegments(geometry, material);
    group.add(lines);
    return lines;
}

export function addThreePointCloud(THREE, group, points, options = {}) {
    const finitePoints = points.filter(Boolean);
    if (!finitePoints.length) return null;
    const { color = 0xffffff, size = 4, opacity = 1, depthWrite = opacity >= 0.85 } = options;
    const geometry = new THREE.BufferGeometry().setFromPoints(finitePoints);
    const material = new THREE.PointsMaterial({
        color,
        size,
        sizeAttenuation: false,
        transparent: opacity < 1,
        opacity,
        depthWrite
    });
    const cloud = new THREE.Points(geometry, material);
    group.add(cloud);
    return cloud;
}
