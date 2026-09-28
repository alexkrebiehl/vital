// ── /medications ────────────────────────────────────────
//
// Recorded medication doses from the owner's Health Auto Export history: the
// doses attributable to today, a per-medication history over the window, and the
// window the data actually covers. The page reads its data from
// `/api/medications` in the browser, so a direct load and a refresh both render
// it — there is no client-side-only navigation involved.

import { MedicationsPage } from '@/components/domain/MedicationsPage';

export const metadata = {
  title: 'Medications — Vital',
};

export default function Page() {
  return <MedicationsPage />;
}
