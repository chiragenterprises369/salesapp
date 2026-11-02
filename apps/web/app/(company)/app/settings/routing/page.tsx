import { redirect } from 'next/navigation';

/** Lead routing moved to /app/settings/lead-routing (change #19 wave B). */
export default function RoutingSettingsRedirect() {
  redirect('/app/settings/lead-routing');
}
