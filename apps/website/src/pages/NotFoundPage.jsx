import { ButtonLink, PageHero } from '../components/ui';

export function NotFoundPage() {
  return (
    <PageHero eyebrow="404" title="This page has gone for a quick chop" actions={<ButtonLink to="/">Back to home</ButtonLink>}>
      We couldn’t find what you were looking for.
    </PageHero>
  );
}
