// Editing helpers for the case graph (immutable updates) and localStorage persistence.
import { DEFAULT_POLICY, ZERO, type Case, type Gender, type Person } from 'inheritance-engine';

export type AddKind = 'father' | 'mother' | 'spouse' | 'son' | 'daughter' | 'brother' | 'sister';

const uid = () => Math.random().toString(36).slice(2, 9);

export function newCase(): Case {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `SN-${Date.now().toString(36).toUpperCase()}`,
    lawSystem: 'sunni-hanafi',
    deceasedId: 'D',
    dateOfDeath: today,
    province: 'punjab',
    persons: [{ id: 'D', name: '', fatherName: '', gender: 'M', alive: false, dateOfDeath: today, religion: 'muslim', flags: {} }],
    unions: [],
    parents: [],
    estate: { immovable: [], debts: ZERO, funeral: ZERO, dower: ZERO, wills: [] },
    policy: { ...DEFAULT_POLICY },
  };
}

export const fatherOf = (c: Case, id: string) => c.parents.find((l) => l.childId === id)?.fatherId;
export const motherOf = (c: Case, id: string) => c.parents.find((l) => l.childId === id)?.motherId;
export const spousesOf = (c: Case, id: string) => c.unions.filter((u) => u.partners.includes(id)).map((u) => u.partners.find((p) => p !== id)!);
export const childrenOf = (c: Case, id: string) => c.parents.filter((l) => l.fatherId === id || l.motherId === id).map((l) => l.childId);

function setParent(c: Case, childId: string, role: 'fatherId' | 'motherId', parentId: string | undefined) {
  const ex = c.parents.find((l) => l.childId === childId);
  if (ex) ex[role] = parentId;
  else c.parents.push({ childId, [role]: parentId });
}

const label = (k: AddKind, of: Person) => {
  const n = of.name || 'deceased';
  return { father: `Father of ${n}`, mother: `Mother of ${n}`, spouse: `Spouse of ${n}`, son: `Son of ${n}`, daughter: `Daughter of ${n}`, brother: `Brother of ${n}`, sister: `Sister of ${n}` }[k];
};

/** Adds a relative of `id`; returns [newCase, newPersonId]. */
export function addRelative(c0: Case, id: string, kind: AddKind): [Case, string] {
  const c: Case = structuredClone(c0);
  const of = c.persons.find((p) => p.id === id)!;
  const person = (gender: Gender, alive = true): Person => ({ id: uid(), name: label(kind, of), gender, alive, religion: of.religion, flags: {} });
  if (kind === 'father' || kind === 'mother') {
    const existing = kind === 'father' ? fatherOf(c, id) : motherOf(c, id);
    if (existing) return [c, existing];
    const p = person(kind === 'father' ? 'M' : 'F');
    c.persons.push(p);
    setParent(c, id, kind === 'father' ? 'fatherId' : 'motherId', p.id);
    // Link the new parent to the other parent as spouses.
    const other = kind === 'father' ? motherOf(c, id) : fatherOf(c, id);
    if (other && !c.unions.some((u) => u.partners.includes(p.id) && u.partners.includes(other))) c.unions.push({ id: uid(), partners: [p.id, other], type: 'marriage' });
    return [c, p.id];
  }
  if (kind === 'spouse') {
    const p = person(of.gender === 'M' ? 'F' : 'M');
    p.name = of.gender === 'M' ? `Wife of ${of.name || 'deceased'}` : `Husband of ${of.name || 'deceased'}`;
    c.persons.push(p);
    c.unions.push({ id: uid(), partners: [id, p.id], type: 'marriage', order: spousesOf(c, id).length });
    return [c, p.id];
  }
  if (kind === 'son' || kind === 'daughter') {
    const p = person(kind === 'son' ? 'M' : 'F');
    c.persons.push(p);
    const sp = spousesOf(c, id);
    const other = sp.length === 1 ? sp[0] : undefined;
    if (of.gender === 'M') c.parents.push({ childId: p.id, fatherId: id, motherId: other });
    else c.parents.push({ childId: p.id, fatherId: other, motherId: id });
    return [c, p.id];
  }
  // Brother / sister: full sibling (same parents). Missing parents are added as "not alive".
  let [c2, f] = [c, fatherOf(c, id)];
  if (!f) { [c2, f] = addRelative(c2, id, 'father'); const fp = c2.persons.find((p) => p.id === f)!; fp.alive = false; }
  let m = motherOf(c2, id);
  if (!m) { let c3: Case; [c3, m] = addRelative(c2, id, 'mother'); c2 = c3; const mp = c2.persons.find((p) => p.id === m)!; mp.alive = false; }
  const p = person(kind === 'brother' ? 'M' : 'F');
  c2.persons.push(p);
  c2.parents.push({ childId: p.id, fatherId: f, motherId: m });
  return [c2, p.id];
}

export function removePerson(c0: Case, id: string): Case {
  if (id === c0.deceasedId) return c0;
  const c: Case = structuredClone(c0);
  c.persons = c.persons.filter((p) => p.id !== id);
  c.unions = c.unions.filter((u) => !u.partners.includes(id));
  c.parents = c.parents.filter((l) => l.childId !== id).map((l) => ({ ...l, fatherId: l.fatherId === id ? undefined : l.fatherId, motherId: l.motherId === id ? undefined : l.motherId }));
  return c;
}

export function updatePerson(c0: Case, id: string, patch: Partial<Person>): Case {
  const c: Case = structuredClone(c0);
  const p = c.persons.find((x) => x.id === id)!;
  Object.assign(p, patch, { flags: { ...p.flags, ...(patch.flags ?? {}) } });
  if (id === c.deceasedId && patch.dateOfDeath) c.dateOfDeath = patch.dateOfDeath;
  return c;
}

export function setParentOf(c0: Case, childId: string, role: 'fatherId' | 'motherId', parentId: string | undefined): Case {
  const c: Case = structuredClone(c0);
  setParent(c, childId, role, parentId || undefined);
  return c;
}

// ---- persistence (BigInt-safe JSON) ----
const KEY = 'nz_shajra_case_v1';
export const toJSON = (c: Case) => JSON.stringify(c, (_k, v) => (typeof v === 'bigint' ? { $big: v.toString() } : v), 2);
export const fromJSON = (s: string): Case => JSON.parse(s, (_k, v) => (v && typeof v === 'object' && '$big' in v ? BigInt(v.$big) : v));
export function save(c: Case) { try { localStorage.setItem(KEY, toJSON(c)); } catch { /* private mode / full */ } }
export function load(): Case | null { try { const s = localStorage.getItem(KEY); return s ? fromJSON(s) : null; } catch { return null; } }
