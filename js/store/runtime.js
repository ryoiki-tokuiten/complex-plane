const createPanState = () => ({
    isPanning: false,
    panStart: { x: 0, y: 0 },
    panStartOrigin: { x: 0, y: 0 }
});

export const runtime = {
    media: {
        image: null,
        video: null,
        videoUrl: '',
        processingFrame: null,
        lastProcessedWallTime: 0,
        lastProcessedMediaTime: -1
    },
    interaction: {
        panZ: createPanState(),
        panW: createPanState()
    },
    navigation: {
        keys: {},
        trail: [],
        lastTime: 0,
        position: { re: 0, im: 0 },
        heading: 0
    },
    rendering: {
        processingZDomainDynamics: false,
        processingWDomainDynamics: false,
        wOriginGlowTime: 0,
        previousWindingNumber: null
    },
    particles: []
};
