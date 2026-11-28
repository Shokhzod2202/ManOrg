'use client';

import { EmployeeDays } from '../../../components/output/employee-days';
import { Loading, PageHead } from '../../../components/ui';
import { t } from '../../../lib/i18n';
import { useSession } from '../../../lib/session';

/**
 * Decided 2026-11-28: each employee's own output history (More → Output history): every day of
 * a month, newest first, with what they made and that day's numbers; searchable by product, and
 * the month before is one tap at the bottom.
 */
export default function OutputHistoryPage() {
  const { me } = useSession();
  return (
    <div className="page">
      <PageHead title={t('Output history')} />
      {me ? <EmployeeDays employeeId={me.id} title={t('My output')} /> : <Loading />}
    </div>
  );
}
