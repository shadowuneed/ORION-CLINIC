/** Read-only projection of the immutable DB protocol, never a live editor draft. */
export type ProtocolPreview = {
  id: string;
  version: number;
  status: 'draft' | 'signed';
  sourceHash: string;
  patient: { displayName: string; medicalRecordNumber: string };
  sections: Array<{ code: string; content: string; reviewState: string }>;
  recommendations: Array<{ title: string; content: string }>;
  amendments: Array<{ id: string; text: string; reason: string }>;
};
