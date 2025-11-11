export interface DebouncedExecutor {
  trigger: () => void;
  flush: () => void;
  cancel: () => void;
}

export const createDebouncedExecutor = (
  callback: () => void | Promise<void>,
  delayMs: number,
): DebouncedExecutor => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const invoke = () => {
    timeoutId = null;
    void callback();
  };

  const trigger = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(invoke, delayMs);
  };

  const flush = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      invoke();
    }
  };

  const cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  return { trigger, flush, cancel };
};
