/** A make/model guess for a car, from a photo, a VIN or you. */
export interface Identity {
  make: string;
  model: string;
  /** Range of model years it could be; equal when known exactly. */
  yearFrom: number;
  yearTo: number;
  /** The year you picked or the VIN gave. */
  year?: number;
  trim?: string;
  vin?: string;
  /** 0–1, for photo guesses. */
  confidence?: number;
  /** EPA version (engine/transmission/drive) picked for the spec sheet. */
  variant?: number;
  source: 'photo' | 'vin' | 'manual';
  alternatives?: Candidate[];
}

export interface Candidate {
  make: string;
  model: string;
  yearFrom: number;
  yearTo: number;
  confidence: number;
}

export interface PaintColor {
  name: string;
  hex: string;
}

/** One spec value and where it came from. */
export interface Spec {
  label: string;
  value: string;
  source: string;
}

export interface SpecGroup {
  title: string;
  items: Spec[];
}

export interface Recall {
  campaign: string;
  date: string;
  component: string;
  summary: string;
  remedy: string;
}

export interface SafetyRating {
  description: string;
  overall: string | null;
  frontal: string | null;
  side: string | null;
  rollover: string | null;
}

export interface SpecSheet {
  year: number;
  make: string;
  model: string;
  /** EPA vehicle options for this year/make/model, e.g. engine and transmission choices. */
  variants: { id: number; label: string }[];
  variant?: number;
  groups: SpecGroup[];
  recalls: Recall[] | null;
  ratings: SafetyRating[] | null;
  sources: string[];
  /** The recall and rating services couldn't be reached. */
  offline?: boolean;
}

/** Owner complaints to NHTSA about one model year. */
export interface Complaints {
  count: number;
  crashes: number;
  fires: number;
  injuries: number;
  deaths: number;
  components: { name: string; count: number }[];
  latest: { date: string; components: string; summary: string }[];
}

/** A spot on the 3D model you can tap for a spec or a note. */
export interface Hotspot {
  id: string;
  kind: 'wheel' | 'engine' | 'light' | 'badge' | 'cabin' | 'note';
  label: string;
  /** Position on the model, in its own units (metres once scaled). */
  at: [number, number, number];
}

/** The 3D model made from a walk-around video. */
export interface Capture {
  /** paused: the build stopped to ask about the video (see the job's issues). */
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed';
  job?: string;
  video?: string;
  /** Gaussian splat file, ready for the viewer. */
  splat?: string;
  poster?: string;
  hotspots?: Hotspot[];
  /** Car length in metres, used to scale the model. */
  length?: number;
  /** you: entered; camera: from the height the video was filmed at; size class: typical for the class. */
  lengthSource?: 'size class' | 'camera' | 'you';
  /** 4×4 row-major transform: splat → car on the floor, y up, length along x, metres. */
  transform?: number[];
  /** Length, height, width in metres after the transform. */
  size?: [number, number, number];
  /** −1 when the model faces backwards along x (you flipped it). */
  front?: 1 | -1;
  /** The solid core inside the model (GLB, same coordinates as the splat), so thin panels aren't see-through. */
  core?: string | null;
  stats?: { frames: number; placed: number; splats: number; turntable: boolean; minutes: number };
  error?: string | null;
  updatedAt?: number;
  /** Set when a newer video didn't make a model and this earlier one came back. */
  retakeError?: string | null;
  retakeJob?: string;
}

export interface JobStep {
  key: string;
  label: string;
  status: 'waiting' | 'running' | 'paused' | 'done' | 'failed';
  progress: number;
  detail?: string;
  seconds?: number;
  startedAt?: number;
}

