import type { RelocationMatch } from './index.js';
import type { FunctionFragment, RelationBridge } from '../model/index.js';

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

export const relocateRelationBridges = (
  previous: readonly RelationBridge[],
  current: readonly RelationBridge[],
  symbolRelocation: readonly RelocationMatch[],
  previousContents: Readonly<Record<string, string>> = {},
  currentContents: Readonly<Record<string, string>> = {},
): readonly RelocationMatch[] => {
  const symbolMap = new Map(symbolRelocation.flatMap((match) => match.status === 'matched' ? [[match.previousId, match.currentId] as const] : []));
  return previous.map((oldRelation) => {
    const exact = current.find((candidate) => candidate.id === oldRelation.id);
    if (exact !== undefined) return { status: 'matched', previousId: oldRelation.id, currentId: exact.id, certainty: 'exact', evidence: ['stable relation identity matched'] };
    const expectedSource = symbolMap.get(oldRelation.sourceFragmentId) ?? oldRelation.sourceFragmentId;
    const oldIdentity = (oldRelation as RelationBridge & { readonly identity?: RelationBridge['identity'] }).identity;
    const oldCallText = previousContents[oldRelation.callSite.sourceFileId]?.slice(oldRelation.callSite.range.start, oldRelation.callSite.range.end);
    const fingerprintCandidates = current.filter((candidate) => {
      if (candidate.sourceFragmentId !== expectedSource || candidate.kind !== oldRelation.kind) return false;
      if (oldIdentity !== undefined) {
        return candidate.identity.callFingerprint === oldIdentity.callFingerprint;
      }
      const currentCallText = currentContents[candidate.callSite.sourceFileId]?.slice(candidate.callSite.range.start, candidate.callSite.range.end);
      return oldCallText !== undefined && currentCallText === oldCallText;
    });
    const structuralCandidates = oldIdentity?.recipeVersion === 2 && oldIdentity.lexicalPath !== undefined
      ? fingerprintCandidates.filter((candidate) => candidate.identity.recipeVersion === 2 && candidate.identity.lexicalPath === oldIdentity.lexicalPath)
      : fingerprintCandidates;
    const candidates = oldIdentity?.recipeVersion === 2 && fingerprintCandidates.length > 1
      ? fingerprintCandidates
      : structuralCandidates.length > 0 ? structuralCandidates : fingerprintCandidates;
    if (candidates.length === 1 && candidates[0] !== undefined) {
      return { status: 'matched', previousId: oldRelation.id, currentId: candidates[0].id, certainty: 'probable', evidence: ['migrated source, kind, full call fingerprint, and lexical path matched'] };
    }
    if (candidates.length > 1) {
      return { status: 'ambiguous', previousId: oldRelation.id, candidates: candidates.map((candidate) => candidate.id), evidence: ['multiple relation fingerprint candidates'] };
    }
    return { status: 'missing', previousId: oldRelation.id, evidence: ['no relation fingerprint candidate'] };
  });
};
