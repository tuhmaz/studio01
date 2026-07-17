import { Redirect } from 'expo-router';
import { useAuth } from '@/context/AuthContext';

/**
 * Root route ("/"). Without it, a production build opened at `hausmeister:///`
 * has no matching screen and shows the "Unmatched Route" page. Redirect to the
 * app or the login screen based on session state. The root layout renders a
 * loading gate until auth is resolved, so `loading` is already false here.
 */
export default function Index() {
  const { user } = useAuth();
  return <Redirect href={user ? '/(tabs)/home' : '/login'} />;
}
