/**
 * ChopNow design tokens. Deep teal actions (#046485), warm off-white background (#F6F2E9),
 * dark green-teal text (#103C38).
 * Every text/background pair used meets WCAG AA (≥4.5:1) for body text (computed):
 *   text/cream 10.9 · text/surface 12.2 · textMuted/cream 5.9 · textMuted/surfaceMuted 5.3
 *   white/primary 6.6 · primary/cream 5.9 · primaryDark/primarySoft 8.1
 *   success 5.2 · warning 5.4 · danger 5.8 · info 6.0 on cream (and ≥4.6 on surfaceMuted)
 */
export const colors = {
  primary: '#046485', // deep teal: buttons and actions
  primaryDark: '#034A63',
  primarySoft: '#DCEEF3',
  cream: '#F6F2E9', // app background
  surface: '#FFFFFF',
  surfaceMuted: '#ECE6D9',
  border: '#DCD3C1',
  text: '#103C38', // dark green-teal
  textMuted: '#4A615E',
  textInverse: '#FFFFFF',
  success: '#137538',
  successSoft: '#DCFCE7',
  warning: '#A14A07',
  warningSoft: '#FEF3C7',
  danger: '#B91C1C',
  dangerSoft: '#FEE2E2',
  info: '#1D4ED8',
  infoSoft: '#DBEAFE',
  overlay: 'rgba(16, 60, 56, 0.45)',
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
    shadowColor: '#103C38',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
};
