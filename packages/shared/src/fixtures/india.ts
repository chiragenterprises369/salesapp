import type { AvatarConfig } from '../schemas/workspace.js';
import type { EmployeeStatus, Plan, RoleKind } from '../enums.js';
import type { TemplateCategory } from '../enums.js';

/** Realistic Indian SME data used by the seed script, simulator and frontend mocks. */

export const FIRST_NAMES = [
  'Rakesh', 'Sunita', 'Amit', 'Pooja', 'Vikram', 'Neha', 'Sanjay', 'Kavita', 'Rajesh', 'Anjali',
  'Manoj', 'Deepa', 'Arjun', 'Meera', 'Suresh', 'Priyanka', 'Harish', 'Lakshmi', 'Imran', 'Farah',
  'Gurpreet', 'Harpreet', 'Venkatesh', 'Divya', 'Ramesh', 'Swati', 'Nitin', 'Shalini', 'Ashok', 'Rekha',
  'Karthik', 'Bhavna', 'Mohit', 'Sneha', 'Yusuf', 'Ayesha', 'Prakash', 'Geeta', 'Rohit', 'Nandini',
] as const;

export const LAST_NAMES = [
  'Sharma', 'Verma', 'Gupta', 'Agarwal', 'Patel', 'Shah', 'Mehta', 'Reddy', 'Nair', 'Iyer',
  'Khan', 'Singh', 'Kaur', 'Joshi', 'Kulkarni', 'Deshmukh', 'Chatterjee', 'Banerjee', 'Das', 'Pillai',
  'Rao', 'Yadav', 'Mishra', 'Tiwari', 'Jain', 'Bansal', 'Malhotra', 'Kapoor', 'Sheikh', 'Menon',
] as const;

export const CITIES: ReadonlyArray<{ city: string; state: string }> = [
  { city: 'Mumbai', state: 'Maharashtra' },
  { city: 'Pune', state: 'Maharashtra' },
  { city: 'Delhi', state: 'Delhi' },
  { city: 'Noida', state: 'Uttar Pradesh' },
  { city: 'Ahmedabad', state: 'Gujarat' },
  { city: 'Surat', state: 'Gujarat' },
  { city: 'Rajkot', state: 'Gujarat' },
  { city: 'Bengaluru', state: 'Karnataka' },
  { city: 'Chennai', state: 'Tamil Nadu' },
  { city: 'Coimbatore', state: 'Tamil Nadu' },
  { city: 'Hyderabad', state: 'Telangana' },
  { city: 'Kolkata', state: 'West Bengal' },
  { city: 'Jaipur', state: 'Rajasthan' },
  { city: 'Ludhiana', state: 'Punjab' },
  { city: 'Indore', state: 'Madhya Pradesh' },
  { city: 'Kochi', state: 'Kerala' },
  { city: 'Lucknow', state: 'Uttar Pradesh' },
  { city: 'Nagpur', state: 'Maharashtra' },
  { city: 'Vadodara', state: 'Gujarat' },
  { city: 'Faridabad', state: 'Haryana' },
];

export const COMPANY_PREFIXES = [
  'Shree Ganesh', 'Balaji', 'Om Sai', 'Shakti', 'Jai Hind', 'Laxmi', 'Krishna', 'Sai Kripa', 'Mahalaxmi',
  'Navkar', 'Sunrise', 'Bharat', 'Apex', 'Royal', 'Vardhman', 'Precision', 'Galaxy', 'Supreme', 'Annapurna', 'Trident',
] as const;

export const COMPANY_SUFFIXES = [
  'Traders', 'Enterprises', 'Industries', 'Engineering Works', 'Exports', 'Polymers', 'Steel', 'Agro Foods',
  'Textiles', 'Pharma Distributors', 'Packaging', 'Electricals', 'Hardware', 'Infra Projects',
] as const;

