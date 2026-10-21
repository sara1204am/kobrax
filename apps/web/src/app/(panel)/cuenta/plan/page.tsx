import { getAccount } from '../get-account';
import { PlanCard } from '../plan-card';

/** Qué plan tiene la cuenta y cuánto lleva usado. */
export default async function CuentaPlanPage() {
  const { body } = await getAccount();
  if (!body.data) return null;
  return <PlanCard account={body.data} />;
}
