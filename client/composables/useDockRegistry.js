import { reactive } from 'vue';

const leftItems = reactive([]);
const rightItems = reactive([]);

export function useDockRegistry() {
  function registerLeft(item) {
    const idx = leftItems.findIndex((i) => i.id === item.id);
    if (idx >= 0) leftItems.splice(idx, 1, item);
    else leftItems.push(item);
  }

  function registerRight(item) {
    const idx = rightItems.findIndex((i) => i.id === item.id);
    if (idx >= 0) rightItems.splice(idx, 1, item);
    else rightItems.push(item);
  }

  function unregisterLeft(id) {
    const idx = leftItems.findIndex((item) => item.id === id);
    if (idx >= 0) leftItems.splice(idx, 1);
  }

  function unregisterRight(id) {
    const idx = rightItems.findIndex((item) => item.id === id);
    if (idx >= 0) rightItems.splice(idx, 1);
  }

  function clear() {
    leftItems.length = 0;
    rightItems.length = 0;
  }

  return {
    leftItems,
    rightItems,
    registerLeft,
    registerRight,
    unregisterLeft,
    unregisterRight,
    clear,
  };
}