/** Typical IndiaMART enquiry products with a plausible INR deal range. */
export const PRODUCTS: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: 'SS pipes 2 inch', min: 25_000, max: 4_00_000 },
  { name: 'Industrial RO plant 500 LPH', min: 1_20_000, max: 6_50_000 },
  { name: 'Corrugated boxes (5 ply)', min: 15_000, max: 2_50_000 },
  { name: 'LED street lights 60W', min: 40_000, max: 9_00_000 },
  { name: 'Solar water heater 200L', min: 18_000, max: 1_50_000 },
  { name: 'CNC machining job work', min: 50_000, max: 12_00_000 },
  { name: 'HDPE granules', min: 75_000, max: 18_00_000 },
  { name: 'Cotton yarn 30s', min: 60_000, max: 15_00_000 },
  { name: 'Diesel generator 62.5 kVA', min: 4_50_000, max: 9_50_000 },
  { name: 'Packaged drinking water bottling line', min: 8_00_000, max: 35_00_000 },
  { name: 'Office chairs (bulk)', min: 30_000, max: 3_00_000 },
  { name: 'Basmati rice (export)', min: 2_00_000, max: 40_00_000 },
  { name: 'Hydraulic hose fittings', min: 12_000, max: 2_00_000 },
  { name: 'Ayurvedic contract manufacturing', min: 1_00_000, max: 10_00_000 },
];

export const REQUIREMENT_SNIPPETS = [
  'Please share best price with GST and delivery time.',
  'Need quotation for monthly requirement.',
  'Kindly send catalogue and specifications.',
  'Looking for a reliable supplier, urgent requirement.',
  'Is installation included? Share price for 2 units.',
  'Want samples before bulk order.',
  'Call me after 4 pm to discuss.',
  'Need delivery to our factory, share freight charges.',
] as const;

export const TAGS = ['hot', 'repeat-buyer', 'export', 'gst-registered', 'distributor', 'price-sensitive', 'bulk', 'follow-up', 'tender'] as const;

export interface EmployeeFixture {
  key: string;
  name: string;
  email: string;
  role: RoleKind;
  title: string;
  status: EmployeeStatus;
  deskIndex: number;
  phone: string;
  avatar: AvatarConfig;
}

const av = (skinTone: string, hairColor: string, hairStyle: AvatarConfig['hairStyle'], outfitColor: string): AvatarConfig => ({
  skinTone,
  hairColor,
  hairStyle,
  outfitColor,
});

/** 12 employees with varied statuses. Emails use the seed workspace domain. */
export const EMPLOYEE_FIXTURES: readonly EmployeeFixture[] = [
  { key: 'admin', name: 'Anil Kapoor', email: 'anil@shakti.example', role: 'company_admin', title: 'Founder', status: 'busy', deskIndex: 0, phone: '+919810000001', avatar: av('#C68642', '#1F1A17', 'short', '#334155') },
  { key: 'manager', name: 'Priya Sharma', email: 'priya@shakti.example', role: 'manager', title: 'Sales Manager', status: 'idle', deskIndex: 1, phone: '+919810000002', avatar: av('#E0AC69', '#2B1D14', 'bun', '#4F46E5') },
  { key: 'rep1', name: 'Rohit Verma', email: 'rohit@shakti.example', role: 'employee', title: 'Sales Executive', status: 'on_call', deskIndex: 2, phone: '+919810000003', avatar: av('#C68642', '#1F1A17', 'short', '#0EA5E9') },
  { key: 'rep2', name: 'Sneha Iyer', email: 'sneha@shakti.example', role: 'employee', title: 'Sales Executive', status: 'busy', deskIndex: 3, phone: '+919810000004', avatar: av('#8D5524', '#0F0B08', 'long', '#10B981') },
  { key: 'rep3', name: 'Imran Sheikh', email: 'imran@shakti.example', role: 'employee', title: 'Inside Sales', status: 'idle', deskIndex: 4, phone: '+919810000005', avatar: av('#E0AC69', '#3B2A1E', 'curly', '#F59E0B') },
  { key: 'rep4', name: 'Kavita Reddy', email: 'kavita@shakti.example', role: 'employee', title: 'Inside Sales', status: 'on_call', deskIndex: 5, phone: '+919810000006', avatar: av('#C68642', '#1F1A17', 'long', '#E11D48') },
  { key: 'manager2', name: 'Gurpreet Singh', email: 'gurpreet@shakti.example', role: 'manager', title: 'Key Accounts Manager', status: 'away', deskIndex: 6, phone: '+919810000007', avatar: av('#E0AC69', '#111111', 'short', '#64748B') },
  { key: 'rep6', name: 'Lakshmi Nair', email: 'lakshmi@shakti.example', role: 'employee', title: 'Sales Executive', status: 'busy', deskIndex: 7, phone: '+919810000008', avatar: av('#8D5524', '#0F0B08', 'bun', '#7C3AED') },
  { key: 'rep7', name: 'Mohit Bansal', email: 'mohit@shakti.example', role: 'employee', title: 'Field Sales', status: 'offline', deskIndex: 8, phone: '+919810000009', avatar: av('#F1C27D', '#2B1D14', 'short', '#0F766E') },
  { key: 'rep8', name: 'Farah Khan', email: 'farah@shakti.example', role: 'employee', title: 'Inside Sales', status: 'idle', deskIndex: 9, phone: '+919810000010', avatar: av('#E0AC69', '#1F1A17', 'long', '#DB2777') },
  { key: 'rep9', name: 'Karthik Menon', email: 'karthik@shakti.example', role: 'employee', title: 'Sales Executive', status: 'on_call', deskIndex: 10, phone: '+919810000011', avatar: av('#8D5524', '#0F0B08', 'bald', '#2563EB') },
  { key: 'viewer', name: 'Deepa Joshi', email: 'deepa@shakti.example', role: 'viewer', title: 'Accounts', status: 'offline', deskIndex: 11, phone: '+919810000012', avatar: av('#F1C27D', '#3B2A1E', 'bun', '#475569') },
];

