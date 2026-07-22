// ────────────────────────────────────────────────────────────────────
// Canonical stage-label IDs (shared client + server)
//
// Stages in this system are LABELS, not folders. This is the authoritative
// list of top-level stage labels: Inbox + the 1..7 pipeline + Completed Orders.
// It matches the set used by the dual-stage detection sweep and by the
// server-side single-stage enforcement in folder-labels.ts.
//
// Brand/account labels (Vita Organica, Operations, …) are top-level but NOT in
// this set, so they co-exist. Nested labels (parent_label_id set) co-exist with
// their parent stage and are stripped when that parent stage is removed.
//
// No server-only imports here, so this module is safe to import from client
// components (e.g. the LabelPicker) as well as server routes/libs.
//
// If a stage is added/renamed, update this list.
// ────────────────────────────────────────────────────────────────────

export const STAGE_LABEL_IDS: string[] = [
  "f2fb0c7d-eb1d-4041-ad18-e5bd71e9a491", // Inbox
  "c7121538-123d-4d22-9f73-3242a2e1ecc1", // 1 - Inquiries
  "20a6812d-8e2f-4359-9574-75c92b951834", // 2 - Quotes
  "a5495c0e-e503-40a6-8f74-00313e23ba2e", // 3 - Purchase Orders
  "8fb95d1c-2901-4a8a-916d-8aa56ad88c93", // 4 - Order Confirmation
  "f66a73cb-8c7f-45df-82f0-e4550c3aba46", // 5 - Shipment Tracking
  "68454d69-e381-44a0-b725-65e573f661c2", // 6 - Cancellations and Disputes
  "73981bd2-d086-4c2a-8de2-168f8a53a35b", // 7 - Escalations
  "e7cda318-248a-475b-91da-070c3074e142", // Completed Orders
];

export function isStageLabelId(labelId: string): boolean {
  return STAGE_LABEL_IDS.includes(labelId);
}
