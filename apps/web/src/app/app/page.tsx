'use client';

import { AdminToday } from '../../components/home/admin-today';
import { ContractorOrders } from '../../components/home/contractor-orders';
import { EmployeeHome } from '../../components/home/employee-home';
import { useSession } from '../../lib/session';

export default function Home() {
  const { actor } = useSession();
  if (actor === 'org_admin') return <AdminToday />;
  if (actor === 'contractor_admin') return <ContractorOrders />;
  return <EmployeeHome />;
}