export const SEED_WORKSPACE = {
  name: 'Shakti Industries',
  slug: 'shakti',
  timezone: 'Asia/Kolkata',
  /** Dev-only password for all seeded users. Never used outside local seed. */
  devPassword: 'vistar-demo-123',
} as const;

export interface TeamFixture {
  name: string;
  /** EmployeeFixture.key of the manager */
  managerKey: string;
  memberKeys: string[];
}

export interface CompanyFixture {
  name: string;
  slug: string;
  plan: Plan;
  status: 'active' | 'trial';
  city: string;
  leadCount: number;
  employees: readonly EmployeeFixture[];
  teams: readonly TeamFixture[];
}

const generic = (outfit: string, style: AvatarConfig['hairStyle'] = 'short') => av('#C68642', '#1F1A17', style, outfit);

/**
 * Three demo companies on different plans so all panels can be demoed.
 * Shakti (growth) is the main workspace with 2,500 leads and 12 employees.
 */
export const COMPANY_FIXTURES: readonly CompanyFixture[] = [
  {
    name: SEED_WORKSPACE.name,
    slug: SEED_WORKSPACE.slug,
    plan: 'growth',
    status: 'active',
    city: 'Ludhiana',
    leadCount: 2500,
    employees: EMPLOYEE_FIXTURES,
    teams: [
      { name: 'Inside Sales', managerKey: 'manager', memberKeys: ['rep1', 'rep2', 'rep3', 'rep4', 'rep8'] },
      { name: 'Key Accounts', managerKey: 'manager2', memberKeys: ['rep6', 'rep7', 'rep9'] },
    ],
  },
  {
    name: 'Navkar Polymers',
    slug: 'navkar',
    plan: 'starter',
    status: 'active',
    city: 'Ahmedabad',
    leadCount: 320,
    employees: [
      { key: 'admin', name: 'Jignesh Shah', email: 'jignesh@navkar.example', role: 'company_admin', title: 'Director', status: 'busy', deskIndex: 0, phone: '+919820000001', avatar: generic('#334155') },
      { key: 'manager', name: 'Hetal Patel', email: 'hetal@navkar.example', role: 'manager', title: 'Sales Head', status: 'idle', deskIndex: 1, phone: '+919820000002', avatar: generic('#4F46E5', 'long') },
      { key: 'rep1', name: 'Bhavin Mehta', email: 'bhavin@navkar.example', role: 'employee', title: 'Sales Executive', status: 'on_call', deskIndex: 2, phone: '+919820000003', avatar: generic('#0EA5E9') },
      { key: 'rep2', name: 'Komal Desai', email: 'komal@navkar.example', role: 'employee', title: 'Sales Executive', status: 'idle', deskIndex: 3, phone: '+919820000004', avatar: generic('#10B981', 'bun') },
      { key: 'rep3', name: 'Ravi Parmar', email: 'ravi@navkar.example', role: 'employee', title: 'Inside Sales', status: 'offline', deskIndex: 4, phone: '+919820000005', avatar: generic('#F59E0B') },
    ],
    teams: [{ name: 'Sales', managerKey: 'manager', memberKeys: ['rep1', 'rep2', 'rep3'] }],
  },
  {
    name: 'Sunrise Agro Foods',
    slug: 'sunrise',
    plan: 'free',
    status: 'trial',
    city: 'Coimbatore',
    leadCount: 120,
    employees: [
      { key: 'admin', name: 'Senthil Kumar', email: 'senthil@sunrise.example', role: 'company_admin', title: 'Owner', status: 'idle', deskIndex: 0, phone: '+919830000001', avatar: generic('#334155') },
      { key: 'manager', name: 'Revathi Raman', email: 'revathi@sunrise.example', role: 'manager', title: 'Sales Manager', status: 'busy', deskIndex: 1, phone: '+919830000002', avatar: generic('#4F46E5', 'long') },
      { key: 'rep1', name: 'Arun Prakash', email: 'arun@sunrise.example', role: 'employee', title: 'Sales Executive', status: 'on_call', deskIndex: 2, phone: '+919830000003', avatar: generic('#0EA5E9') },
      { key: 'rep2', name: 'Divya Natarajan', email: 'divya@sunrise.example', role: 'employee', title: 'Sales Executive', status: 'away', deskIndex: 3, phone: '+919830000004', avatar: generic('#10B981', 'bun') },
    ],
    teams: [{ name: 'Sales', managerKey: 'manager', memberKeys: ['rep1', 'rep2'] }],
  },
];

