"use client";

import { useCallback, useRef } from "react";

/**
 * A callback ref that focuses its element (usually the step's heading, with `tabIndex={-1}`)
 * when it attaches for a new `key`. Used by multi-step flows: without it, focus stays on the
 * button that was pressed and screen-reader users aren't told the question changed (M19 F-04).
 *
 * It is a callback ref, not an effect, on purpose: with exit animations (AnimatePresence
 * `mode="wait"`) the new step's heading mounts only after the old one has gone, and an effect
 * would focus the old heading just before it is removed, dropping focus to the page.
 * The first render is left alone, so a page load never steals focus.
 */
export function useFocusOnChange<T extends HTMLElement>(key: unknown) {
  const focusedFor = useRef(key);
  return useCallback(
    (element: T | null) => {
      if (!element || Object.is(focusedFor.current, key)) return;
      focusedFor.current = key;
      element.focus();
    },
    [key],
  );
}
