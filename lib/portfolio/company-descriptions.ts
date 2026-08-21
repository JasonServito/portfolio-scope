const companyDescriptions: Record<string, string> = {
  AAPL: "Apple designs consumer devices such as the iPhone and Mac, develops operating systems and services, and sells accessories and digital subscriptions.",
  MSFT: "Microsoft develops productivity and business software, operates the Azure cloud platform, and sells Windows, gaming, and device products.",
  NVDA: "NVIDIA designs graphics and accelerated-computing chips and provides software used in artificial intelligence, data centers, gaming, and professional visualization.",
  AMD: "AMD designs processors and graphics chips used in personal computers, data centers, gaming consoles, and embedded systems.",
  TSLA: "Tesla designs and sells electric vehicles and energy products, including battery storage, charging equipment, and solar-generation systems.",
  SHOP: "Shopify provides commerce software that helps businesses run online and physical stores, process payments, market products, and manage orders.",
  GOOGL:
    "Alphabet operates Google products such as Search, YouTube, Android, and advertising services, as well as Google Cloud and other technology businesses.",
  AMZN: "Amazon operates online retail marketplaces, provides cloud computing through AWS, and offers advertising, logistics, devices, and subscription services.",
  META: "Meta operates social and messaging products including Facebook, Instagram, Messenger, and WhatsApp, funded mainly by digital advertising.",
  COST: "Costco operates membership warehouses and e-commerce sites that sell groceries, household goods, fuel, and other products at relatively low markups.",
};

export function getCompanyDescription(input: {
  ticker: string;
  companyName: string;
  industry: string;
}) {
  return (
    companyDescriptions[input.ticker.toUpperCase()] ??
    `${input.companyName} operates in the ${input.industry.toLowerCase()} industry.`
  );
}
