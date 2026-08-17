/**
 * Dashboard tour — narration script.
 * Three languages, same line order. Each "beat" is one scene.
 * Style: Feynman — short, plain, no jargon. Each beat has:
 *   id    - stable key, used by the composition
 *   dur   - seconds on screen (rounded for 30fps)
 *   en    - English line (voiceover / on-screen caption)
 *   hi    - Hindi line   (हिन्दी)
 *   bn    - Bengali line (বাংলা)
 *   show  - what the visual shows (number callouts, etc.)
 *
 * "Numbers" come from the live dashboard we just evaluated:
 *   Completed Today: 34
 *   Active Workers:  0   (off-shift at the time of capture)
 *   Avg Cycle Time:  2h 19m 22s
 *   In Progress:     0
 *   81 day_dates of history (5,104 sessions, May 20 -> Aug 17)
 *   Cloudflare D1 currently has 2 day_dates of history
 */

export type Beat = {
  id: string;
  dur: number; // seconds
  en: string;
  hi: string;
  bn: string;
  // Visual hints
  visual: "intro" | "kpi-card" | "pareto" | "perf" | "hourly" | "garment" | "report" | "export" | "cloud" | "outro";
  metric?: { label: string; value: string; color?: string };
  hint?: string; // sub-caption / Feynman explanation
};

