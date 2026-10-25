// CLI demo: computes 5 sample cases and prints the share tables.  Run: npm run demo -w packages/inheritance-engine
import { CaseBuilder, compute, toString, type Case } from '../src/index.ts';

function show(title: string, c: Case) {
  const r = compute(c);
  const name = (id: string) => c.persons.find((p) => p.id === id)?.name ?? id;
  console.log(`\n=== ${title}  (law: ${r.lawSystem}, policy ${r.policyVersion}, base ${r.base})`);
  for (const s of r.shares) {
    const why = s.reasons.map((x) => x.ruleId).join(', ');
    console.log(`  ${name(s.personId).padEnd(26)} ${s.relationKey.padEnd(22)} ${toString(s.fraction).padStart(7)}  ${String(s.sihaam).padStart(4)}/${s.base}  ${s.percent.padStart(9)}%  ${s.status.padEnd(14)} ${why}`);
  }
  if (r.reserved.n) console.log(`  reserved: ${toString(r.reserved)}`);
  if (r.escheat.n) console.log(`  escheat (State): ${toString(r.escheat)}`);
  for (const n of r.notes) console.log(`  note: ${n.ruleId}${n.params ? ' ' + JSON.stringify(n.params) : ''}  [${n.citationKey}]`);
  if (r.needsVerification) console.log('  ! complex case: verify with a lawyer / revenue officer');
}

{
  const b = new CaseBuilder('sunni-hanafi', { name: 'Muhammad Aslam' });
  b.spouse({ name: 'Bushra (widow)' }); b.child('M', { name: 'Ahmad' }); b.child('M', { name: 'Bilal' }); b.child('F', { name: 'Ayesha' });
  b.mother({ name: 'Zainab (mother)' });
  show('1. Widow, two sons, a daughter and the mother', b.build());
}
{
  const b = new CaseBuilder('sunni-hanafi', { name: 'Ghulam Rasool' });
  b.spouse({ name: 'Wife' }); b.child('F', { name: 'Daughter 1' }); b.child('F', { name: 'Daughter 2' }); b.father({ name: 'Father' }); b.mother({ name: 'Mother' });
  show('2. Minbariyya (aul 24 -> 27)', b.build());
}
{
  const b = new CaseBuilder('sunni-hanafi', { name: 'Allah Ditta' });
  b.child('M', { name: 'Living son' });
  const s = b.child('M', { name: 'Predeceased son', alive: false, dateOfDeath: '2019-05-01' });
  b.childOf(s, 'M', { name: 'Grandson' }); b.childOf(s, 'F', { name: 'Granddaughter' });
  show("3. MFLO 1961 s.4: predeceased son's children with a living uncle", b.build());
}
{
  const b = new CaseBuilder('sunni-hanafi', { name: 'Fatima Bibi', gender: 'F' });
  b.spouse({ name: 'Husband' }); b.mother({ name: 'Mother' }); b.sibling('M', 'uterine', { name: 'Uterine brother 1' }); b.sibling('M', 'uterine', { name: 'Uterine brother 2' }); b.sibling('M', 'full', { name: 'Full brother' });
  show('4. Himariyya (Hanafi outcome)', b.build());
}
{
  const b = new CaseBuilder('sunni-hanafi', { name: 'Noor Muhammad' });
  b.spouse({ name: 'Pregnant widow', flags: { pregnant: true } }); b.father({ name: 'Father' }); b.child('F', { name: 'Daughter' });
  b.c.estate.wills.push({ external: 'Village mosque', fraction: { n: 1n, d: 2n } });
  show('5. Pregnant widow (reserve) and a will above one third', b.build());
}
