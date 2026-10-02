import { EventCategory, ThemeType } from '../types';

export const Colors = {
  light: {
    background: '#F8F9FA',
    surface: '#FFFFFF',
    surfaceSubtle: '#F1F3F5',
    surfaceHighlight: '#E9ECEF',
    text: '#1A1D20',
    textSecondary: '#6C757D',
    textMuted: '#ADB5BD',
    primary: '#059669', // Emerald/Mint elegante com alto contraste
    primaryDark: '#047857',
    primaryLight: '#D1FAE5',
    border: '#E2E8F0',
    borderSubtle: '#F1F5F9',
    borderHighlight: '#CBD5E1',
    danger: '#EF4444',
    dangerLight: '#FEE2E2',
    dangerDark: '#B91C1C',
    warning: '#F59E0B',
    warningLight: '#FEF3C7',
    warningDark: '#B45309',
    success: '#10B981',
    successLight: '#D1FAE5',
    successDark: '#047857',
    info: '#3B82F6',
    card: '#FFFFFF',
    shadow: 'rgba(0, 0, 0, 0.06)',
    // Apple HIG Semantic Tokens
    systemBackground: '#F2F2F7',
    secondarySystemBackground: '#FFFFFF',
    tertiarySystemBackground: '#E5E5EA',
    glassBackground: 'rgba(255, 255, 255, 0.92)',
    specularBorder: 'rgba(0, 0, 0, 0.08)',
    hairlineBorder: 'rgba(0, 0, 0, 0.06)',
    frostedCard: 'rgba(255, 255, 255, 0.85)',
    obsidianBackground: '#F8F9FA',
    midnightBackground: '#F1F3F5',
  },
  dark: {
    background: '#0F1115',
    surface: '#181B20',
    surfaceSubtle: '#1F232B',
    surfaceHighlight: '#292E38',
    text: '#F4F4F6',
    textSecondary: '#94A3B8',
    textMuted: '#64748B',
    primary: '#00FFAA', // Vibrant Mint Green
    primaryDark: '#00DFA2',
    primaryLight: 'rgba(0, 255, 170, 0.12)',
    border: '#2A303C',
    borderSubtle: '#1E232D',
    borderHighlight: '#3E4756',
    danger: '#F87171',
    dangerLight: 'rgba(239, 68, 68, 0.15)',
    dangerDark: '#F87171',
    warning: '#FBBF24',
    warningLight: 'rgba(245, 158, 11, 0.15)',
    warningDark: '#FBBF24',
    success: '#34D399',
    successLight: 'rgba(16, 185, 129, 0.15)',
    successDark: '#34D399',
    info: '#60A5FA',
    card: '#181B20',
    shadow: 'rgba(0, 0, 0, 0.4)',
    // Apple HIG Semantic Tokens & Midnight Obsidian
    systemBackground: '#000000',
    secondarySystemBackground: '#1C1C1E',
    tertiarySystemBackground: '#2C2C2E',
    glassBackground: 'rgba(15, 17, 25, 0.85)',
    specularBorder: 'rgba(255, 255, 255, 0.08)',
    hairlineBorder: 'rgba(255, 255, 255, 0.08)',
    frostedCard: 'rgba(22, 27, 38, 0.75)',
    obsidianBackground: '#090C15',
    midnightBackground: '#0B0F19',
  },
  amoled: {
    background: '#000000',
    surface: '#0A0C0E',
    surfaceSubtle: '#121519',
    surfaceHighlight: '#1A1E24',
    text: '#FFFFFF',
    textSecondary: '#8B95A5',
    textMuted: '#525B6A',
    primary: '#00FFAA', // Neon Mint Green
    primaryDark: '#00DFA2',
    primaryLight: 'rgba(0, 255, 170, 0.15)',
    border: '#1E2229',
    borderSubtle: '#14171C',
    borderHighlight: '#2C323D',
    danger: '#F87171',
    dangerLight: 'rgba(239, 68, 68, 0.18)',
    dangerDark: '#F87171',
    warning: '#FBBF24',
    warningLight: 'rgba(245, 158, 11, 0.18)',
    warningDark: '#FBBF24',
    success: '#34D399',
    successLight: 'rgba(16, 185, 129, 0.18)',
    successDark: '#34D399',
    info: '#60A5FA',
    card: '#0A0C0E',
    shadow: 'rgba(0, 0, 0, 0.6)',
    // Apple HIG Semantic Tokens & Midnight Obsidian
    systemBackground: '#000000',
    secondarySystemBackground: '#0B0D10',
    tertiarySystemBackground: '#16191E',
    glassBackground: 'rgba(0, 0, 0, 0.90)',
    specularBorder: 'rgba(255, 255, 255, 0.08)',
    hairlineBorder: 'rgba(255, 255, 255, 0.08)',
    frostedCard: '#000000',
    obsidianBackground: '#000000',
    midnightBackground: '#000000',
  }
};

