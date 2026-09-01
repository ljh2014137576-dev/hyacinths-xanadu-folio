import type { RelocationMatch } from './index.js';
import type { FunctionFragment, RelationBridge } from '../model/index.js';

const nonEmpty = (value: string | undefined): value is string => value !== undefined && value.length > 0;

const semanticKey = (fragment: FunctionFragment): string | undefined => {
  const { lexicalParentFingerprint, containerSemanticFingerprint } = fragment.identity;
  if (!nonEmpty(lexicalParentFingerprint) || !nonEmpty(containerSemanticFingerprint)) return undefined;
  return [
    fragment.provenance.projectRelativePath,
    lexicalParentFingerprint,
    containerSemanticFingerprint,
    fragment.symbolKind,
    fragment.identity.signatureHash,
    fragment.identity.declarationFingerprint,
  ].join('|');
};

const semanticContainerSignatureKey = (fragment: FunctionFragment): string | undefined => {
  const { lexicalParentFingerprint, containerSemanticFingerprint } = fragment.identity;
  if (!nonEmpty(lexicalParentFingerprint) || !nonEmpty(containerSemanticFingerprint)) return undefined;
  return [
    fragment.provenance.projectRelativePath,
    lexicalParentFingerprint,
    containerSemanticFingerprint,
    fragment.symbolKind,
    fragment.identity.signatureHash,
  ].join('|');
};

const hasConflictingContainerSemantics = (left: FunctionFragment, right: FunctionFragment): boolean => {
  const leftFingerprint = left.identity.containerSemanticFingerprint;
  const rightFingerprint = right.identity.containerSemanticFingerprint;
  return nonEmpty(leftFingerprint) && nonEmpty(rightFingerprint) && leftFingerprint !== rightFingerprint;
};

const candidateIds = (fragments: readonly FunctionFragment[]): readonly FunctionFragment['id'][] =>
  [...new Set(fragments.map((fragment) => fragment.id))].sort((left, right) => left.localeCompare(right));

export const relocateFunctionFragments = (
  previous: readonly FunctionFragment[],
  current: readonly FunctionFragment[],
): readonly RelocationMatch[] => previous.map((oldFragment) => {
  const oldSemanticKey = semanticKey(oldFragment);
  if (oldSemanticKey !== undefined) {
    const previousClass = previous.filter((candidate) => semanticKey(candidate) === oldSemanticKey);
    const currentClass = current.filter((candidate) => semanticKey(candidate) === oldSemanticKey);
    const exact = currentClass.find((candidate) => candidate.id === oldFragment.id);
    if (previousClass.length === 1 && currentClass.length === 1 && currentClass[0] !== undefined) {
      const match = currentClass[0];
      return match.id === oldFragment.id
        ? { status: 'matched', previousId: oldFragment.id, currentId: match.id, certainty: 'exact', evidence: ['unique semantic identity and stable ID matched'] }
        : { status: 'matched', previousId: oldFragment.id, currentId: match.id, certainty: 'probable', evidence: ['unique ordinal-independent semantic identity matched after structural movement'] };
    }
    if (currentClass.length > 0) {
      if (exact !== undefined && exact.provenance.revision === oldFragment.provenance.revision) {
        return { status: 'matched', previousId: oldFragment.id, currentId: exact.id, certainty: 'exact', evidence: ['unchanged revision retained a duplicate semantic identity ID'] };
      }
      return { status: 'ambiguous', previousId: oldFragment.id, candidates: candidateIds(currentClass), evidence: ['semantic equivalence class contains indistinguishable declarations'] };
    }
  }

  const oldContainerSignatureKey = semanticContainerSignatureKey(oldFragment);
  if (oldContainerSignatureKey !== undefined) {
    const previousClass = previous.filter((candidate) => semanticContainerSignatureKey(candidate) === oldContainerSignatureKey);
    const currentClass = current.filter((candidate) => semanticContainerSignatureKey(candidate) === oldContainerSignatureKey);
    if (previousClass.length === 1 && currentClass.length === 1 && currentClass[0] !== undefined) {
      return { status: 'matched', previousId: oldFragment.id, currentId: currentClass[0].id, certainty: 'probable', evidence: ['unique semantic container and signature matched after declaration change'] };
    }
    if (currentClass.length > 0) {
      return { status: 'ambiguous', previousId: oldFragment.id, candidates: candidateIds(currentClass), evidence: ['semantic container and signature class contains indistinguishable declarations'] };
    }
  }

  const sameQualifiedSignature = (oldFragment.identity.recipeVersion === 1
    ? current.filter((candidate) => candidate.qualifiedName === oldFragment.qualifiedName && candidate.symbolKind === oldFragment.symbolKind && candidate.identity.signatureHash === oldFragment.identity.signatureHash)
    : current.filter((candidate) => candidate.provenance.projectRelativePath === oldFragment.provenance.projectRelativePath && candidate.identity.lexicalFingerprint === oldFragment.identity.lexicalFingerprint && candidate.identity.containerFingerprint === oldFragment.identity.containerFingerprint && candidate.symbolKind === oldFragment.symbolKind && candidate.identity.signatureHash === oldFragment.identity.signatureHash))
    .filter((candidate) => !hasConflictingContainerSemantics(oldFragment, candidate));
  if (sameQualifiedSignature.length === 1 && sameQualifiedSignature[0] !== undefined) {
    return { status: 'matched', previousId: oldFragment.id, currentId: sameQualifiedSignature[0].id, certainty: 'probable', evidence: ['qualified name and signature matched after declaration change'] };
  }
  const fingerprintCandidates = current.filter((candidate) =>
    candidate.symbolKind === oldFragment.symbolKind && candidate.identity.signatureHash === oldFragment.identity.signatureHash &&
    candidate.identity.declarationFingerprint === oldFragment.identity.declarationFingerprint &&
    !hasConflictingContainerSemantics(oldFragment, candidate));
  if (fingerprintCandidates.length === 1 && fingerprintCandidates[0] !== undefined) {
    return { status: 'matched', previousId: oldFragment.id, currentId: fingerprintCandidates[0].id, certainty: 'probable', evidence: ['signature and declaration fingerprint matched after move or rename'] };
  }
  const ambiguous = candidateIds([...sameQualifiedSignature, ...fingerprintCandidates]);
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
    let fingerprintCandidates = current.filter((candidate) => {
      if (candidate.sourceFragmentId !== expectedSource && candidate.sourceFragmentId !== oldRelation.sourceFragmentId) return false;
      if (candidate.kind !== oldRelation.kind) return false;
      if (oldIdentity !== undefined) {
        return candidate.identity.callFingerprint === oldIdentity.callFingerprint;
      }
      const currentCallText = currentContents[candidate.callSite.sourceFileId]?.slice(candidate.callSite.range.start, candidate.callSite.range.end);
      return oldCallText !== undefined && currentCallText === oldCallText;
    });
    if (fingerprintCandidates.length === 0 && oldIdentity !== undefined) {
      const broad = current.filter((candidate) => candidate.kind === oldRelation.kind && candidate.identity.callFingerprint === oldIdentity.callFingerprint);
      if (broad.length === 1) fingerprintCandidates = broad;
    }
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
