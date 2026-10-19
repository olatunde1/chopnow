/**
 * ChopNow design tokens. Deep orange primary, warm cream surfaces, charcoal text.
 * Every text/background pair used meets WCAG AA (≥4.5:1) for body text (computed):
 *   text/cream 16.4 · textMuted/cream 6.8 · textMuted/surfaceMuted 6.3 · white/primary 5.2 · primary/cream 4.9
 *   primaryDark/primarySoft 6.4 · success 4.6 · warning 4.5 · danger 5.3 · info 5.5 (each on its *Soft background)
 */
export const colors = {
  primary: '#C2410C', // deep orange (orange-700)
  primaryDark: '#9A3412',
  primarySoft: '#FFEDD5',
  cream: '#FFF8EF',
  surface: '#FFFFFF',
  surfaceMuted: '#F6EFE6',
  border: '#E8DDD0',
  text: '#1F1A17', // charcoal
  textMuted: '#5F5650',
  textInverse: '#FFFFFF',
  success: '#15803D',
  successSoft: '#DCFCE7',
  warning: '#B45309',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  overlay: 'rgba(31, 26, 23, 0.45)',
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 };

export const typography = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '800' },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 15, lineHeight: 21, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 16, fontWeight: '600' },
};

/** Minimum touch target (Apple HIG 44pt / Material 48dp). */
export const touchTarget = 48;

export const shadow = {
  card: {
    shadowColor: '#3B2A1A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
};
