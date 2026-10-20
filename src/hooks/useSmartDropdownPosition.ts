/**
 * Hook: Smart Dropdown Positioning with Portal Support
 *
 * Automatically positions dropdown menus to avoid viewport overflow.
 * Detects available space above/below the trigger element and positions
 * the dropdown accordingly. Returns absolute coordinates for portal rendering.
 */

import { useRef, useState, useEffect, RefObject } from 'react';

interface UseSmartDropdownPositionReturn {
  containerRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  positionAbove: boolean;
  style: {
    position: 'fixed';
    top?: number;
    bottom?: number;
    left: number;
    right?: number;
    minWidth: number;
  } | null;
}

/**
 * Custom hook for smart dropdown positioning with portal support
 *
 * @param isOpen - Whether the dropdown is currently open
 * @returns Object containing refs, positioning state, and absolute coordinates for portal rendering
 *
 * @example
 * const { containerRef, dropdownRef, positionAbove, style } = useSmartDropdownPosition(isOpen);
 *
 * <div ref={containerRef}>
 *   <button>Toggle</button>
 * </div>
 * {isOpen && createPortal(
 *   <div ref={dropdownRef} style={style}>Menu items</div>,
 *   document.body
 * )}
 */
export function useSmartDropdownPosition(isOpen: boolean): UseSmartDropdownPositionReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [positionAbove, setPositionAbove] = useState(false);
  const [style, setStyle] = useState<UseSmartDropdownPositionReturn['style']>(null);

  useEffect(() => {
    if (!isOpen) {
      setStyle(null);
      return;
    }

    const calculatePosition = () => {
      if (!containerRef.current) {
        return;
      }

      const buttonRect = containerRef.current.getBoundingClientRect();

      // Get dropdown dimensions if available, otherwise estimate
      const dropdownHeight = dropdownRef.current
        ? dropdownRef.current.getBoundingClientRect().height
        : 300; // Reasonable default estimate

      const dropdownWidth = dropdownRef.current
        ? dropdownRef.current.getBoundingClientRect().width
        : 224; // Default width estimate (w-56)

      // Calculate available space (with 16px buffer from viewport edges)
      const spaceBelow = window.innerHeight - buttonRect.bottom - 16;
      const spaceAbove = buttonRect.top - 16;

      // Position above if not enough space below
      const shouldPositionAbove = spaceBelow < dropdownHeight && spaceAbove >= dropdownHeight;

      setPositionAbove(shouldPositionAbove);

      // Calculate absolute position for portal rendering
      // Align right edge of dropdown with right edge of button
      const newStyle: UseSmartDropdownPositionReturn['style'] = {
        position: 'fixed',
        left: Math.max(8, buttonRect.right - dropdownWidth), // Keep 8px from left edge
        minWidth: buttonRect.width,
      };

      if (shouldPositionAbove) {
        // Position above the button
        newStyle.bottom = window.innerHeight - buttonRect.top + 8; // 8px margin
      } else {
        // Position below the button
        newStyle.top = buttonRect.bottom + 8; // 8px margin
      }

      setStyle(newStyle);
    };

    // Use requestAnimationFrame for immediate measurement after render
    const rafId = requestAnimationFrame(() => {
      calculatePosition();
    });

    // Recalculate on scroll/resize (debounced)
    const debouncedCalculate = debounce(calculatePosition, 150);

    // Use capture phase for scroll to catch scrolling in any parent
    window.addEventListener('scroll', debouncedCalculate, true);
    window.addEventListener('resize', debouncedCalculate);

    return () => {
      cancelAnimationFrame(rafId);
      debouncedCalculate.cancel(); // a pending recalculation would set state after unmount
      window.removeEventListener('scroll', debouncedCalculate, true);
      window.removeEventListener('resize', debouncedCalculate);
    };
  }, [isOpen]);

  return { containerRef, dropdownRef, positionAbove, style };
}

/**
 * Debounce helper function; cancel() drops a pending call.
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): ((...args: Parameters<T>) => void) & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => {
      timeout = null;
      func(...args);
    }, wait);
  };
  debounced.cancel = () => {
    if (timeout) clearTimeout(timeout);
    timeout = null;
  };
  return debounced;
}