/**
 * Midnight Obsidian Tokens - Apple HIG & Impeccable Design Standard
 */
export const MidnightObsidian = {
  background: '#090C15',
  midnightBackground: '#0B0F19',
  cardDark: 'rgba(22, 27, 38, 0.75)',
  cardAmoled: '#000000',
  specularBorder: 'rgba(255, 255, 255, 0.08)',
  hairlineBorder: 'rgba(255, 255, 255, 0.08)',
  radius: {
    squircleSmall: 16,
    squircle: 20,
    squircleLarge: 22,
  },
};

export const AppleTokens = {
  typography: {
    largeTitle: { fontSize: 34, fontWeight: '700' as const, letterSpacing: 0.37 },
    title1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: 0.36 },
    title2: { fontSize: 22, fontWeight: '700' as const, letterSpacing: 0.35 },
    title3: { fontSize: 20, fontWeight: '600' as const, letterSpacing: 0.38 },
    headline: { fontSize: 17, fontWeight: '600' as const, letterSpacing: -0.41 },
    body: { fontSize: 17, fontWeight: '400' as const, letterSpacing: -0.41 },
    callout: { fontSize: 16, fontWeight: '400' as const, letterSpacing: -0.32 },
    subhead: { fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.24 },
    footnote: { fontSize: 13, fontWeight: '400' as const, letterSpacing: -0.08 },
    caption1: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0 },
    caption2: { fontSize: 11, fontWeight: '400' as const, letterSpacing: 0.07 },
  },
  radius: {
    card: 20,
    squircle: 20,
    squircleSmall: 16,
    squircleLarge: 22,
    cardInner: 14,
    pill: 999,
    button: 12,
    small: 8,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 20,
    xl: 24,
    xxl: 32,
  },
};

export const CategoryColors: Record<EventCategory, string> = {
  'Saúde/Academia': '#00FFAA', // Mint Green
  'Faculdade/Aulas': '#3B82F6', // Modern Blue
  'Provas/Trabalhos': '#F43F5E', // Rose/Red
  'Lazer': '#F59E0B', // Amber
  'Outros': '#A855F7', // Violet
};

/**
 * Retorna a cor de categoria adaptada ao tema para garantir contraste adequado (ex: WCAG AA no tema light)
 */
export function getCategoryColor(category: string, theme: ThemeType = 'dark'): string {
  if (category === 'Saúde/Academia') {
    return theme === 'light' ? '#059669' : '#00FFAA';
  }
  return CategoryColors[category as EventCategory] || (theme === 'light' ? '#059669' : '#00FFAA');
}

export type ColorPalette = typeof Colors.light;

export const getThemeColors = (theme: ThemeType = 'dark'): ColorPalette => (Colors[theme] || Colors.dark) as ColorPalette;

/**
 * Retorna cor de texto de alto contraste (#0A0A0A ou #FFFFFF) com base na cor de fundo
 */
export function getContrastTextColor(hexOrHslOrRgb: string | undefined): string {
  if (!hexOrHslOrRgb) return '#000000';

  const color = hexOrHslOrRgb.trim();

  // HSL string handling (e.g. hsl(120, 75%, 60%))
  if (color.startsWith('hsl')) {
    const match = color.match(/hsl\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/);
    if (match) {
      const lightness = parseInt(match[3], 10);
      return lightness > 55 ? '#0A0A0A' : '#FFFFFF';
    }
    return '#0A0A0A';
  }

  // RGB/RGBA string handling (e.g. rgb(255, 255, 255) or rgba(0, 255, 170, 0.5))
  if (color.startsWith('rgb')) {
    const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      const yiq = (r * 299 + g * 587 + b * 114) / 1000;
      return yiq >= 140 ? '#0A0A0A' : '#FFFFFF';
    }
    return '#0A0A0A';
  }

  // Hex color handling (#RRGGBB, #RGB, #RRGGBBAA, #RGBA)
  let hex = color.replace(/^#/, '');
  if (hex.length === 3 || hex.length === 4) {
    hex = hex.substring(0, 3).split('').map(c => c + c).join('');
  } else if (hex.length === 8) {
    hex = hex.substring(0, 6);
  }
  if (hex.length === 6 && /^[0-9a-fA-F]{6}$/.test(hex)) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) {
      return '#000000';
    }
    // Relative luminance calculation
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 140 ? '#0A0A0A' : '#FFFFFF';
  }

  return '#000000';
}


