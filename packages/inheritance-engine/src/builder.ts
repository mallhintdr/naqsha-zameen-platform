/** Small helper for tests, the CLI demo and the UI: build a Case from relations to the deceased. */
import { ZERO } from './fraction.ts';
import { DEFAULT_POLICY, type Case, type Gender, type LawSystem, type Person, type PersonFlags, type PolicyToggles } from './types.ts';

export class CaseBuilder {
  c: Case;
  private n = 0;
  constructor(law: LawSystem = 'sunni-hanafi', deceased: { name?: string; gender?: Gender; religion?: string } = {}, date = '2026-01-01', policy: Partial<PolicyToggles> = {}) {
    this.c = {
      id: 'case-1', lawSystem: law, deceasedId: 'D', dateOfDeath: date, province: 'punjab',
      persons: [{ id: 'D', name: deceased.name ?? 'Deceased', gender: deceased.gender ?? 'M', alive: false, dateOfDeath: date, religion: deceased.religion ?? 'muslim', flags: {} }],
      unions: [], parents: [],
      estate: { immovable: [], debts: ZERO, funeral: ZERO, dower: ZERO, wills: [] },
      policy: { ...DEFAULT_POLICY, ...policy },
    };
  }
  person(gender: Gender, opts: Partial<Person> & { flags?: PersonFlags } = {}): string {
    const id = opts.id ?? `p${++this.n}`;
    this.c.persons.push({ id, name: opts.name ?? id, gender, alive: opts.alive ?? true, dateOfDeath: opts.dateOfDeath, religion: opts.religion ?? 'muslim', flags: opts.flags ?? {} });
    return id;
  }
  parents(childId: string, fatherId?: string, motherId?: string) {
    const ex = this.c.parents.find((l) => l.childId === childId);
    if (ex) { ex.fatherId = fatherId ?? ex.fatherId; ex.motherId = motherId ?? ex.motherId; } else this.c.parents.push({ childId, fatherId, motherId });
    return this;
  }
  marry(a: string, b: string, type: 'marriage' | 'divorced' | 'khula' = 'marriage') {
    this.c.unions.push({ id: `u${this.c.unions.length + 1}`, partners: [a, b], type });
    return this;
  }

  // ---- relation shortcuts (relative to the deceased D) ----
  private dad?: string; private mom?: string; private gfather?: string; private gmother?: string;
  father(opts: Partial<Person> = {}) { this.dad ??= this.person('M', { name: 'Father', ...opts }); this.parents('D', this.dad); return this.dad; }
  mother(opts: Partial<Person> = {}) { this.mom ??= this.person('F', { name: 'Mother', ...opts }); this.parents('D', undefined, this.mom); return this.mom; }
  /** Placeholder parent (not alive) so siblings/grandparents can be attached. */
  ghostFather() { return this.father({ alive: false, dateOfDeath: '2000-01-01' }); }
  ghostMother() { return this.mother({ alive: false, dateOfDeath: '2000-01-01' }); }
  paternalGrandfather(opts: Partial<Person> = {}) { const f = this.ghostFatherIfNone(); this.gfather ??= this.person('M', { name: 'Paternal grandfather', ...opts }); this.parents(f, this.gfather); return this.gfather; }
  paternalGrandmother(opts: Partial<Person> = {}) { const f = this.ghostFatherIfNone(); this.gmother ??= this.person('F', { name: 'Paternal grandmother', ...opts }); this.parents(f, undefined, this.gmother); return this.gmother; }
  maternalGrandmother(opts: Partial<Person> = {}) { const m = this.mom ?? this.ghostMother(); const id = this.person('F', { name: 'Maternal grandmother', ...opts }); this.parents(m, undefined, id); return id; }
  private ghostFatherIfNone() { return this.dad ?? this.ghostFather(); }
  spouse(opts: Partial<Person> & { flags?: PersonFlags } = {}) {
    const d = this.c.persons[0];
    const id = this.person(d.gender === 'M' ? 'F' : 'M', { name: d.gender === 'M' ? 'Wife' : 'Husband', ...opts });
    this.marry('D', id);
    return id;
  }
  child(gender: Gender, opts: Partial<Person> = {}, otherParent?: string) {
    const id = this.person(gender, { name: gender === 'M' ? 'Son' : 'Daughter', ...opts });
    const d = this.c.persons[0];
    if (d.gender === 'M') this.parents(id, 'D', otherParent); else this.parents(id, otherParent, 'D');
    return id;
  }
  childOf(parentId: string, gender: Gender, opts: Partial<Person> = {}) {
    const id = this.person(gender, opts);
    const p = this.c.persons.find((x) => x.id === parentId)!;
    if (p.gender === 'M') this.parents(id, parentId); else this.parents(id, undefined, parentId);
    return id;
  }
  /** blood: full (same father and mother), consanguine (father), uterine (mother). */
  sibling(gender: Gender, blood: 'full' | 'consanguine' | 'uterine' = 'full', opts: Partial<Person> = {}) {
    const id = this.person(gender, { name: `${blood} ${gender === 'M' ? 'brother' : 'sister'}`, ...opts });
    if (blood === 'full') this.parents(id, this.dad ?? this.ghostFather(), this.mom ?? this.ghostMother());
    else if (blood === 'consanguine') {
      const otherMother = this.person('F', { alive: false, dateOfDeath: '2000-01-01', name: 'Step-mother' });
      this.parents(id, this.dad ?? this.ghostFather(), otherMother);
    } else {
      const otherFather = this.person('M', { alive: false, dateOfDeath: '2000-01-01', name: 'Step-father' });
      this.parents(id, otherFather, this.mom ?? this.ghostMother());
    }
    return id;
  }
  build(): Case { return this.c; }
}
