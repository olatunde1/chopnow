import { router } from 'expo-router';

/** Go back if there is somewhere to go back to (e.g. a modal opened from a screen), otherwise go home. */
export function goBack(fallback = '/') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
