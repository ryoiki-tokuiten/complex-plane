import { signal } from '@preact/signals';

export const isThemeModalOpen = signal(false);

export const openThemeModal = () => {
    isThemeModalOpen.value = true;
};

export const closeThemeModal = () => {
    isThemeModalOpen.value = false;
};
