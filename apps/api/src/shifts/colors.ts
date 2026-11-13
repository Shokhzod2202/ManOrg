/** A stable colour slot per employee for calendar dashboards (SHF-8); clients map it to a colour. */
export function employeeColorIndex(id: string, slots = 8): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % slots;
}