export interface Job {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';
  /** Why a paused job is asking before it goes on. */
  issues?: string[] | null;
  steps: JobStep[];
  error: string | null;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

export type DamageKind = 'scratch' | 'dent' | 'chip' | 'crack' | 'scuff' | 'other';

/** A damage mark, on the 3D model (`at`) or on a photo (`photo` + `spot`, 0–1 across and down). */
export interface Pin {
  id: string;
  kind: DamageKind;
  note: string;
  at?: [number, number, number];
  /** The model's front setting when this pin was placed (3D pins turn with it). */
  front?: 1 | -1;
  photo?: string;
  spot?: [number, number];
  closeup?: string;
  fixed?: boolean;
  createdAt: number;
}

export interface Comparison {
  id: string;
  createdAt: number;
  before: string;
  after: string;
  overlay: string;
  regions: { box: [number, number, number, number]; area: number; score: number }[];
  size: [number, number];
  /** How close the two viewpoints were; from different spots, small outlines may just be the angle. */
  viewpoint?: 'same' | 'close' | 'different';
}

export interface Condition {
  pins?: Pin[];
  comparisons?: Comparison[];
}

export type SellCondition = 'excellent' | 'good' | 'fair' | 'rough';
export type Backdrop = 'studio' | 'graphite' | 'white';

/** A studio photo: the car cut out of one of its photos onto a backdrop. */
export interface StudioShot {
  url: string;
  source: string;
  backdrop: Backdrop;
  /** Sides where the car runs off the original photo. */
  clipped: string[];
  method: 'birefnet' | 'outline';
}

/** What you enter on the Sell tab, and the listing made from it. */
export interface SellInfo {
  price?: number;
  mileage?: number;
  condition?: SellCondition;
  location?: string;
  extras?: string;
  notes?: string;
  style?: 'short' | 'detailed';
  includeCondition?: boolean;
  useNickname?: boolean;
  backdrop?: Backdrop;
  shots?: StudioShot[];
  /** Photos in the listing, in order (studio shots or originals). */
  photos?: string[];
  /** The listing text as it goes out; set when you edit it by hand. */
  listing?: string;
  edited?: boolean;
}

/** A saved mod preview. */
export interface Look {
  id: string;
  name: string;
  photo: string;
  image: string;
  paint: PaintColor;
  finish: 'gloss' | 'satin' | 'matte';
  wheel?: string | null;
  tint?: number;
  createdAt: number;
}

export interface Car {
  id: string;
  createdAt: number;
  updatedAt?: number;
  nickname?: string;
  identity?: Identity;
  color?: PaintColor;
  /** Cover photo URL. */
  photo?: string;
  photos?: string[];
  specs?: SpecSheet;
  capture?: Capture;
  /** The finished model, kept on show while a new walk-around is being built. */
  previousCapture?: Capture | null;
  looks?: Look[];
  condition?: Condition;
  sell?: SellInfo;
  guess?: Guess;
  /** considering: a car you're thinking of buying (it gets the Buying tab instead of Sell). Unset means yours. */
  status?: 'own' | 'considering';
  buying?: BuyingInfo;
}

/** What the VIN says the car was built as (NHTSA's decoder). Makers leave some of it out. */
export interface VinDetails {
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  series?: string;
  body?: string;
  doors?: number;
  drive?: string;
  cylinders?: number;
  displacement?: number;
  config?: 'V' | 'I' | 'H' | 'W';
  fuel?: string;
  fuel2?: string;
  electrification?: string;
  turbo?: boolean;
  transmission?: string;
  speeds?: number;
  hp?: number;
  plant?: string;
}

/** The facts in a vehicle history report, read from a Carfax or AutoCheck report or entered by you. null: it doesn't say. */
export interface HistoryFacts {
  source: 'carfax' | 'autocheck' | 'you' | null;
  vin?: string | null;
  reportDate?: string | null;
  accidents: boolean | null;
  damageDates?: string[];
  damageCount?: number | null;
  severity?: 'minor' | 'moderate' | 'severe' | null;
  structural?: boolean | null;
  airbag?: boolean | null;
  totalLoss?: boolean | null;
  title: 'clean' | 'branded' | null;
  titleBrands?: string[];
  owners?: number | null;
  serviceRecords?: number | null;
  lastMileage?: number | null;
  lastMileageDate?: string | null;
  odometerProblem?: boolean | null;
  /** The report's PDF, kept with your files. */
  file?: string | null;
}

/** What a check you did yourself on another site said. */
export type CheckAnswer = 'clear' | 'found';

/** Your checks on a car you're thinking of buying. */
export interface BuyingInfo {
  /** The VIN's decode, kept from when you added it. */
  vin?: VinDetails;
  /** What the photo looked like before the VIN was added, to compare. */
  photoGuess?: { make: string; model: string; yearFrom: number; yearTo: number; confidence?: number };
  /** The listing, pasted. */
  ad?: string;
  history?: HistoryFacts;
  mileage?: number;
  asking?: number;
  /** Kelley Blue Book private-party value you looked up. */
  kbb?: number;
  nicb?: CheckAnswer;
  openRecalls?: CheckAnswer;
}

/** A 3D shape guessed from one photo (TripoSR): estimated, not measured. */
export interface Guess {
  status: 'queued' | 'running' | 'done' | 'failed';
  job: string;
  photo?: string;
  /** GLB with vertex colours. */
  model?: string;
  /** The cut-out the guess was made from. */
  input?: string;
  createdAt?: number;
  faces?: number;
  error?: string;
}

export interface Spotted {
  id: string;
  createdAt: number;
  photo: string;
  identity: Identity;
  color?: PaintColor;
  headline?: Spec[];
}
