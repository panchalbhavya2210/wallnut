import { Redirect } from 'expo-router';

/** Deep-link target for widgets (`wallnut://home`). */
export default function HomeDeepLink() {
  return <Redirect href="/" />;
}