export const BEATS: Beat[] = [
  {
    id: "intro",
    dur: 6,
    en: "This is the AbaYa Track dashboard. Let me walk you through every number, one by one.",
    hi: "यह AbaYa Track डैशबोर्ड है। मैं आपको एक-एक करके हर नंबर दिखाता हूँ।",
    bn: "এটি AbaYa Track ড্যাশবোর্ড। আমি আপনাকে একটি একটি করে প্রতিটি সংখ্যা দেখাচ্ছি।",
    visual: "intro",
  },
  {
    id: "completed-today",
    dur: 7,
    en: "Completed today: 34. That's how many abayas your team has finished since the shift started.",
    hi: "आज पूरे हुए: 34। यानी शिफ्ट शुरू होने के बाद से आपकी टीम ने जितनी अबाया पूरी की हैं।",
    bn: "আজকে সম্পন্ন: 34। মানে শিফট শুরু হওয়ার পর থেকে আপনার টিম যতগুলো আবায়া শেষ করেছে।",
    visual: "kpi-card",
    metric: { label: "COMPLETED TODAY", value: "34", color: "#22C55E" },
    hint: "Real-time. Updates the second an abaya is finished.",
  },
  {
    id: "active-workers",
    dur: 7,
    en: "Active workers: zero right now — that's because the screenshot was taken off-shift. During work hours, this number ticks up to 13 or 14.",
    hi: "एक्टिव वर्कर्स: अभी शून्य — क्योंकि यह स्क्रीनशॉट शिफ्ट के बाहर लिया गया है। काम के समय यह संख्या 13-14 तक जाती है।",
    bn: "সক্রিয় কর্মী: এখন শূন্য — কারণ স্ক্রিনশটটি শিফটের বাইরে নেওয়া। কাজের সময় এই সংখ্যা ১৩-১৪ পর্যন্ত যায়।",
    visual: "kpi-card",
    metric: { label: "ACTIVE WORKERS", value: "0", color: "#94A3B8" },
    hint: "Off-shift right now. The number is the live headcount on the floor.",
  },
  {
    id: "avg-cycle-time",
    dur: 8,
    en: "Average cycle time: 2 hours, 19 minutes, 22 seconds. That's the average time from start to finish, for every abaya done today.",
    hi: "औसत साइकिल समय: 2 घंटे, 19 मिनट, 22 सेकंड। आज पूरी हुई हर अबाया के लिए शुरू से अंत तक का औसत समय।",
    bn: "গড় সাইকেল সময়: ২ ঘণ্টা, ১৯ মিনিট, ২২ সেকেন্ড। আজ শেষ হওয়া প্রতিটি আবায়ার জন্য শুরু থেকে শেষ পর্যন্ত গড় সময়।",
    visual: "kpi-card",
    metric: { label: "AVG CYCLE TIME", value: "2h 19m 22s", color: "#F59E0B" },
    hint: "Lower is faster. If this creeps up, something is blocking the floor.",
  },
  {
    id: "in-progress",
    dur: 5,
    en: "In progress: zero, again because it's off-shift. During work this shows how many abayas are on the sewing tables right now.",
    hi: "इन प्रोग्रेस: शून्य, फिर से क्योंकि शिफ्ट नहीं है। काम के दौरान यह दिखाता है कि अभी सिलाई टेबल पर कितनी अबाया हैं।",
    bn: "চলমান: শূন্য, আবার কারণ শিফট নেই। কাজের সময় এটি দেখায় এখন সেলাই টেবিলে কতগুলো আবায়া আছে।",
    visual: "kpi-card",
    metric: { label: "IN PROGRESS", value: "0", color: "#94A3B8" },
    hint: "The live count of abayas being worked on right now.",
  },
  {
    id: "pareto",
    dur: 9,
    en: "Pareto — your top 20% workers. These are the people doing the most units today. Use this for bonuses, recognition, and to spot who to learn from.",
    hi: "पारेटो — आपके टॉप 20% वर्कर्स। ये वो लोग हैं जो आज सबसे ज़्यादा यूनिट कर रहे हैं। बोनस, पहचान, और सीखने के लिए इस्तेमाल करें।",
    bn: "প্যারেটো — আপনার শীর্ষ ২০% কর্মী। এরা আজ সবচেয়ে বেশি ইউনিট করছে। বোনাস, স্বীকৃতি, এবং শেখার জন্য ব্যবহার করুন।",
    visual: "pareto",
    hint: "Sorted by units done today. Click a name to see their full day.",
  },
  {
    id: "process-efficiency",
    dur: 8,
    en: "Process efficiency. Each station has a target cycle time. Green means meeting it, red means behind. If a process is red three days in a row, that's where to retrain.",
    hi: "प्रोसेस एफिशिएंसी। हर स्टेशन का एक टार्गेट साइकल टाइम है। हरा मतलब टार्गेट पूरा, लाल मतलब पीछे। अगर तीन दिन लाल रहे — वहाँ री-ट्रेनिंग चाहिए।",
    bn: "প্রসেস দক্ষতা। প্রতিটি স্টেশনের একটি টার্গেট সাইকেল সময় আছে। সবুজ মানে লক্ষ্য পূরণ, লাল মানে পিছিয়ে। তিন দিন লাল থাকলে — সেখানে রিট্রেনিং দরকার।",
    visual: "perf",
    hint: "Target = 45 minutes per abaya. Anything under 100% efficiency = room to improve.",
  },
  {
    id: "all-employees",
    dur: 7,
    en: "All employees, today's performance. The full list, sorted from best to worst. The little star marks the top 20%.",
    hi: "सभी कर्मचारी, आज का प्रदर्शन। पूरी लिस्ट, बेस्ट से वर्स्ट तक। छोटा स्टार टॉप 20% को मार्क करता है।",
    bn: "সব কর্মী, আজকের পারফরম্যান্স। সম্পূর্ণ তালিকা, সেরা থেকে সবচেয়ে খারাপ পর্যন্ত। ছোট্ট তারকা শীর্ষ ২০% চিহ্নিত করে।",
    visual: "perf",
    hint: "Use this to find the quiet stars, not just the loud ones.",
  },
  {
    id: "hourly-output",
    dur: 8,
    en: "Hourly output — 9 AM to 7 PM, factory shift. The chart shows which hours your team is fastest. If 2 PM is always a dip, that's when to schedule a break.",
    hi: "घंटेवार आउटपुट — सुबह 9 से शाम 7, फैक्ट्री शिफ्ट। चार्ट दिखाता है कि किस घंटे टीम सबसे तेज़ है। अगर दोपहर 2 बजे हमेशा डिप रहता है — वहीं ब्रेक रखें।",
    bn: "ঘণ্টা অনুযায়ী আউটপুট — সকাল ৯ থেকে সন্ধ্যা ৭, কারখানা শিফট। চার্ট দেখায় কোন ঘণ্টায় টিম সবচেয়ে দ্রুত। দুপুর ২টায় যদি সবসময় ডিপ থাকে — সেখানে বিরতি রাখুন।",
    visual: "hourly",
    hint: "Bars peak during 11 AM and 3 PM. Lunch dip around 1 PM is normal.",
  },
  {
    id: "garment-total",
    dur: 8,
    en: "Total time by abaya item code. Each row is one garment, with every station time summed up. Use this to see which abaya design is taking the longest.",
    hi: "अबाया आइटम कोड के अनुसार कुल समय। हर रो एक गारमेंट है, हर स्टेशन का समय जोड़कर। देखें कि कौन सा डिज़ाइन सबसे ज़्यादा समय ले रहा है।",
    bn: "আবায়া আইটেম কোড অনুযায়ী মোট সময়। প্রতিটি সারি একটি পোশাক, প্রতিটি স্টেশনের সময় যোগ করা। দেখুন কোন ডিজাইন সবচেয়ে বেশি সময় নিচ্ছে।",
    visual: "garment",
    hint: "Sort by total time = slowest designs first. Sort by count = bestsellers.",
  },
  {
    id: "live-active",
    dur: 5,
    en: "Live active sessions. Right now it says none, because we're off-shift. During work, this is your live view: who is working on what, and for how long.",
    hi: "लाइव एक्टिव सेशन। अभी खाली है क्योंकि शिफ्ट नहीं है। काम के दौरान यह आपका लाइव व्यू है — कौन किस पर काम कर रहा है, कितनी देर से।",
    bn: "লাইভ সক্রিয় সেশন। এখন খালি কারণ শিফট নেই। কাজের সময় এটি আপনার লাইভ ভিউ — কে কীতে কাজ করছে, কতক্ষণ ধরে।",
    visual: "hourly",
    hint: "Updates in real time. Refresh-free — it just streams.",
  },
  {
    id: "report-daily",
    dur: 7,
    en: "Daily report. One button. One day. Click it on Monday morning to see how the weekend went. Comes with numbers you can copy into WhatsApp or email.",
    hi: "डेली रिपोर्ट। एक बटन। एक दिन। सोमवार सुबह क्लिक करें, पता चले वीकेंड कैसा रहा। नंबर ऐसे आते हैं कि WhatsApp या ईमेल में सीधे कॉपी कर सकें।",
    bn: "দৈনিক রিপোর্ট। একটি বোতাম। একটি দিন। সোমবার সকালে ক্লিক করুন, উইকেন্ড কেমন গেল বুঝুন। সংখ্যা এমন আসে যে WhatsApp বা ইমেইলে সরাসরি কপি করতে পারবেন।",
    visual: "report",
    metric: { label: "DAILY", value: "1 day", color: "#A78BFA" },
    hint: "Best for: end-of-day recap, weekly standup.",
  },
  {
    id: "report-weekly",
    dur: 7,
    en: "Weekly report. Seven days, grouped. Use this for the Monday team meeting. Tells you which day of the week is your strongest, and which is your weakest.",
    hi: "वीकली रिपोर्ट। सात दिन, ग्रुप में। सोमवार की टीम मीटिंग के लिए। बताता है हफ्ते का कौन सा दिन सबसे मज़बूत है, कौन सा कमज़ोर।",
    bn: "সাপ্তাহিক রিপোর্ট। সাত দিন, গ্রুপ করা। সোমবার টিম মিটিংয়ের জন্য। বলে সপ্তাহের কোন দিন সবচেয়ে শক্তিশালী, কোনটি দুর্বল।",
    visual: "report",
    metric: { label: "WEEKLY", value: "7 days", color: "#A78BFA" },
    hint: "Best for: Monday team review, payroll cross-check.",
  },
  {
    id: "report-monthly",
    dur: 7,
    en: "Monthly report. 30 days. This is the one to send to investors, partners, and your accountant. Shows month-over-month growth.",
    hi: "मंथली रिपोर्ट। 30 दिन। यह वाली इन्वेस्टर्स, पार्टनर्स, और अकाउंटेंट को भेजें। महीने-दर-महीने ग्रोथ दिखाता है।",
    bn: "মাসিক রিপোর্ট। ৩০ দিন। এটি বিনিয়োগকারী, অংশীদার এবং হিসাবরক্ষককে পাঠান। মাসভিত্তিক প্রবৃদ্ধি দেখায়।",
    visual: "report",
    metric: { label: "MONTHLY", value: "30 days", color: "#A78BFA" },
    hint: "Best for: monthly review, finance, investor update.",
  },
  {
    id: "report-yearly",
    dur: 7,
    en: "Yearly report. 365 days. The big picture. Best used at year-end for tax, planning, and the all-hands meeting.",
    hi: "इयरली रिपोर्ट। 365 दिन। बड़ा चित्र। साल के अंत में टैक्स, प्लानिंग, और ऑल-हैंड्स मीटिंग के लिए सबसे अच्छा।",
    bn: "বার্ষিক রিপোর্ট। ৩৬৫ দিন। বড় ছবি। বছরের শেষে ট্যাক্স, পরিকল্পনা এবং অল-হ্যান্ডস মিটিংয়ের জন্য সেরা।",
    visual: "report",
    metric: { label: "YEARLY", value: "365 days", color: "#A78BFA" },
    hint: "Best for: year-end review, tax filing, annual planning.",
  },
  {
    id: "report-custom",
    dur: 6,
    en: "Custom range. Pick any two dates. Use this for an investor who asks, 'what was November like?' or to compare two months side by side.",
    hi: "कस्टम रेंज। कोई भी दो तारीख़ चुनें। 'नवंबर कैसा था?' पूछने वाले इन्वेस्टर के लिए, या दो महीनों की तुलना के लिए।",
    bn: "কাস্টম রেঞ্জ। যেকোনো দুটি তারিখ বাছুন। 'নভেম্বর কেমন ছিল?' জিজ্ঞেস করা বিনিয়োগকারীর জন্য, বা দুটি মাসের তুলনার জন্য।",
    visual: "report",
    metric: { label: "CUSTOM", value: "any dates", color: "#A78BFA" },
    hint: "Best for: ad-hoc questions, side-by-side comparison.",
  },
  {
    id: "export",
    dur: 6,
    en: "Export floor data. CSV for Excel, JSON for tools. Download button is right here. Filter by date range. Done in one click.",
    hi: "एक्सपोर्ट फ्लोर डेटा। Excel के लिए CSV, टूल्स के लिए JSON। डाउनलोड बटन यहाँ है। डेट रेंज से फ़िल्टर करें। एक क्लिक में हो जाता है।",
    bn: "ফ্লোর ডেটা এক্সপোর্ট। Excel-এর জন্য CSV, টুলের জন্য JSON। ডাউনলোড বোতাম এখানে। তারিখের রেঞ্জ দিয়ে ফিল্টার। এক ক্লিকে হয়ে যায়।",
    visual: "export",
    hint: "Best for: sharing with your accountant, building slides.",
  },
  {
    id: "cloud",
    dur: 9,
    en: "Cloud sync. The factory server holds the truth. It pushes a copy to the cloud every few seconds. So even if the office WiFi dies, your CEO dashboard keeps working from anywhere in the world.",
    hi: "क्लाउड सिंक। फैक्ट्री सर्वर के पास असली डेटा है। वो हर कुछ सेकंड में क्लाउड पर कॉपी भेजता है। ऑफ़िस का WiFi गिर जाए, CEO डैशबोर्ड दुनिया में कहीं से भी चलता रहता है।",
    bn: "ক্লাউড সিঙ্ক। কারখানা সার্ভারের কাছে আসল ডেটা আছে। সে প্রায় প্রতি কয়েক সেকেন্ডে ক্লাউডে কপি পাঠায়। অফিসের WiFi পড়ে গেলেও, সিইও ড্যাশবোর্ড বিশ্বের যেকোনো জায়গা থেকে চলতে থাকে।",
    visual: "cloud",
    hint: "Status badge: green = live, red = buffered locally and syncing.",
  },
  {
    id: "outro",
    dur: 7,
    en: "That's the whole dashboard. One screen, every number, three languages, zero jargon. Open it, click the report you need, share it, done.",
    hi: "बस, यही है पूरा डैशबोर्ड। एक स्क्रीन, हर नंबर, तीन भाषा, ज़ीरो जार्गन। खोलें, जो रिपोर्ट चाहिए क्लिक करें, शेयर करें, हो गया।",
    bn: "ব্যস, এটিই পুরো ড্যাশবোর্ড। একটি স্ক্রিন, প্রতিটি সংখ্যা, তিনটি ভাষা, শূন্য জার্গন। খুলুন, যে রিপোর্ট দরকার ক্লিক করুন, শেয়ার করুন, হয়ে গেছে।",
    visual: "outro",
  },
];

// Total duration in frames (30 fps).
export const FPS = 30;
export const TOTAL_DURATION_S = BEATS.reduce((s, b) => s + b.dur, 0);
export const TOTAL_FRAMES = TOTAL_DURATION_S * FPS;
