import { people01, people02, people03, facebook, instagram, linkedin, twitter, airbnb, binance, coinbase, dropbox, send, shield, star } from "../assets";
export const navLinks = [
  {
    id: "dashboard",
    title: "Overview",
    redirect: '/overview'
  },
  {
    id: "payments",
    title: "Payments",
    redirect: '/payments'
  },
  {
    id: "transactions",
    title: "Transfers",
    redirect: '/transfers'
  },
  {
    id: "profile",
    title: "Profile",
    redirect: '/profile'
  },
];
export const features = [
  {
    id: "feature-1",
    icon: star,
    title: "Web3 PayTags",
    content:
      "Instantly send crypto globally with simple @paytags. No addresses, no chains to worry about — just pay and receive.",
  },
  {
    id: "feature-2",
    icon: shield,
    title: "100% Secured",
    content:
      "We take proactive steps using encrypted ledgers and blockchain verification to ensure your global transfers are secure.",
  },
  {
    id: "feature-3",
    icon: send,
    title: "Zero Delay",
    content:
      "Our automated smart contracts execute cross-chain payments in seconds, completely removing the hassle of bridges and centralized exchanges.",
  },
];

export const feedback = [
  {
    id: "feedback-1",
    content:
      "Sending crypto across chains with BotChain x GlobalPay is unbelievably fast. Outstanding developer experience!",
    name: "Alex Rivera",
    title: "DeFi Degen & Builder",
    img: people01,
  },
  {
    id: "feedback-2",
    content:
      "No more high gas fees or waiting on bridges. BotChain x GlobalPay is the ultimate cross-chain payment layer.",
    name: "Sarah Chen",
    title: "Crypto Investor",
    img: people02,
  },
  {
    id: "feedback-3",
    content:
      "A game-changer for cross-border payments in emerging markets. It is incredibly simple and 100% secure.",
    name: "Vikram Mehta",
    title: "Web3 Founder",
    img: people03,
  },
];

export const stats = [
  {
    id: "stats-1",
    title: "Active Global Users",
    value: "3800+",
  },
  {
    id: "stats-2",
    title: "Supported Regions",
    value: "10+",
  },
  {
    id: "stats-3",
    title: "Transaction Volume",
    value: "$230M+",
  },
];

export const footerLinks = [
  {
    title: "Useful Links",
    links: [
      {
        name: "Content",
        link: "#",
      },
      {
        name: "How it Works",
        link: "#",
      },
      {
        name: "Create",
        link: "#",
      },
      {
        name: "Explore",
        link: "#",
      },
      {
        name: "Terms & Services",
        link: "#",
      },
    ],
  },
  {
    title: "Community",
    links: [
      {
        name: "Help Center",
        link: "#",
      },
      {
        name: "Partners",
        link: "#",
      },
      {
        name: "Suggestions",
        link: "#",
      },
      {
        name: "Blog",
        link: "#",
      },
      {
        name: "Newsletters",
        link: "#",
      },
    ],
  },
  {
    title: "Partner",
    links: [
      {
        name: "Our Partner",
        link: "#",
      },
      {
        name: "Become a Partner",
        link: "#",
      },
    ],
  },
];

export const socialMedia = [
  {
    id: "social-media-1",
    icon: instagram,
    link: "https://www.instagram.com/",
  },
  {
    id: "social-media-2",
    icon: facebook,
    link: "https://www.facebook.com/",
  },
  {
    id: "social-media-3",
    icon: twitter,
    link: "https://www.twitter.com/",
  },
  {
    id: "social-media-4",
    icon: linkedin,
    link: "https://www.linkedin.com/",
  },
];

export const clients = [
  {
    id: "client-1",
    logo: airbnb,
  },
  {
    id: "client-2",
    logo: binance,
  },
  {
    id: "client-3",
    logo: coinbase,
  },
  {
    id: "client-4",
    logo: dropbox,
  },
];