import { type Api, type Session } from './app';

export interface Bakery {
  id: string;
  admin: Session;
  employee: Session & { membershipId: string };
  applicant: Session & { applicationId: string };
}

export interface World {
  a: Bakery;
  b: Bakery;
  contractor: { id: string; admin: Session; linkId: string };
  pendingContractor: { id: string; admin: Session; applicationId: string };
}

async function bakery(api: Api, label: string): Promise<Bakery> {
  const admin = await api.register(`${label} Admin`);
  const id = await api.createOrganization(admin, `${label} Bakery`);
  const employee = await api.hireEmployee(id, admin, `${label} Employee`);
  const applicantSession = await api.register(`${label} Applicant`);
  const applied = await api
    .as(applicantSession)
    .post(`/organizations/${id}/applications`)
    .expect(201);
  return {
    id,
    admin,
    employee,
    applicant: { ...applicantSession, applicationId: applied.body.id },
  };
}

/**
 * Two bakeries, each with an admin, an approved employee and a pending applicant; one contractor
 * approved by bakery A and one contractor still pending at bakery B.
 */
export async function buildWorld(api: Api): Promise<World> {
  const a = await bakery(api, 'Alpha');
  const b = await bakery(api, 'Beta');

  const contractorAdmin = await api.register('Cafe Admin');
  const contractorId = await api.createOrganization(contractorAdmin, 'Corner Cafe', 'contractor');
  const link = await api
    .as(contractorAdmin, contractorId)
    .post(`/organizations/${a.id}/applications`)
    .expect(201);
  await api.as(a.admin, a.id).post(`/applications/${link.body.id}/approve`).expect(200);

  const pendingAdmin = await api.register('Diner Admin');
  const pendingId = await api.createOrganization(pendingAdmin, 'Night Diner', 'contractor');
  const pending = await api
    .as(pendingAdmin, pendingId)
    .post(`/organizations/${b.id}/applications`)
    .expect(201);

  return {
    a,
    b,
    contractor: { id: contractorId, admin: contractorAdmin, linkId: link.body.id },
    pendingContractor: { id: pendingId, admin: pendingAdmin, applicationId: pending.body.id },
  };
}
