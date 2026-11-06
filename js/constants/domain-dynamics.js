const DYNAMICS_ESCAPE_RADIUS = 1e4;
const DYNAMICS_ESCAPE_RADIUS_SQ = DYNAMICS_ESCAPE_RADIUS * DYNAMICS_ESCAPE_RADIUS;
export const DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE = 1e8;
const DOMAIN_COLOR_MAGNITUDE_MIN = 1e-30;
const DOMAIN_COLOR_MAGNITUDE_MAX = 1e30;
export const DOMAIN_COLOR_LOG_MAGNITUDE_MIN = Math.log(DOMAIN_COLOR_MAGNITUDE_MIN);
export const DOMAIN_COLOR_LOG_MAGNITUDE_MAX = Math.log(DOMAIN_COLOR_MAGNITUDE_MAX);
export const DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE = 1e30;
export const DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH = 3000;

function glslFloat(value) {
    const source = String(value);
    return source.includes('.') || /e/i.test(source) ? source : `${source}.0`;
}

export function normalizeDomainDynamicsChainCount(value) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH) {
        throw new Error(`Domain-dynamics chain count must be an integer from 1 through ${DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH}.`);
    }
    return count;
}

export const DOMAIN_DYNAMICS_GLSL = `
const float DYNAMICS_ESCAPE_RADIUS = ${glslFloat(DYNAMICS_ESCAPE_RADIUS)};
const float DYNAMICS_ESCAPE_RADIUS_SQ = ${glslFloat(DYNAMICS_ESCAPE_RADIUS_SQ)};
const float DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE = ${glslFloat(DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE)};
const float DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE = 1.0e30;
const int DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH = ${DOMAIN_DYNAMICS_MAX_CHAIN_LENGTH};

bool isFiniteDomainDynamicsValue(vec2 value) {
  return abs(value.x) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE &&
    abs(value.y) < DOMAIN_DYNAMICS_MAX_FINITE_MAGNITUDE;
}

bool domainDynamicsEscapes(vec2 value) {
  if (!(abs(value.x) < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) ||
      !(abs(value.y) < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE)) return true;
  return dot(value, value) > DYNAMICS_ESCAPE_RADIUS_SQ;
}

bool domainDynamicsChainBailsOut(vec2 value) {
  return !(abs(value.x) < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE) ||
    !(abs(value.y) < DOMAIN_COLOR_CHAIN_BAILOUT_MAGNITUDE);
}

float domainDynamicsMagnitude(vec2 value) {
  float scale = max(abs(value.x), abs(value.y));
  if (scale <= 0.0) return 0.0;
  return scale * length(value / scale);
}

float domainDynamicsLogMagnitude(vec2 value) {
  return log(1.0 + domainDynamicsMagnitude(value));
}

float domainDynamicsSmoothIteration(float iteration, float chainCount, vec2 value) {
  if (!isFiniteDomainDynamicsValue(value)) return iteration + 1.0;
  float magnitude = max(domainDynamicsMagnitude(value), DYNAMICS_ESCAPE_RADIUS);
  if (!isFiniteFloatCompat(magnitude) || magnitude <= 1.0001) return iteration + 1.0;
  float adjustment = log(max(log(magnitude) / log(DYNAMICS_ESCAPE_RADIUS), 1.0e-6)) / LOG_TWO;
  return clamp(iteration + 1.0 - adjustment, 0.0, chainCount);
}
`;
