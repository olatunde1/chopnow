/**
 * Dynamic config on top of app.json. Refuses preview/production builds whose API address isn't
 * https: without it the app would fall back to a development address and fail for every user.
 * EXPO_PUBLIC_API_BASE_URL comes from the EAS environment of the profile (see docs/DEPLOYMENT.md).
 */
module.exports = ({ config }) => {
  const profile = process.env.EAS_BUILD_PROFILE;
  if (profile && profile !== 'development') {
    const url = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
    if (!/^https:\/\/[^/]+/.test(url)) {
      throw new Error(`EXPO_PUBLIC_API_BASE_URL must be an https:// URL for the "${profile}" build (got "${url || 'nothing'}").`);
    }
  }
  return config;
};
