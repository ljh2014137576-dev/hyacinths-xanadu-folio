import type { RelocationMatch } from './index.js';
import type { FunctionFragment } from '../model/index.js';

export const relocateFunctionFragments = (
  previous: readonly FunctionFragment[],
  current: readonly FunctionFragment[],
): readonly RelocationMatch[] => previous.map((oldFragment) => {
  const exact = current.find((candidate) => candidate.id === oldFragment.id);
  if (exact !== undefined) return { status: 'matched', previousId: oldFragment.id, currentId: exact.id, certainty: 'exact', evidence: ['stable identity recipe matched'] };
  const sameQualifiedSignature = current.filter((candidate) =>
    candidate.qualifiedName === oldFragment.qualifiedName && candidate.symbolKind === oldFragment.symbolKind &&
    candidate.identity.signatureHash === oldFragment.identity.signatureHash);
  if (sameQualifiedSignature.length === 1 && sameQualifiedSignature[0] !== undefined) {
    return { status: 'matched', previousId: oldFragment.id, currentId: sameQualifiedSignature[0].id, certainty: 'probable', evidence: ['qualified name and signature matched after declaration change'] };
  }
  const fingerprintCandidates = current.filter((candidate) =>
    candidate.symbolKind === oldFragment.symbolKind && candidate.identity.signatureHash === oldFragment.identity.signatureHash &&
    candidate.identity.declarationFingerprint === oldFragment.identity.declarationFingerprint);
  if (fingerprintCandidates.length === 1 && fingerprintCandidates[0] !== undefined) {
    return { status: 'matched', previousId: oldFragment.id, currentId: fingerprintCandidates[0].id, certainty: 'probable', evidence: ['signature and declaration fingerprint matched after move or rename'] };
  }
  const ambiguous = [...new Set([...sameQualifiedSignature, ...fingerprintCandidates].map((candidate) => candidate.id))];
  return ambiguous.length > 0
    ? { status: 'ambiguous', previousId: oldFragment.id, candidates: ambiguous, evidence: ['multiple signature and declaration fingerprint candidates'] }
    : { status: 'missing', previousId: oldFragment.id, evidence: ['no stable ID, qualified signature, or declaration fingerprint candidate'] };
});
