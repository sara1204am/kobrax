import type { AccountRequestInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAccount } from '../get-account';
import { PlanRequest } from '../plan-request';
import { PlanCard } from '../plan-card';

/** Qué plan tiene la cuenta y cuánto lleva usado. */
export default async function CuentaPlanPage() {
  const { body } = await getAccount();
  if (!body.data) return null;
  const requests = await apiCall<AccountRequestInfo[]>('/accounts/me/requests', { method: 'GET', auth: true });
  return (
    <>
      <PlanCard account={body.data} />
      <PlanRequest account={body.data} requests={requests.body.data ?? []} />
    </>
  );
}
