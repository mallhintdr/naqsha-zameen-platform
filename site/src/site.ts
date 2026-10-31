// One place for business facts. Edit here; every page updates.
// Addresses come from build-time env so one source builds both domains:
//   PUBLIC_SITE_URL       default https://naqsha-zameen.com
//   PUBLIC_DASHBOARD_URL  default https://dashboard.naqsha-zameen.com
// e.g. the .pk build for o3host:  PUBLIC_SITE_URL=https://naqsha-zameen.pk PUBLIC_DASHBOARD_URL=https://dashboard.naqsha-zameen.pk npm run build
const SITE_URL = (import.meta.env.PUBLIC_SITE_URL || 'https://naqsha-zameen.com').replace(/\/$/, '');
const DASHBOARD_URL = (import.meta.env.PUBLIC_DASHBOARD_URL || 'https://dashboard.naqsha-zameen.com').replace(/\/$/, '');

export const SITE = {
  brand: 'Naqsha Zameen',
  company: 'GeoMatrix Technologies',
  url: SITE_URL,
  dashboardUrl: DASHBOARD_URL,
  /** Host name shown in text, e.g. dashboard.naqsha-zameen.com */
  dashboardHost: new URL(DASHBOARD_URL).host,
  registerUrl: `${DASHBOARD_URL}/register`,
  loginUrl: `${DASHBOARD_URL}/login`,
  whatsapp: '923048840264',
  email: 'mallhintdr@gmail.com',
  facebook: 'https://www.facebook.com/profile.php?id=100071237130538',
  region: 'Punjab, Pakistan',
  /** Page-view counter pixel (backend route GET /api/visit.gif). Empty string disables tracking. */
  visitsEndpoint: `${DASHBOARD_URL}/api/visit.gif`,
  /** Paste the content value from Google Search Console's HTML-tag verification. */
  googleSiteVerification: '',
  tagline: 'Every killa, every murabba — on your phone.',
  seoTitle: 'Naqsha Zameen – Land Maps, RTK Survey & Revenue Consultancy, Punjab',
  description:
    'Mouza, murabba & killa maps (zameen ka naqsha) online, RTK land measurement, drone surveys and revenue record consultancy for land disputes in Punjab.',
};

// Advertising. Leave adsenseClient empty to keep ads (and their cookies) completely off.
// To enable: set your publisher ID, e.g. 'ca-pub-1234567890123456', and the slot IDs from AdSense.
export const ADS = {
  adsenseClient: '',
  slots: {
    inContent: '',
    beforeFooter: '',
  },
};
export const adsEnabled = () => ADS.adsenseClient.startsWith('ca-pub-');

export const waLink = (text = 'Assalam-o-Alaikum, I want information about Naqsha Zameen services.') =>
  `https://wa.me/${SITE.whatsapp}?text=${encodeURIComponent(text)}`;

export interface NavItem { href: string; label: string; children?: { href: string; label: string }[] }

/** Header menu: services grouped under one dropdown, maps/dashboard under another. */
export const NAV: NavItem[] = [
  {
    href: '/services/digital-mapping/',
    label: 'Services',
    children: [
      { href: '/services/digital-mapping/', label: 'Digital Land Maps' },
      { href: '/services/rtk-survey/', label: 'RTK Land Measurement' },
      { href: '/services/drone-imagery/', label: 'Drone Imagery' },
      { href: '/services/land-consultancy/', label: 'Revenue Record Consultancy' },
    ],
  },
  { href: '/maps/', label: 'Mouza Maps & Dashboard' },
  {
    href: '/tools/',
    label: 'Tools',
    children: [{ href: '/tools/shajra-nasab/', label: 'Shajra Nasab & Inheritance' }, { href: '/tools/share-calculator/', label: 'Inheritance Share Calculator' }],
  },
  { href: '/about/', label: 'About' },
  { href: '/contact/', label: 'Contact' },
];

export const SERVICES = [
  {
    slug: 'digital-mapping',
    title: 'Digital Land Maps',
    urdu: 'ڈیجیٹل نقشہ جات',
    short: 'Mouza, murabba and killa boundaries overlaid on satellite imagery — searchable on any phone.',
    icon: 'map',
    accent: 'from-indigo-500 to-cyan-400',
  },
  {
    slug: 'rtk-survey',
    title: 'RTK Land Measurement',
    urdu: 'آر ٹی کے پیمائش',
    short: 'Centimetre-accurate GNSS RTK surveys for demarcation, boundary disputes and plot layout.',
    icon: 'target',
    accent: 'from-emerald-500 to-teal-400',
  },
  {
    slug: 'drone-imagery',
    title: 'Drone Imagery',
    urdu: 'ڈرون سروے',
    short: 'High-resolution aerial orthomosaics and site photos of farms, housing schemes and projects.',
    icon: 'drone',
    accent: 'from-amber-500 to-rose-500',
  },
  {
    slug: 'land-consultancy',
    title: 'Revenue Record Consultancy',
    urdu: 'ریونیو ریکارڈ و زمینی تنازعات',
    short: 'Senior advice on old land disputes: mutations (intiqal), inheritance, partition, illegal possession and record correction.',
    icon: 'shield',
    accent: 'from-violet-500 to-fuchsia-400',
  },
] as const;
