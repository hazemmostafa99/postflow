type PhoneCollectionSourceType = "facebook" | "generic";

interface PhoneCollectionSource {
  type: PhoneCollectionSourceType;
  url: string;
  title?: string;
}

type PhoneCandidateOrigin = "visible-text" | "tel-link" | "attribute";

interface PhoneCollectionCandidate {
  id: string;
  raw: string;
  origin: PhoneCandidateOrigin;
}

type PhoneValidationStatus = "valid" | "invalid";

interface PhoneReviewNumber {
  id: string;
  raw: string;
  value: string;
  normalized?: string;
  status: PhoneValidationStatus;
  selected: boolean;
  reason?: string;
}

interface PhoneCollectionSummary {
  found: number;
  valid: number;
  duplicates: number;
  invalid: number;
}

type PhoneCollectionStatus = "idle" | "collecting" | "review" | "error";

type PhoneSyncStatus = "idle" | "confirming" | "syncing" | "success" | "error";

interface PhoneSyncResult {
  submitted: number;
  valid: number;
  duplicates: number;
  invalid: number;
  added: number;
  alreadyExisted: number;
}

type PhoneSyncErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "SERVER_ERROR"
  | "API_REJECTED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "WORKER_NO_RESPONSE"
  | "NO_NUMBERS_SELECTED";

interface PhoneSyncResponse {
  ok: boolean;
  result?: PhoneSyncResult;
  code?: PhoneSyncErrorCode;
  httpStatus?: number;
  error?: string;
}

interface PhoneCollectorState {
  schemaVersion: 1;
  collectionStatus: PhoneCollectionStatus;
  source: PhoneCollectionSource | null;
  candidates: PhoneCollectionCandidate[];
  numbers: PhoneReviewNumber[];
  summary: PhoneCollectionSummary;
  collectionError?: string;
  syncStatus: PhoneSyncStatus;
  syncError?: string;
  syncResult?: PhoneSyncResult;
}

type PhoneCollectorErrorCode =
  | "NO_ACTIVE_TAB"
  | "UNSUPPORTED_PAGE"
  | "CONTENT_SCRIPT_UNAVAILABLE"
  | "COLLECTION_FAILED";

interface PhoneCollectionResponse {
  ok: boolean;
  collectorReady?: boolean;
  code?: PhoneCollectorErrorCode;
  source?: PhoneCollectionSource;
  candidates?: PhoneCollectionCandidate[];
  numbers?: PhoneReviewNumber[];
  summary?: PhoneCollectionSummary;
  error?: string;
}
