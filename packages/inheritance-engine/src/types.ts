import type { Fraction } from './fraction.ts';

export type Gender = 'M' | 'F';
export type LawSystem =
  | 'sunni-hanafi' | 'sunni-shafii' | 'sunni-maliki' | 'sunni-hanbali'
  | 'shia-ithna' | 'christian' | 'parsi'
  | 'hindu-mitakshara-benares' | 'hindu-mitakshara-bombay' | 'other';

export interface PersonFlags {
  /** Divorce status at the date of death (wife of the deceased, or the deceased's husband). */
  divorced?: 'revocable-in-iddat' | 'irrevocable' | 'khula';
  pregnant?: boolean;
  missing?: boolean;
  minor?: boolean;
  adopted?: boolean;
  illegitimate?: boolean;
  killedDeceased?: 'intentional' | 'negligent';
}

export interface Person {
  id: string;
  name: string;
  fatherName?: string;
  gender: Gender;
  /** false = died; with dateOfDeath AFTER the deceased the person still inherits (munasakha). */
  alive: boolean;
  /** ISO date (YYYY-MM-DD). */
  dateOfDeath?: string;
  religion: string;
  flags: PersonFlags;
  cnic?: string;
}

export interface Union { id: string; partners: [string, string]; type: 'marriage' | 'divorced' | 'khula'; order?: number }
export interface ParentLink { childId: string; fatherId?: string; motherId?: string }

export interface Area { unit: string; value: Fraction }
export interface Estate {
  immovable: { title: string; area: Area; khewat?: string; mauza?: string }[];
  movableValue?: Fraction;
  debts: Fraction;
  funeral: Fraction;
  dower: Fraction;
  wills: { beneficiaryId?: string; external?: string; fraction?: Fraction; amount?: Fraction }[];
}

export interface PolicyToggles {
  raddToSpouseWhenNoOtherHeir: boolean;
  grandfatherExcludesSiblings: boolean;
  shiaChildlessWidowLandRule: 'classical' | 'equal';
  applyMFLOs4: boolean;
  hinduDaughterOrder: 'benares' | 'bombay';
  /** Hindu: separate (self-acquired) property or coparcenary (joint family) interest. */
  hinduProperty?: 'separate' | 'coparcenary';
  policyVersion: string;
}

export interface Case {
  id: string;
  lawSystem: LawSystem;
  deceasedId: string;
  /** ISO date (YYYY-MM-DD). */
  dateOfDeath: string;
  province: string;
  persons: Person[];
  unions: Union[];
  parents: ParentLink[];
  estate: Estate;
  policy: PolicyToggles;
  parentCaseId?: string;
  /** Munasakha: the heir (person id in the parent case) whose share this sub-case distributes. */
  parentHeirId?: string;
}

export interface ExplainEntry { ruleId: string; i18nKey: string; params?: Record<string, string>; citationKey: string }

export type ShareStatus = 'heir' | 'excluded' | 'reserved' | 'substituted-s4';

export interface ShareResult {
  personId: string;
  relationKey: string;
  fraction: Fraction;
  sihaam: bigint;
  base: bigint;
  percent: string;
  area?: Area[];
  /** Per property: whole square feet after rounding so the heirs' feet add up to the property exactly. */
  areaSqftRounded?: (bigint | null)[];
  status: ShareStatus;
  reasons: ExplainEntry[];
}

export interface ComputeResult {
  caseId: string;
  lawSystem: LawSystem;
  policyVersion: string;
  base: bigint;
  shares: ShareResult[];
  /** Share not given to anyone yet (pregnancy / missing heir). */
  reserved: Fraction;
  /** Share going to the State / Baitul-Mal (no heir). */
  escheat: Fraction;
  /** Case-level notes (aul, radd, will clipping, warnings). */
  notes: ExplainEntry[];
  /** True when a rule marked "complex — verify" was used (distant kindred, grandfather with siblings). */
  needsVerification: boolean;
}

export const DEFAULT_POLICY: PolicyToggles = {
  raddToSpouseWhenNoOtherHeir: true,
  grandfatherExcludesSiblings: true,
  shiaChildlessWidowLandRule: 'classical',
  applyMFLOs4: true,
  hinduDaughterOrder: 'benares',
  policyVersion: '2026.10-draft',
};
