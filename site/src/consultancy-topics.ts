// Focused landing pages under /services/land-consultancy/<slug>/.
// Each one targets how people actually search (English + Roman Urdu + Urdu) for one kind of revenue matter.
export interface Topic {
  slug: string;
  /** Short name used in links and cards. */
  name: string;
  title: string;
  seoTitle: string;
  urdu: string;
  description: string;
  icon: string;
  lead: string;
  benefits: { icon: string; title: string; text: string }[];
  deliverables: string[];
  useCases: string[];
  process: { title: string; text: string }[];
  faqs: { q: string; a: string }[];
  waText: string;
}

const PROCESS = (research: string, route: string) => [
  { title: 'Confidential Consultation', text: 'Explain the matter in a meeting or on WhatsApp and share whatever papers you have.' },
  { title: 'Record Research', text: research },
  { title: 'Written Opinion', text: 'A clear opinion on what went wrong, your rights, the risks and the correct route.' },
  { title: 'Guidance to Resolution', text: route },
];

export const TOPICS: Topic[] = [
  {
    slug: 'mutation-intiqal',
    name: 'Mutation (Intiqal) Disputes',
    title: 'Mutation (Intiqal) Disputes',
    seoTitle: 'Intiqal (Mutation) Dispute Consultancy in Punjab | Naqsha Zameen',
    urdu: 'انتقال اراضی کے تنازعات — غلط، زیر التوا یا چیلنج شدہ انتقال',
    description:
      'Wrong, pending or challenged intiqal (land mutation) in Punjab? Senior revenue consultants trace the mutation history and advise on review, correction or appeal.',
    icon: 'file',
    lead:
      'A mutation (intiqal) is how a change of ownership enters the revenue record: sale, gift (hiba), inheritance, exchange or a court decree. When a mutation is entered wrongly, sanctioned without the right people, left pending for years, or attested in someone else’s favour, every later record carries the mistake forward. We trace the mutation and everything that followed it, and show you the correct way to put it right.',
    benefits: [
      { icon: 'file', title: 'Wrong or Fraudulent Mutation', text: 'Mutations entered in the wrong name, for the wrong area or share, or without the owner’s knowledge.' },
      { icon: 'clock', title: 'Pending Mutations', text: 'Sale or inheritance mutations that were never attested or sanctioned, sometimes for decades.' },
      { icon: 'users', title: 'Gift (Hiba) & Sale Entries', text: 'Disputed hiba and sale mutations, and mutations that do not match the registry deed.' },
      { icon: 'search', title: 'Mutation History', text: 'Every mutation on the khewat traced through the mutation register and old jamabandis.' },
      { icon: 'shield', title: 'Review & Appeal Routes', text: 'Guidance on review, revision and appeal before the revenue officers and the Board of Revenue.' },
      { icon: 'layers', title: 'Knock-on Entries', text: 'Later mutations and jamabandis that inherited the error, and how to correct them together.' },
    ],
    deliverables: [
      'Review of your mutation copies, fard and registry',
      'Mutation-by-mutation history of the khewat',
      'Written opinion on the defect and your rights',
      'Recommended route: correction, fresh mutation, review or appeal',
      'Help obtaining certified copies of old mutations',
      'Support to your advocate during proceedings',
    ],
    useCases: ['Wrong name in intiqal', 'Wrong share or area', 'Mutation without consent', 'Pending sale intiqal', 'Disputed hiba', 'Registry vs intiqal mismatch', 'Old mutation challenge', 'Title check before buying'],
    process: PROCESS(
      'We trace the mutation and every later entry through the mutation register and jamabandis.',
      'We support you and your advocate through correction, review or appeal of the mutation.',
    ),
    faqs: [
      { q: 'What is an intiqal (mutation)?', a: 'It is the entry that records a change of ownership in the revenue record, for example after a sale, gift (hiba), inheritance or court decree. Once sanctioned, it is carried into the next jamabandi.' },
      { q: 'A mutation was entered against me years ago. Is it too late?', a: 'Not necessarily. The right route depends on how the mutation was made and what happened afterwards. We review the full mutation history before advising whether correction, review or an appeal is possible.' },
      { q: 'My sale mutation has been pending for a long time. What can be done?', a: 'We check why it was not attested, whether the record supports it, and what is needed to complete it, then guide you through the steps.' },
      { q: 'Which documents help?', a: 'Copies of the mutation (intiqal), fard, jamabandi, the registry deed if any, and any revenue-office or court papers. If something is missing we tell you how to obtain it.' },
    ],
    waText: 'Assalam-o-Alaikum, I need consultancy about a mutation (intiqal) dispute.',
  },
  {
    slug: 'inheritance-wirasat',
    name: 'Inheritance (Wirasat) Matters',
    title: 'Inheritance (Wirasat) Matters',
    seoTitle: 'Wirasat (Inheritance) Land Transfer & Disputes in Punjab | Naqsha Zameen',
    urdu: 'وراثتی انتقال، ورثاء کے حصص اور وراثتی تنازعات',
    description:
      'Inheritance (wirasat) of agricultural land in Punjab: transfer to legal heirs, share calculation, missing heirs and disputes among heirs. Expert revenue-record advice.',
    icon: 'users',
    lead:
      'When a landowner dies, the land must pass to all legal heirs through an inheritance mutation (intiqal wirasat). Often this never happens, happens with heirs left out, or the shares are entered wrongly. Decades later the family finds that the record does not match who actually owns and farms the land. We rebuild the inheritance chain from the record and the family tree, and advise on the correct transfer.',
    benefits: [
      { icon: 'users', title: 'Transfer to Heirs', text: 'Getting a deceased owner’s land entered in the names of all legal heirs.' },
      { icon: 'search', title: 'Missing or Excluded Heirs', text: 'Daughters, sisters or other heirs left out of an inheritance mutation.' },
      { icon: 'layers', title: 'Share Calculation', text: 'Checking each heir’s share against the record, across several generations if needed.' },
      { icon: 'clock', title: 'Old Untransferred Inheritance', text: 'Land still in a grandparent’s name, with several deaths since then.' },
      { icon: 'file', title: 'Family Tree (Shajra Nasab)', text: 'Building the family tree that the inheritance mutation relies on.' },
      { icon: 'shield', title: 'Disputes Among Heirs', text: 'Clear facts from the record to settle or support a dispute between heirs.' },
    ],
    deliverables: [
      'Inheritance chain from the original owner to today’s heirs',
      'Share of each heir as it stands in the record',
      'Written opinion on errors, omissions and your rights',
      'Recommended route: inheritance mutation, correction or partition',
      'List of documents needed and how to obtain them',
      'Support to your advocate if the matter is contested',
    ],
    useCases: ['Land in a deceased owner’s name', 'Heirs left out', 'Wrong shares', 'Several generations untransferred', 'Disputes among heirs', 'Before partition or sale'],
    process: PROCESS(
      'We trace ownership from the original owner through every death and inheritance mutation.',
      'We guide you through the inheritance mutation or correction, and support your advocate if it is contested.',
    ),
    faqs: [
      { q: 'The land is still in my grandfather’s name. Can it be transferred now?', a: 'Usually yes. Each death since then has to be accounted for in the inheritance chain. We work out who the heirs are at each step and what the record needs.' },
      { q: 'Some heirs were left out of the inheritance mutation. What can be done?', a: 'We check how the mutation was made and advise on the right route for correction, review or appeal so that every legal heir is recorded.' },
      { q: 'Do you calculate the shares?', a: 'We check the shares entered in the record against the family tree and the inheritance chain, and point out where they are wrong. Questions of law are for your advocate, and we work alongside them.' },
      { q: 'What documents are needed?', a: 'Death certificates, CNICs of heirs, the family tree (shajra nasab), fard and jamabandi copies, and any earlier mutations.' },
    ],
    waText: 'Assalam-o-Alaikum, I need consultancy about an inheritance (wirasat) land matter.',
  },
  {
    slug: 'partition-taqseem',
    name: 'Partition (Taqseem) of Joint Land',
    title: 'Partition (Taqseem) of Joint Land',
    seoTitle: 'Land Partition (Taqseem) of Joint Khewat in Punjab | Naqsha Zameen',
    urdu: 'مشترکہ کھیوٹ کی تقسیم — خانگی اور عدالتی تقسیم',
    description:
      'Partition (taqseem) of joint agricultural land in Punjab: private family division, revenue-court partition, and bringing an existing division into the record.',
    icon: 'layers',
    lead:
      'Most agricultural land in Punjab is held jointly in a khewat, with each owner holding a share rather than a defined piece. Families often divide the land on the ground, but the record still shows everyone as joint owners. That makes sale, inheritance and possession disputes harder. We work out the shares from the record, advise on private or revenue-court partition, and help bring the division you already have into the record.',
    benefits: [
      { icon: 'layers', title: 'Joint Khewat', text: 'Clear picture of every co-owner and their share in the joint holding.' },
      { icon: 'users', title: 'Private (Family) Partition', text: 'Recording a division the family has agreed on.' },
      { icon: 'shield', title: 'Revenue-Court Partition', text: 'Guidance on applying for partition before the revenue officer when co-owners do not agree.' },
      { icon: 'pin', title: 'Ground vs Record', text: 'Comparing who farms which part with what the record shows.' },
      { icon: 'search', title: 'Share Verification', text: 'Checking that shares in the record are correct before dividing.' },
      { icon: 'ruler', title: 'Survey Support', text: 'Where the ground position matters, our RTK survey service can measure the parts.' },
    ],
    deliverables: [
      'Co-owners and shares from the current and old record',
      'Comparison of ground possession with the record',
      'Written opinion on private vs revenue-court partition',
      'Steps and documents for the chosen route',
      'Optional RTK measurement of the proposed division',
      'Support to your advocate during proceedings',
    ],
    useCases: ['Joint khewat among brothers', 'Family division not in record', 'Co-owner will not agree', 'Before selling a share', 'After inheritance', 'Possession vs share mismatch'],
    process: PROCESS(
      'We establish every co-owner’s share and how possession stands on the ground.',
      'We guide you through private or revenue-court partition, with survey support if needed.',
    ),
    faqs: [
      { q: 'We divided the land years ago. Why does the record still show us as joint owners?', a: 'A family division on the ground does not change the record by itself. It has to be brought into the record through the proper partition procedure.' },
      { q: 'One co-owner will not agree to partition. What can we do?', a: 'Partition can be applied for before the revenue officer. We explain the procedure and prepare the record facts for your application.' },
      { q: 'Do you measure the land for partition?', a: 'Our consultancy is about the record. If the division needs to be marked on the ground, our separate RTK survey service can measure it.' },
    ],
    waText: 'Assalam-o-Alaikum, I need consultancy about partition (taqseem) of joint land.',
  },
  {
    slug: 'illegal-possession-qabza',
    name: 'Illegal Possession & Encroachment (Qabza)',
    title: 'Illegal Possession & Encroachment (Qabza)',
    seoTitle: 'Illegal Possession (Qabza) & Land Encroachment in Punjab | Naqsha Zameen',
    urdu: 'ناجائز قبضہ اور تجاوزات — ریکارڈ کی بنیاد پر ملکیت و قبضہ کا ثبوت',
    description:
      'Land under illegal possession (qabza) or encroachment in Punjab? We establish ownership and possession from the revenue record and advise on the route to recover it.',
    icon: 'pin',
    lead:
      'Illegal possession (qabza) and encroachment are among the hardest land problems: someone farms, builds on or fences land that is not theirs, sometimes for years. The revenue record — jamabandi for ownership, khasra girdawari for possession — is often the strongest evidence of who has the right. We trace both through time, show when and how possession changed, and advise on the route to recover it with your advocate.',
    benefits: [
      { icon: 'pin', title: 'Illegal Occupation', text: 'Land occupied without right by a relative, neighbour or outsider.' },
      { icon: 'ruler', title: 'Encroachment', text: 'Boundaries pushed into your killas, paths or shared land.' },
      { icon: 'search', title: 'Possession History', text: 'Khasra girdawari entries traced season by season to show who was recorded in possession.' },
      { icon: 'file', title: 'Ownership Evidence', text: 'Ownership established from current and old jamabandis.' },
      { icon: 'shield', title: 'Recovery Route', text: 'Advice on the route through the revenue authorities or the courts.' },
      { icon: 'target', title: 'Ground Measurement', text: 'Our RTK survey service can measure exactly how far an encroachment extends.' },
    ],
    deliverables: [
      'Ownership trail from the jamabandi record',
      'Possession history from khasra girdawari',
      'Written opinion on your position and the risks',
      'Recommended route to recover possession',
      'Optional RTK measurement of the encroached area',
      'Record evidence prepared for your advocate',
    ],
    useCases: ['Land occupied by a relative', 'Neighbour encroachment', 'Wrong girdawari entry', 'Overseas owner’s land occupied', 'Shared path blocked', 'Boundary moved'],
    process: PROCESS(
      'We trace ownership and recorded possession through jamabandi and khasra girdawari over time.',
      'We support you and your advocate with the record evidence and, if needed, an RTK measurement.',
    ),
    faqs: [
      { q: 'Someone has occupied my land. Where do I start?', a: 'Start with the record: who is the owner in the jamabandi and who is recorded in possession in the khasra girdawari, and since when. We establish this before advising on the route.' },
      { q: 'The girdawari shows the other person in possession. Is my case lost?', a: 'Not necessarily. We look at when and how that entry changed and whether it was made correctly, which is often key evidence.' },
      { q: 'I live abroad and my land has been occupied. Can you help?', a: 'Yes. We can review the record and advise remotely over WhatsApp and email, and coordinate with your advocate in Pakistan.' },
      { q: 'Can you show exactly how much land is encroached?', a: 'Yes, through our separate RTK survey service, which measures boundaries on the ground with centimetre-level accuracy.' },
    ],
    waText: 'Assalam-o-Alaikum, I need consultancy about illegal possession (qabza) / encroachment of land.',
  },
  {
    slug: 'record-correction-fard-jamabandi',
    name: 'Record Correction (Fard & Jamabandi)',
    title: 'Record Correction (Fard Badr, Jamabandi & Girdawari)',
    seoTitle: 'Fard Badr & Jamabandi Record Correction in Punjab | Naqsha Zameen',
    urdu: 'فرد بدر، جمع بندی اور گرداوری کے ریکارڈ کی درستگی',
    description:
      'Errors in fard, jamabandi, khasra girdawari or the computerised land record in Punjab? We trace the error through old records and advise on correction (fard badr).',
    icon: 'search',
    lead:
      'Errors in the revenue record are common: a wrong name or parentage, a wrong share, a khasra number or area that does not match, or a mistake made when the record was computerised. Small errors become big problems at the time of sale, inheritance or a court case. We find where the error first appeared by comparing old and current records, and advise on the correct way to fix it.',
    benefits: [
      { icon: 'file', title: 'Fard Badr', text: 'Correction of clerical errors in the record through the proper procedure.' },
      { icon: 'search', title: 'Old Jamabandis & Misl Haqiyat', text: 'Comparing current entries with older record to find where the error began.' },
      { icon: 'layers', title: 'Computerised Record Errors', text: 'Mistakes that crept in when the manual record was computerised.' },
      { icon: 'users', title: 'Name & Parentage', text: 'Wrong spellings, names or parentage that block a transfer.' },
      { icon: 'map', title: 'Khasra & Area', text: 'Khasra numbers, areas or shares that do not match across records.' },
      { icon: 'shield', title: 'Correction Route', text: 'Which revenue officer to approach and what the record must show.' },
    ],
    deliverables: [
      'Comparison of old and current record entries',
      'Point where the error first appeared',
      'Written opinion on the correction route',
      'Steps and documents for the application',
      'Help obtaining certified copies of old record',
      'Follow-up guidance until the record is corrected',
    ],
    useCases: ['Wrong name in fard', 'Wrong share', 'Khasra number mismatch', 'Area mismatch', 'Computerised record error', 'Before sale or inheritance'],
    process: PROCESS(
      'We compare the current fard and jamabandi with older record to locate the error.',
      'We guide you through the correction application until the record is right.',
    ),
    faqs: [
      { q: 'What is fard badr?', a: 'It is the procedure for correcting a clerical error in the revenue record. Whether it applies depends on the kind of error, which is what we establish first.' },
      { q: 'The error came from computerisation. Can it be fixed?', a: 'Often, yes. Comparing the computerised record with the older manual record usually shows the original entry, which supports the correction.' },
      { q: 'Which records do you look at?', a: 'Fard, current and old jamabandis, misl haqiyat, mutation registers and khasra girdawari, as the case needs.' },
    ],
    waText: 'Assalam-o-Alaikum, I need consultancy about correcting an error in the land record (fard / jamabandi).',
  },
];