/** Platform owner for the Super Admin panel (dev only; TOTP secret is generated by the seed). */
export const SUPER_ADMIN_FIXTURE = {
  email: 'owner@vistar.example',
  name: 'Vistar Platform Owner',
} as const;

export interface WhatsAppTemplateFixture {
  name: string;
  category: TemplateCategory;
  body: string;
  variables: string[];
}

/** Approved WhatsApp templates referenced by WORKFLOW_TEMPLATES. */
export const WHATSAPP_TEMPLATE_FIXTURES: readonly WhatsAppTemplateFixture[] = [
  { name: 'indiamart_welcome', category: 'utility', body: 'Namaste {{1}}, thank you for your enquiry with {{2}} about {{3}}. Reply PRICE for rates or CATALOG for details.', variables: ['lead.firstName', 'workspace.name', 'lead.productInterest'] },
  { name: 'price_list', category: 'utility', body: 'Hi {{1}}, here is our latest price list. Our team will call you shortly to confirm quantity and delivery.', variables: ['lead.firstName'] },
  { name: 'product_catalog', category: 'utility', body: 'Hi {{1}}, please find our product catalogue attached. Let us know which items interest you.', variables: ['lead.firstName'] },
  { name: 'indiamart_followup_1', category: 'marketing', body: 'Hi {{1}}, just checking if you are still looking for a supplier. We can share a quote today.', variables: ['lead.firstName'] },
  { name: 'missed_call_sorry', category: 'utility', body: 'Hi {{1}}, sorry we missed your call at {{2}}. We will call you back within 15 minutes.', variables: ['lead.firstName', 'workspace.name'] },
  { name: 'quote_reminder', category: 'utility', body: 'Hi {{1}}, a quick reminder about the quotation we shared. Happy to answer any questions.', variables: ['lead.firstName'] },
  { name: 'revival_offer', category: 'marketing', body: 'Hi {{1}}, we have new stock and festive pricing this month. Reply YES to get an updated quote.', variables: ['lead.firstName'] },
];
