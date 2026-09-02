import { useEffect, useReducer } from 'preact/hooks';
import { state, subscribeState } from '../store/state.js';

export function useAppState(key) {
    const [, render] = useReducer(revision => revision + 1, 0);
    useEffect(() => subscribeState(render, key), [key]);
    return state[key];
}
