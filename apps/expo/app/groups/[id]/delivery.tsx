import { Redirect, useLocalSearchParams } from 'expo-router';

/** Delivery settings have no delivery consumer yet; preserve old deep links. */
export default function GroupDeliveryCompatibilityRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/groups/[id]', params: { id } }} />;
}
