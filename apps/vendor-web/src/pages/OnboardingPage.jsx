import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { RestaurantForm } from '../components/RestaurantForm';
import { Button, Card, PageHeader, useToast } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { useSession } from '../state/session';

/** First step for a new vendor (or adding another restaurant): submit the restaurant for approval. */
export function OnboardingPage({ embedded = false }) {
  const { signOut, setRestaurantId, user } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [serverErrors, setServerErrors] = useState({});

  const submit = async (input) => {
    try {
      const r = await api.restaurants.create(input);
      setRestaurantId(r.id);
      await queryClient.invalidateQueries({ queryKey: ['restaurants'] });
      toast.show('Restaurant submitted. Next: opening hours, documents and menu.', 'success');
      navigate('/restaurant');
    } catch (err) {
      if (err instanceof ApiError) {
        setServerErrors(err.fieldErrors());
        toast.show(err.message, 'danger');
      } else throw err;
    }
  };

  const content = (
    <>
      <PageHeader
        title="Add your restaurant"
        description="We review every restaurant before it appears to customers. Approval needs your location and opening hours; adding your documents and menu speeds it up."
        actions={
          embedded ? null : (
            <Button variant="outline" icon={LogOut} onClick={signOut}>
              Sign out
            </Button>
          )
        }
      />
      <Card>
        <RestaurantForm onSubmit={submit} submitLabel="Submit for approval" serverErrors={serverErrors} />
      </Card>
    </>
  );
  if (embedded) return content;
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <p className="mb-2 text-sm text-ink-muted">Signed in as {user?.email}</p>
      {content}
    </div>
  );
}
