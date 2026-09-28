import { useWindowDimensions } from 'react-native';

export interface ResponsiveInfo {
  width: number;
  height: number;
  isDesktop: boolean; // Width > 1024px: triggers sidebar & desktop layouts
  isTablet: boolean;  // Width 768px - 1024px
  isPhone: boolean;   // Width < 768px
  columns: number;    // Multi-column layout helper
}

/**
 * Hook to provide reactive screen breakpoint information for responsive desktop,
 * tablet, and mobile views.
 */
export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions();
  const isDesktop = width > 1024;
  const isTablet = width >= 768 && width <= 1024;
  const isPhone = width < 768;

  return {
    width,
    height,
    isDesktop,
    isTablet,
    isPhone,
    columns: isDesktop || isTablet ? 2 : 1,
  };
}
