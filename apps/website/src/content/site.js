/**
 * Everything the website says that isn't layout: links, where we operate, contact details, the
 * team and the FAQs. Edit here; the pages read from this file.
 *
 * Honesty rule for this file: only state what ChopNow actually does today. Numbers (customers,
 * vendors, earnings) go in only once they are real.
 */

const env = import.meta.env;
const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\/+$/, '') : '');

export const links = {
  /** "Order now" and the cart icon. Until the customer app is live, this points at the download section. */
  order: clean(env.VITE_ORDER_URL) || '/#download',
  vendorPortal: clean(env.VITE_VENDOR_PORTAL_URL) || 'http://localhost:5173',
  get vendorSignUp() {
    return `${this.vendorPortal}/register`;
  },
  get vendorLogIn() {
    return `${this.vendorPortal}/`;
  },
  /** Empty until the apps are published; the buttons then say "Coming soon" instead of linking nowhere. */
  customerApp: { googlePlay: clean(env.VITE_CUSTOMER_PLAY_URL), appStore: clean(env.VITE_CUSTOMER_APP_STORE_URL) },
  riderApp: { googlePlay: clean(env.VITE_RIDER_PLAY_URL), appStore: clean(env.VITE_RIDER_APP_STORE_URL) },
};

/** All 36 states and the FCT. */
export const NIGERIAN_STATES = [
  'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
  'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina',
  'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
  'Sokoto', 'Taraba', 'Yobe', 'Zamfara',
];

/** Where ChopNow delivers today. Add a state (and its cities) here when it launches. */
export const SERVICE_AREAS = { Ogun: ['Sagamu'] };
export const DEFAULT_STATE = 'Ogun';
export const isServed = (state) => Boolean(SERVICE_AREAS[state]);

/**
 * Public contact details. Leave a field empty until it is real: the site only shows what is set.
 * (Set them before launch: see docs/LAUNCH_CHECKLIST.md.)
 */
export const contact = {
  email: '',
  phone: '',
  whatsapp: '',
  address: 'Sagamu, Ogun State, Nigeria',
  socials: { instagram: '', x: '', facebook: '', tiktok: '' },
};

/** The team. Add people here; the About page lays them out photo-left, story-right. */
export const team = [
  {
    name: 'Idowu Adetunji O.',
    nickname: 'Window T',
    role: 'CEO / Co-founder',
    photo: '/team/idowu-adetunji.webp',
    photoAlt: 'Idowu Adetunji, smiling, arms folded, in a navy sweatshirt and glasses',
    // Draft: edit freely. Kept to what we know is true today.
    bio: [
      'Idowu started ChopNow with a simple idea: good local food should be easy to get, and the people who cook it and deliver it should do well from it.',
      'He leads ChopNow’s vision and product, from the app customers order on to the tools restaurants and riders use every day. ChopNow is starting in Sagamu, Ogun State, so every part of it can be tested and improved with the community it serves before it grows to more cities.',
      'He is now building the team that will take ChopNow across Nigeria.',
    ],
  },
];

export const faqs = {
  Ordering: [
    ['Where does ChopNow deliver?', 'We’re starting in Sagamu, Ogun State. More towns and states will follow; pick your state at the top of the page to see if we’re there yet.'],
    ['How do I place an order?', 'Open the ChopNow app, search for a dish or a restaurant near you, choose your options and extras, add them to your cart and check out. You’ll see the full price, including delivery, before you pay.'],
    ['How do I know my order is on its way?', 'The app shows each step as it happens: the restaurant accepting, cooking, your rider picking up, and the rider heading to you.'],
    ['What is the delivery PIN?', 'Every order has a 4-digit PIN that only you can see in the app. Give it to your rider when your food arrives. It proves the right person received the order.'],
    ['Can I cancel?', 'Yes, free of charge, until the restaurant accepts your order. After that, contact us and we’ll help.'],
  ],
  Payments: [
    ['How can I pay?', 'Online with card, bank transfer or USSD (processed securely by Paystack), or cash on delivery for eligible orders.'],
    ['Is cash on delivery available for every order?', 'For most orders, up to a limit; first orders have a lower cash limit. The app tells you before you check out.'],
    ['What if I’m charged but my order doesn’t go through?', 'We check every payment with our payment provider. If money reaches us for an order that can’t be fulfilled, or you’re charged twice, it is refunded.'],
    ['How do refunds work?', 'If a paid order is cancelled or can’t be delivered, we refund it to your original payment method, or by bank transfer for cash orders.'],
  ],
  Restaurants: [
    ['Who can sell on ChopNow?', 'Restaurants, bukas, food vendors and kitchens in the areas we serve. We verify every business before it goes live.'],
    ['How much does it cost?', 'There’s no fee to sign up. We take a commission on completed orders, agreed with you before you go live.'],
    ['How and when do I get paid?', 'Your earnings are calculated for each delivered order, and you get a clear statement for each payout period in your ChopNow vendor dashboard.'],
  ],
  Riders: [
    ['What do I need to ride with ChopNow?', 'A smartphone, a motorcycle or bicycle, and valid identification. Motorcycle riders also need a valid licence. You upload these in the rider app.'],
    ['How do I get paid?', 'You earn for every completed delivery. The app shows what a job pays before you accept it, and your earnings and payouts are listed in the app.'],
    ['Can I choose when I work?', 'Yes. Go online when you want offers and offline when you’re done.'],
  ],
};
