
export type UserRole = 'ADMIN' | 'LEADER' | 'WORKER';

export type ContractType = 'MINIJOB' | 'MIDIJOB' | 'VOLLZEIT' | 'TEILZEIT';

export type TaxClass = 1 | 2 | 3 | 4 | 5 | 6;

export type ServiceCategory = 
  | 'AUSSENREINIGUNG' 
  | 'GULLIS' 
  | 'RASSEN_MAEHEN' 
  | 'GARTEN_PFLEGE' 
  | 'BAEUME_PRUEFEN' 
  | 'LAUBAUFNAHME';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  companyId?: string;
  avatarUrl?: string;
  // Deutsche Systemfelder
  hourlyRate?: number;
  contractType?: ContractType;
  monthlyTargetHours?: number;
  taxClass?: TaxClass;
  steuerklasse?: TaxClass;
  kinder?: number;
  bundesland?: string;
  hasChurchTax?: boolean;
  kirchensteuerpflichtig?: boolean;
  kvZusatzRate?: number;  // Krankenkassen-Zusatzbeitrag in % (z.B. 1.7 für TK, 1.9 für Barmer)
  canLoginWithPassword?: boolean;
  authProvider?: 'password' | 'anonymous';
  svNr?: string; // Sozialversicherungsnummer
  steuerId?: string; // Steuer-ID
  statusTaetigkeit?: string; // Status / Tätigkeit
}

export interface EmployeeDirectoryEntry {
  id: string;
  companyId: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
}

export type TimeEntryStatus = 'OPEN' | 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface TimeEntry {
  id: string;
  employeeId: string;
  jobAssignmentId: string;
  clockInDateTime?: string;
  clockOutDateTime?: string;
  actualWorkMinutes?: number;
  status: TimeEntryStatus;
  gpsVerified?: boolean;
  location?: { lat: number; lng: number };
  isManualEntry?: boolean;
  travelBonusMinutes?: number;
}

export type ServiceDetails = {
  isActive?: boolean;
  frequency?: string | null;
  months?: string[];
};

export interface JobSite {
  id: string;
  name: string;
  address: string;
  city: string;
  companyId?: string;
  postalCode?: string;
  region?: string;
  distanceFromHQ?: number;
  estimatedTravelTimeMinutesFromHQ?: number;
  travelTimeFromHQ: number; // in minutes
  isRemote: boolean;
  routeCode?: string; // e.g., LR 39, LR 38
  lat?: number | null;
  lng?: number | null;
  location?: { lat: number; lng: number }; // GPS coordinates
  services?: Record<string, ServiceDetails>;
}

export interface Note {
  id: string;
  type: 'text' | 'voice' | 'photo';
  content: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  duration?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  assignedWorkerIds: string[]; 
  jobSiteId: string;
  date: string;
  scheduledDate?: string;
  startTime: string;
  endTime: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  categories: ServiceCategory[];
  beforeImage?: string;
  afterImage?: string;
  audioNote?: string;
  audioTranscription?: string;
  notes?: Note[];
}

export interface Shift {
  id: string;
  workerId: string;
  jobSiteId: string;
  clockIn: string;
  clockOut?: string;
  gpsVerified: boolean;
  travelBonusMinutes: number;
}
