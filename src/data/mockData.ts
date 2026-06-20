import { SchoolDetails, SchoolForecast, RecoveryPartner, AuditEntry, AIActionProposal } from "../types";

export const INITIAL_SCHOOL: SchoolDetails = {
  id: "lincoln-heights",
  name: "Lincoln Heights Public High School",
  location: "Chicago metropolitan area, Illinois",
  registeredStudents: 820,
  mealEligibleStudents: 760,
  regularDailyPreparation: 730,
  currentPreparationPlan: 730,
  cafeteriaManager: "Maya Rodriguez",
  schoolAdministrator: "Daniel Brooks",
  safetyFloorCount: 540,
};

export const INITIAL_FORECAST: SchoolForecast = {
  schoolId: "lincoln-heights",
  date: "2026-03-12", // Thursday focus day (aligned with SurplusSync Plus)
  expectedAttendance: 528,
  predictionInterval: {
    min: 497,
    max: 557,
    intervalType: "80% prediction interval",
  },
  recommendedPreparation: 562,
  shortageProbability: 0.041,
  surplusProbability50: 0.12, // 12%
  riskLevel: "HIGH",
  dataQuality: "HIGH",
  estimatedPreventableSurplus: 168, // 730 plan - 562 recommended
  modelVersion: "ssp-forecast-1.0",
  influentialInputs: [
    "Midterm examination week (reduced student stay)",
    "Grade 10 field trip (92 students off-site)",
    "Early dismissal scheduling modification",
    "Heavy precipitation forecast (rain 85% probability)",
    "Popularity score of Chicken & Rice menu item"
  ],
  menuForecast: {
    chickenPortions: 548,
    ricePortions: 562,
    vegetableSides: 520,
    fruit: 535,
    packagedMilk: 555,
  },
};

export const INITIAL_PARTNERS: RecoveryPartner[] = [
  {
    id: "metro-food-bank",
    name: "Metro Community Food Bank",
    distanceMiles: 3.2,
    capacityMeals: 120,
    hasRefrigeratedVehicle: true,
    acceptedCategories: ["PACKAGED", "CHILLED"],
    isAvailable: true,
    responseTimeMinutes: 20,
    reliabilityScore: 0.98,
    restrictions: ["Cannot accept cooked open hot trays", "Requires dock delivery"],
    locationDetails: "Downtown commercial wing, dock C",
  },
  {
    id: "harbor-shelter",
    name: "Harbor Family Shelter",
    distanceMiles: 1.8,
    capacityMeals: 70,
    hasRefrigeratedVehicle: false,
    acceptedCategories: ["PACKAGED"],
    isAvailable: true,
    responseTimeMinutes: 35,
    reliabilityScore: 0.92,
    restrictions: ["Accepts sealed, individually packaged single meals only"],
    locationDetails: "Avenue B family community hall",
  },
  {
    id: "neighborhood-kitchen",
    name: "Neighborhood Community Kitchen",
    distanceMiles: 6.4,
    capacityMeals: 180,
    hasRefrigeratedVehicle: true,
    acceptedCategories: ["PACKAGED", "CHILLED", "HOT"],
    isAvailable: true,
    responseTimeMinutes: 45,
    reliabilityScore: 0.95,
    restrictions: ["Accepts bulk packaging", "Requires food temperature logs at handover"],
    locationDetails: "Main St community annex",
  },
  {
    id: "greenleaf-hub",
    name: "Green-Leaf Food Hub",
    distanceMiles: 15.0,
    capacityMeals: 30,
    hasRefrigeratedVehicle: false,
    acceptedCategories: ["RAW_ORGANIC"],
    isAvailable: false,
    responseTimeMinutes: 120,
    reliabilityScore: 0.82,
    restrictions: ["Accepts raw garden vegetables and uncooked grains only", "Closed on school preparation days"],
    locationDetails: "Far East rural co-op compound",
  },
  {
    id: "hope-outreach",
    name: "Hope Outreach Center",
    distanceMiles: 4.5,
    capacityMeals: 40,
    hasRefrigeratedVehicle: false,
    acceptedCategories: ["PACKAGED"],
    isAvailable: false,
    responseTimeMinutes: 60,
    reliabilityScore: 0.88,
    restrictions: ["Kitchen currently closed for system-wide fire alarm maintenance", "No pickups available until July"],
    locationDetails: "Central avenue intake lobby",
  }
];

export const INITIAL_AUDIT_LOGS: AuditEntry[] = [
  {
    auditId: "adt-init",
    timestamp: "2026-06-19T08:00:00Z",
    actor: "System Inicialization",
    actorType: "SYSTEM",
    action: "Seed demo workspace",
    role: "PLATFORM_ADMINISTRATOR" as any,
    before: null,
    after: { status: "initialized" },
    reason: "Seeding default SurplusSync laboratory parameters.",
    permissionDecision: "GRANTED",
    approvalDecision: "BYPASSED",
    executionResult: "SUCCESS",
    reversibility: false,
  },
  {
    auditId: "adt-base-plan",
    timestamp: "2026-06-19T09:30:00Z",
    actor: "Daniel Brooks",
    actorType: "HUMAN",
    action: "Establish Base Preparation Target",
    role: "SCHOOL_ADMINISTRATOR" as any,
    before: { plan: 0 },
    after: { plan: 730 },
    reason: "Set standard upcoming Thursday base catering count to 730 meals.",
    permissionDecision: "GRANTED",
    approvalDecision: "APPROVED_BY_USER",
    executionResult: "SUCCESS",
    reversibility: true,
    undoStatus: "NOT_APPLICABLE",
  }
];

// High-fidelity operational similar historical days (useful for model training/explanation context etc)
export const SIMILAR_HISTORICAL_DAYS = [
  {
    date: "2026-03-12",
    eventName: "Grade 10 Midterm Exams + Spring Outing",
    attendance: 512,
    prepared: 710,
    served: 516,
    waste: 194,
    similarity: "High similarity: Exam schedule coupled with field trips leading to severe overproduction.",
  },
  {
    date: "2025-11-20",
    eventName: "Rainy Exam Day (High Rain)",
    attendance: 535,
    prepared: 680,
    served: 540,
    waste: 140,
    similarity: "Moderate similarity: Rain limits off-site options, but exams suppress overall visual campus numbers.",
  },
  {
    date: "2025-06-12",
    eventName: "End-of-term Early Dismissal",
    attendance: 520,
    prepared: 580,
    served: 518,
    waste: 62,
    similarity: "Moderate similarity: Prepared meal count was adjusted early, resulting in low leftover food.",
  }
];
