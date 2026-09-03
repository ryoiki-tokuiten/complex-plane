import { getStateSignal } from '../store/state.js';

export function useAppState(key) {
    return getStateSignal(key).value;
}
