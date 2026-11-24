'use client';

import { useEffect } from 'react';

/**
 * Clicking or tabbing into a number field selects what is in it, so typing 10 into a field that
 * shows 0 gives 10, not 010. One listener for the whole app.
 */
export function InputHelpers() {
  useEffect(() => {
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement && el.type === 'number') {
        // After the browser places the caret, so the selection sticks on click too.
        requestAnimationFrame(() => el.select());
      }
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  return null;
}
