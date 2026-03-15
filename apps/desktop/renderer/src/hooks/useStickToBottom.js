import { useEffect, useLayoutEffect, useRef } from "react";

export function useStickToBottom(deps) {
  const ref = useRef(null);
  const shouldStickRef = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    const updateStickiness = () => {
      shouldStickRef.current =
        element.scrollHeight - element.scrollTop <= element.clientHeight + 18;
    };

    updateStickiness();
    element.addEventListener("scroll", updateStickiness, { passive: true });

    return () => {
      element.removeEventListener("scroll", updateStickiness);
    };
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    if (shouldStickRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, deps);

  return ref;
}
